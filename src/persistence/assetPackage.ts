import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';
import type { BlobRecord } from '../application/blobStore';
import { detectImageMime, mimeToExtension } from '../assets/sourceImport';
import { collectSubtreeNodeIds } from '../domain/commands';
import { AppError } from '../domain/errors';
import { sha256Hex } from '../domain/hash';
import {
  AssetSchema,
  NodeSchema,
  SourceMimeTypeSchema,
  SourceSchema,
  TrackSchema,
  canonicalStringify,
  type Asset,
  type Project,
  type SceneNode,
  type SourceMimeType,
  type SourceRecord,
  type Track,
} from '../domain/schema';
import { validateArchivePath, type UnpackOptions } from './zip';

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;

const PackageBlobEntrySchema = z.object({
  id: z.string().min(1),
  role: z.enum(['source', 'mask', 'overlay', 'asset']),
  path: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const AssetPackageManifestSchema = z.object({
  kind: z.literal('terrymator-asset-package'),
  formatVersion: z.number().int().positive(),
  packageType: z.enum(['asset', 'rig']),
  appVersion: z.string().min(1),
  payloadPath: z.literal('package.json'),
  blobs: z.array(PackageBlobEntrySchema),
});

const AssetPackagePayloadSchema = z.object({
  schemaVersion: z.number().int().positive(),
  packageType: z.enum(['asset', 'rig']),
  name: z.string().min(1),
  rootNodeIds: z.array(z.string().min(1)),
  sources: z.array(SourceSchema),
  assets: z.array(AssetSchema),
  nodes: z.array(NodeSchema),
  tracks: z.array(TrackSchema),
});

export type AssetPackagePayload = z.infer<typeof AssetPackagePayloadSchema>;

function packageBlobPath(rec: BlobRecord): string {
  if (rec.role === 'source') {
    const parsed = SourceMimeTypeSchema.safeParse(rec.mimeType);
    const ext = parsed.success ? mimeToExtension(parsed.data) : 'bin';
    return `sources/${rec.id}.${ext}`;
  }
  if (rec.role === 'mask') return `masks/${rec.id}.png`;
  if (rec.role === 'overlay') return `overlays/${rec.id}.png`;
  return `assets/${rec.id}.png`;
}

function collectAssetDeps(
  project: Project,
  assetId: string,
  assetsMap: Map<string, Asset>,
  sourcesMap: Map<string, SourceRecord>,
  blobIds: Set<string>,
): void {
  const asset = project.assets[assetId];
  if (!asset) {
    throw new AppError('ERR_MISSING_ASSET', `Package references missing asset "${assetId}".`);
  }
  assetsMap.set(asset.id, structuredClone(asset));

  if (asset.kind === 'synthetic-rgba') {
    blobIds.add(asset.blobId);
  } else if (asset.kind === 'material') {
    blobIds.add(asset.rasterBlobId);
    if (asset.recipe.imageSourceId) {
      const src = project.sources[asset.recipe.imageSourceId];
      if (!src) {
        throw new AppError(
          'ERR_MISSING_ASSET',
          `Material references missing source "${asset.recipe.imageSourceId}".`,
        );
      }
      sourcesMap.set(src.id, structuredClone(src));
      blobIds.add(src.blobId);
    }
  } else {
    const src = project.sources[asset.sourceId];
    if (!src) {
      throw new AppError('ERR_MISSING_ASSET', `Cutout references missing source "${asset.sourceId}".`);
    }
    sourcesMap.set(src.id, structuredClone(src));
    blobIds.add(src.blobId);
    if (asset.maskBlobId) blobIds.add(asset.maskBlobId);
    if (asset.overlayBlobId) blobIds.add(asset.overlayBlobId);
  }
}

export async function packAssetPackage(
  project: Project,
  blobs: Map<string, BlobRecord>,
  target: { kind: 'asset'; assetId: string } | { kind: 'rig'; rootNodeId: string },
  appVersion = '0.1.0',
): Promise<Uint8Array> {
  const assetsMap = new Map<string, Asset>();
  const sourcesMap = new Map<string, SourceRecord>();
  const blobIds = new Set<string>();
  const nodes: SceneNode[] = [];
  const tracks: Track[] = [];
  const rootNodeIds: string[] = [];
  let name: string;

  if (target.kind === 'asset') {
    const asset = project.assets[target.assetId];
    if (!asset) {
      throw new AppError('ERR_MISSING_ASSET', `Unknown asset "${target.assetId}".`);
    }
    name = asset.name;
    collectAssetDeps(project, asset.id, assetsMap, sourcesMap, blobIds);
  } else {
    const subtreeIds = collectSubtreeNodeIds(project, target.rootNodeId);
    const rootNode = project.nodes[target.rootNodeId]!;
    name = rootNode.name;
    rootNodeIds.push(rootNode.id);

    const nodeSet = new Set(subtreeIds);
    for (const id of subtreeIds) {
      const cloned = structuredClone(project.nodes[id]!);
      if (id === target.rootNodeId) {
        // Strip external parent link so package is standalone
        cloned.parentId = null;
      }
      nodes.push(cloned);
      if (cloned.assetId) {
        collectAssetDeps(project, cloned.assetId, assetsMap, sourcesMap, blobIds);
      }
    }

    for (const track of Object.values(project.tracks)) {
      if (track.targetKind === 'node' && nodeSet.has(track.targetId)) {
        tracks.push(structuredClone(track));
      }
    }
  }

  const files: Record<string, Uint8Array> = {};
  const manifestBlobs: z.infer<typeof PackageBlobEntrySchema>[] = [];

  for (const blobId of Array.from(blobIds).sort()) {
    const rec = blobs.get(blobId);
    if (!rec) {
      throw new AppError('ERR_MISSING_ASSET', `Package missing blob "${blobId}".`);
    }
    const path = packageBlobPath(rec);
    validateArchivePath(path);
    const sha256 = await sha256Hex(rec.bytes);
    files[path] = rec.bytes;
    manifestBlobs.push({
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

  const payload: AssetPackagePayload = {
    schemaVersion: 1,
    packageType: target.kind,
    name,
    rootNodeIds,
    sources: Array.from(sourcesMap.values()),
    assets: Array.from(assetsMap.values()),
    nodes,
    tracks,
  };
  files['package.json'] = strToU8(canonicalStringify(payload));

  const manifest = {
    kind: 'terrymator-asset-package' as const,
    formatVersion: 1,
    packageType: target.kind,
    appVersion,
    payloadPath: 'package.json' as const,
    blobs: manifestBlobs,
  };
  files['manifest.json'] = strToU8(canonicalStringify(manifest));

  return zipSync(files, { level: 6 });
}

export async function unpackAssetPackage(
  zipBytes: Uint8Array,
  decodeImage: (
    bytes: Uint8Array,
    mimeType: SourceMimeType,
  ) => Promise<{ width: number; height: number; rgba: Uint8Array }>,
  options: UnpackOptions = {},
): Promise<{ payload: AssetPackagePayload; blobs: Map<string, BlobRecord> }> {
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
          throw new AppError('ERR_ARCHIVE_LIMIT_EXCEEDED', 'Package exceeds maximum entry count.');
        }
        totalBytes += file.originalSize;
        if (totalBytes > maxBytes) {
          throw new AppError('ERR_ARCHIVE_LIMIT_EXCEEDED', 'Package exceeds uncompressed byte limit.');
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('ERR_ARCHIVE_INVALID', 'Failed to read .collageasset package.');
  }

  const manifestRaw = entries['manifest.json'];
  if (!manifestRaw) {
    throw new AppError('ERR_ARCHIVE_INVALID', 'Package missing manifest.json.');
  }
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(strFromU8(manifestRaw));
  } catch {
    throw new AppError('ERR_ARCHIVE_INVALID', 'Invalid JSON in package manifest.json.');
  }
  const parsedManifest = AssetPackageManifestSchema.safeParse(manifestJson);
  if (!parsedManifest.success) {
    throw new AppError(
      'ERR_ARCHIVE_INVALID',
      parsedManifest.error.issues[0]?.message ?? 'Invalid package manifest.',
    );
  }
  if (parsedManifest.data.formatVersion > 1) {
    throw new AppError(
      'ERR_UNSUPPORTED_VERSION',
      `Unsupported package formatVersion: ${parsedManifest.data.formatVersion}.`,
    );
  }

  const payloadRaw = entries[parsedManifest.data.payloadPath];
  if (!payloadRaw) {
    throw new AppError('ERR_ARCHIVE_INVALID', 'Package missing package.json.');
  }
  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(strFromU8(payloadRaw));
  } catch {
    throw new AppError('ERR_ARCHIVE_INVALID', 'Invalid JSON in package.json.');
  }
  const parsedPayload = AssetPackagePayloadSchema.safeParse(payloadJson);
  if (!parsedPayload.success) {
    throw new AppError(
      'ERR_INVALID_SCHEMA',
      parsedPayload.error.issues[0]?.message ?? 'Invalid package payload.',
    );
  }
  if (parsedPayload.data.schemaVersion > 1) {
    throw new AppError(
      'ERR_UNSUPPORTED_VERSION',
      `Unsupported package schemaVersion: ${parsedPayload.data.schemaVersion}.`,
    );
  }

  const blobs = new Map<string, BlobRecord>();
  for (const entry of parsedManifest.data.blobs) {
    validateArchivePath(entry.path);
    const bytes = entries[entry.path];
    if (!bytes) {
      throw new AppError('ERR_ARCHIVE_INVALID', `Missing blob "${entry.path}" in package.`);
    }
    if (bytes.byteLength !== entry.byteLength) {
      throw new AppError('ERR_ARCHIVE_INVALID', `Byte length mismatch for blob "${entry.id}".`);
    }
    const actualHash = await sha256Hex(bytes);
    if (actualHash !== entry.sha256) {
      throw new AppError('ERR_ARCHIVE_INVALID', `SHA-256 mismatch for blob "${entry.id}".`);
    }
    const detectedMime = detectImageMime(bytes);
    if (!detectedMime) {
      throw new AppError('ERR_INVALID_IMAGE', `Package blob "${entry.id}" is not a valid image.`);
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

  // Validate internal references inside the package
  const payload = parsedPayload.data;
  const sourceIds = new Set(payload.sources.map((s) => s.id));
  const assetIds = new Set(payload.assets.map((a) => a.id));
  const nodeIds = new Set(payload.nodes.map((n) => n.id));

  for (const src of payload.sources) {
    if (!blobs.has(src.blobId)) {
      throw new AppError('ERR_MISSING_ASSET', `Package source "${src.id}" missing blob "${src.blobId}".`);
    }
  }
  for (const asset of payload.assets) {
    if (asset.kind === 'synthetic-rgba' && !blobs.has(asset.blobId)) {
      throw new AppError('ERR_MISSING_ASSET', `Package asset "${asset.id}" missing blob.`);
    } else if (asset.kind === 'material') {
      if (!blobs.has(asset.rasterBlobId)) {
        throw new AppError('ERR_MISSING_ASSET', `Package material "${asset.id}" missing raster blob.`);
      }
      if (asset.recipe.imageSourceId && !sourceIds.has(asset.recipe.imageSourceId)) {
        throw new AppError('ERR_MISSING_ASSET', `Package material "${asset.id}" missing source.`);
      }
    } else if (asset.kind === 'cutout') {
      if (!sourceIds.has(asset.sourceId)) {
        throw new AppError('ERR_MISSING_ASSET', `Package cutout "${asset.id}" missing source.`);
      }
      if (asset.maskBlobId && !blobs.has(asset.maskBlobId)) {
        throw new AppError('ERR_MISSING_ASSET', `Package cutout "${asset.id}" missing mask blob.`);
      }
      if (asset.overlayBlobId && !blobs.has(asset.overlayBlobId)) {
        throw new AppError('ERR_MISSING_ASSET', `Package cutout "${asset.id}" missing overlay blob.`);
      }
    }
  }
  for (const node of payload.nodes) {
    if (node.parentId !== null && !nodeIds.has(node.parentId)) {
      throw new AppError('ERR_MISSING_PARENT', `Package node "${node.id}" missing parent "${node.parentId}".`);
    }
    if (node.kind !== 'group' && (!node.assetId || !assetIds.has(node.assetId))) {
      throw new AppError('ERR_MISSING_ASSET', `Package node "${node.id}" missing asset.`);
    }
  }

  return { payload, blobs };
}
