import { sha256Hex } from '../domain/hash';
import type { Project, SourceMimeType } from '../domain/schema';

export type BlobRole = 'source' | 'mask' | 'overlay' | 'asset';

export interface BlobRecord {
  id: string;
  role: BlobRole;
  mimeType: string;
  bytes: Uint8Array;
  sha256: string;
  width: number;
  height: number;
  rgba: Uint8Array;
}

export function collectProjectBlobIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const src of Object.values(project.sources)) {
    ids.add(src.blobId);
  }
  for (const asset of Object.values(project.assets)) {
    if (asset.kind === 'synthetic-rgba') {
      ids.add(asset.blobId);
    } else {
      if (asset.maskBlobId) ids.add(asset.maskBlobId);
      if (asset.overlayBlobId) ids.add(asset.overlayBlobId);
    }
  }
  return ids;
}

export class BlobStore {
  private readonly map = new Map<string, BlobRecord>();

  public load(blobs: Map<string, BlobRecord>): void {
    this.map.clear();
    for (const [id, rec] of blobs.entries()) {
      this.map.set(id, rec);
    }
  }

  public put(record: BlobRecord): BlobRecord {
    this.map.set(record.id, record);
    return record;
  }

  public async putSource(
    bytes: Uint8Array,
    mimeType: SourceMimeType,
    decoded: { width: number; height: number; rgba: Uint8Array },
  ): Promise<{ record: BlobRecord; deduplicated: boolean }> {
    const sha256 = await sha256Hex(bytes);
    for (const existing of this.map.values()) {
      if (existing.role === 'source' && existing.sha256 === sha256) {
        return { record: existing, deduplicated: true };
      }
    }

    const id = `src-${sha256.slice(0, 16)}`;
    const record: BlobRecord = {
      id,
      role: 'source',
      mimeType,
      bytes: new Uint8Array(bytes),
      sha256,
      width: decoded.width,
      height: decoded.height,
      rgba: decoded.rgba,
    };
    this.map.set(id, record);
    return { record, deduplicated: false };
  }

  public get(id: string): BlobRecord | undefined {
    return this.map.get(id);
  }

  public has(id: string): boolean {
    return this.map.has(id);
  }

  public size(): number {
    return this.map.size;
  }

  public totalBytes(): number {
    let total = 0;
    for (const rec of this.map.values()) {
      total += rec.bytes.byteLength + rec.rgba.byteLength;
    }
    return total;
  }

  public toMap(): Map<string, BlobRecord> {
    return new Map(this.map);
  }

  public pruneUnreferenced(keepIds: Set<string>): number {
    let removed = 0;
    for (const id of Array.from(this.map.keys())) {
      if (!keepIds.has(id)) {
        this.map.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  public clear(): void {
    this.map.clear();
  }
}
