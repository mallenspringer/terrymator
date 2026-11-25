import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';
import { AppError } from '../domain/errors';
import { canonicalStringify, validateProject, type Project } from '../domain/schema';

export interface BlobRecord {
  id: string;
  mimeType: string;
  width: number;
  height: number;
  rgba: Uint8Array;
  pngBytes: Uint8Array;
}

export interface UnpackOptions {
  maxEntries?: number;
  maxTotalUncompressedBytes?: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024; // 1 GiB

const ManifestBlobEntrySchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const ManifestSchema = z.object({
  kind: z.literal('terrymator-project'),
  formatVersion: z.literal(1),
  appVersion: z.string().min(1),
  projectPath: z.literal('project.json'),
  blobs: z.array(ManifestBlobEntrySchema),
});

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  const view = new Uint8Array(digest);
  let hex = '';
  for (const b of view) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

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

export async function packArchive(
  project: Project,
  blobs: Map<string, BlobRecord>,
  appVersion = '0.1.0',
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const blobManifest: z.infer<typeof ManifestBlobEntrySchema>[] = [];

  for (const blobId of Array.from(blobs.keys()).sort()) {
    const rec = blobs.get(blobId)!;
    const path = `assets/${blobId}.png`;
    validateArchivePath(path);
    const sha256 = await sha256Hex(rec.pngBytes);
    files[path] = rec.pngBytes;
    blobManifest.push({
      id: blobId,
      path,
      byteLength: rec.pngBytes.byteLength,
      mimeType: rec.mimeType,
      sha256,
      width: rec.width,
      height: rec.height,
    });
  }

  const projectBytes = strToU8(canonicalStringify(project));
  files['project.json'] = projectBytes;

  const manifest = {
    kind: 'terrymator-project' as const,
    formatVersion: 1 as const,
    appVersion,
    projectPath: 'project.json' as const,
    blobs: blobManifest,
  };
  files['manifest.json'] = strToU8(canonicalStringify(manifest));

  return zipSync(files, { level: 6 });
}

export async function unpackArchive(
  zipBytes: Uint8Array,
  decodePng: (pngBytes: Uint8Array) => Promise<{ width: number; height: number; rgba: Uint8Array }>,
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
    const decoded = await decodePng(bytes);
    blobs.set(entry.id, {
      id: entry.id,
      mimeType: entry.mimeType,
      width: decoded.width,
      height: decoded.height,
      rgba: decoded.rgba,
      pngBytes: bytes,
    });
  }

  for (const asset of Object.values(project.assets)) {
    if (!blobs.has(asset.blobId)) {
      throw new AppError('ERR_MISSING_ASSET', `Project references missing blob "${asset.blobId}".`);
    }
  }

  return { project, blobs };
}
