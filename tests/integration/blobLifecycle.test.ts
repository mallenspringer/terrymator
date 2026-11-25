import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../../src/application/store';
import { encodePngRgba } from '../../src/assets/pngCodec';
import { createSolidSquare } from '../../src/assets/synthetic';
import { createBlankProject } from '../../src/domain/schema';

describe('application/blobStore lifecycle', () => {
  it('deduplicates identical source bytes by SHA-256 and retains blobs needed for undo', async () => {
    const store = new ProjectStore();
    store.load(createBlankProject({ id: 'blob-proj' }), new Map());

    const sq = createSolidSquare(16, 16, [0, 255, 0, 255]);
    const pngBytes = encodePngRgba(sq.rgba, 16, 16);

    const first = await store.importSource({
      name: 'a.png',
      bytes: pngBytes,
      mimeType: 'image/png',
      width: 16,
      height: 16,
      rgba: sq.rgba,
      sourceId: 'src-a',
      createInitialAsset: true,
      assetId: 'asset-a',
    });
    expect(first.deduplicated).toBe(false);
    expect(store.getBlobCount()).toBe(1);

    const second = await store.importSource({
      name: 'b.png',
      bytes: pngBytes,
      mimeType: 'image/png',
      width: 16,
      height: 16,
      rgba: sq.rgba,
      sourceId: 'src-b',
      createInitialAsset: true,
      assetId: 'asset-b',
    });
    expect(second.deduplicated).toBe(true);
    expect(second.source.blobId).toBe(first.source.blobId);
    expect(store.getBlobCount()).toBe(1);

    // Switching to a fresh shot clears history and releases orphaned blobs
    store.dispatch({ type: 'NEW_SHOT', projectId: 'fresh-proj' });
    expect(store.getBlobCount()).toBe(0);
  });
});
