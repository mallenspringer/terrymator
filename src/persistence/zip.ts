import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';
import { collectProjectBlobIds, type BlobRecord, type BlobRole } from '../application/blobStore';
import { detectImageMime, mimeToExtension } from '../assets/sourceImport';
import { AppError } from '../domain/errors';
import { evaluateScene } from '../domain/evaluator';
import { sha256Hex } from '../domain/hash';
import {
  SourceMimeTypeSchema,
  canonicalStringify,
  validateProject,
  type Project,
  type SourceMimeType,
} from '../domain/schema';

export type { BlobRecord, BlobRole };

export interface UnpackOptions {
  maxEntries?: number;
  maxTotalUncompressedBytes?: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024; // 1 GiB

const ManifestBlobEntrySchema = z.object({
  id: z.string().min(1),
  role: z.enum(['source', 'mask', 'overlay', 'asset']).default('asset'),
  path: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const ManifestSchema = z.object({
  kind: z.literal('terrymator-project'),
  formatVersion: z.number().int().positive(),
  appVersion: z.string().min(1),
  projectPath: z.literal('project.json'),
  blobs: z.array(ManifestBlobEntrySchema),
});

export { sha256Hex };

export function validateArchivePath(path: string): void {
  if (
    !path ||
    path.includes('\0') ||
    path.startsWith('/') ||
    path.startsWith('\\') ||
    /^[a-zA-Z]:/.test(path) ||
    path.includes('\\')
  ) {
    throw new AppError('ERR_PATH_TRAVERSAL', `Unsafe archive path: "${path}".`);
  }
  const segments = path.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new AppError('ERR_PATH_TRAVERSAL', `Invalid path segment in archive: "${path}".`);
    }
  }
}

function archivePathForBlob(rec: BlobRecord): string {
  if (rec.role === 'source') {
    const parsedMime = SourceMimeTypeSchema.safeParse(rec.mimeType);
    const ext = parsedMime.success ? mimeToExtension(parsedMime.data) : 'bin';
    return `sources/${rec.id}.${ext}`;
  }
  if (rec.role === 'mask') {
    return `masks/${rec.id}.png`;
  }
  if (rec.role === 'overlay') {
    return `overlays/${rec.id}.png`;
  }
  return `assets/${rec.id}.png`;
}

export async function packArchive(
  project: Project,
  blobs: Map<string, BlobRecord>,
  appVersion = '0.1.0',
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const blobManifest: z.infer<typeof ManifestBlobEntrySchema>[] = [];
  const referencedIds = collectProjectBlobIds(project);

  for (const blobId of Array.from(referencedIds).sort()) {
    const rec = blobs.get(blobId);
    if (!rec) {
      throw new AppError('ERR_MISSING_ASSET', `Cannot pack archive: missing blob "${blobId}".`, {
        blobId,
      });
    }
    const path = archivePathForBlob(rec);
    validateArchivePath(path);
    const sha256 = await sha256Hex(rec.bytes);
    files[path] = rec.bytes;
    blobManifest.push({
      id: blobId,
      role: rec.role,
      path,
      byteLength: rec.bytes.byteLength,
      mimeType: rec.mimeType,
      sha256,
      width: rec.width,
      height: rec.height,
    });
  }

  files['project.json'] = strToU8(canonicalStringify(project));
  const manifest = {
    kind: 'terrymator-project' as const,
    formatVersion: 1,
    appVersion,
    projectPath: 'project.json' as const,
    blobs: blobManifest,
  };
  files['manifest.json'] = strToU8(canonicalStringify(manifest));

  return zipSync(files, { level: 6 });
}

export async function unpackArchive(
  zipBytes: Uint8Array,
  decodeImage: (
    bytes: Uint8Array,
    mimeType: SourceMimeType,
  ) => Promise<{ width: number; height: number; rgba: Uint8Array }>,
  options: UnpackOptions = {},
): Promise<{ project: Project; blobs: Map<string, BlobRecord> }> {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = options.maxTotalUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES;

  let entryCount = 0;
  let totalBytes = 0;

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes, {
      filter(file) {
        validateArchivePath(file.name);
        entryCount += 1;
        if (entryCount > maxEntries) {
          throw new AppError('ERR_ARCHIVE_LIMIT_EXCEEDED', 'Archive exceeds maximum entry count.');
        }
        totalBytes += file.originalSize;
        if (totalBytes > maxBytes) {
          throw new AppError(
            'ERR_ARCHIVE_LIMIT_EXCEEDED',
            'Archive exceeds maximum uncompressed byte limit.',
          );
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError('ERR_ARCHIVE_INVALID', 'Failed to read ZIP archive.');
  }

  const manifestRaw = entries['manifest.json'];
  if (!manifestRaw) {
    throw new AppError('ERR_ARCHIVE_INVALID', 'Archive missing manifest.json.');
  }
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(strFromU8(manifestRaw));
  } catch {
    throw new AppError('ERR_ARCHIVE_INVALID', 'Invalid JSON in manifest.json.');
  }
  const parsedManifest = ManifestSchema.safeParse(manifestJson);
  if (!parsedManifest.success) {
    throw new AppError(
      'ERR_ARCHIVE_INVALID',
      parsedManifest.error.issues[0]?.message ?? 'Invalid manifest schema.',
    );
  }
  if (parsedManifest.data.formatVersion > 1) {
    throw new AppError(
      'ERR_UNSUPPORTED_VERSION',
      `Unsupported archive formatVersion: ${parsedManifest.data.formatVersion}.`,
      { formatVersion: parsedManifest.data.formatVersion },
    );
  }

  const projectRaw = entries[parsedManifest.data.projectPath];
  if (!projectRaw) {
    throw new AppError('ERR_ARCHIVE_INVALID', 'Archive missing project.json.');
  }
  let projectJson: unknown;
  try {
    projectJson = JSON.parse(strFromU8(projectRaw));
  } catch {
    throw new AppError('ERR_ARCHIVE_INVALID', 'Invalid JSON in project.json.');
  }
  const project = validateProject(projectJson);

  const blobs = new Map<string, BlobRecord>();
  for (const entry of parsedManifest.data.blobs) {
    validateArchivePath(entry.path);
    const bytes = entries[entry.path];
    if (!bytes) {
      throw new AppError('ERR_ARCHIVE_INVALID', `Missing blob "${entry.path}" listed in manifest.`);
    }
    if (bytes.byteLength !== entry.byteLength) {
      throw new AppError('ERR_ARCHIVE_INVALID', `Byte length mismatch for blob "${entry.id}".`);
    }
    const actualHash = await sha256Hex(bytes);
    if (actualHash !== entry.sha256) {
      throw new AppError('ERR_ARCHIVE_INVALID', `SHA-256 hash mismatch for blob "${entry.id}".`);
    }

    const detectedMime = detectImageMime(bytes);
    if (!detectedMime) {
      throw new AppError('ERR_INVALID_IMAGE', `Blob "${entry.id}" is not a valid PNG/JPEG/WebP.`);
    }

    const decoded = await decodeImage(bytes, detectedMime);
    blobs.set(entry.id, {
      id: entry.id,
      role: entry.role,
      mimeType: detectedMime,
      bytes,
      sha256: actualHash,
      width: decoded.width,
      height: decoded.height,
      rgba: decoded.rgba,
    });
  }

  // Validate all project references & topological graph before returning
  for (const blobId of collectProjectBlobIds(project)) {
    if (!blobs.has(blobId)) {
      throw new AppError('ERR_MISSING_ASSET', `Project references missing blob "${blobId}".`, {
        blobId,
      });
    }
  }
  evaluateScene(project, 0);

  return { project, blobs };
}
