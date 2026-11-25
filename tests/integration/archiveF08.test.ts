import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../../src/application/store';
import { compositeCutoutAsset, extractMaskFromRgba } from '../../src/assets/cutting';
import { canonicalStringify } from '../../src/domain/schema';
import { packArchive, unpackArchive } from '../../src/persistence/zip';
import { buildF08ArchiveProject } from '../../src/test-harness/fixtures';

async function decodePngNode(bytes: Uint8Array) {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
}

describe('integration/archive F08', () => {
  it('preserves shared source bytes, cutout masks/overlays, unique sibling isolation, and stage anchors across roundtrip', async () => {
    const f08 = buildF08ArchiveProject();
    const store = new ProjectStore();
    store.load(f08.project, f08.blobs);

    const origSourceSha = store.snapshot().sources['src-f02']!.sha256;
    const origUniqueBefore = canonicalStringify(store.snapshot().assets['asset-torso-unique']);

    // Edit asset-torso (commit a mask edit) -> increments revision, preserves node ID & anchor
    const newMask = new Uint8Array(64 * 64).fill(255);
    newMask[0] = 0;
    await store.commitCutoutEdit({
      assetId: 'asset-torso',
      editRect: { x: 0, y: 0, width: 64, height: 64 },
      mask: newMask,
      overlay: null,
      anchorX: 32,
      anchorY: 32,
    });

    const snap = store.snapshot();
    expect(snap.assets['asset-torso']!.revision).toBe(3);
    expect(snap.assets['asset-torso']!.anchorX).toBe(32);
    expect(snap.nodes['node-torso']!.assetId).toBe('asset-torso');
    expect(snap.sources['src-f02']!.sha256).toBe(origSourceSha);
    // Unique sibling asset is completely isolated
    expect(canonicalStringify(snap.assets['asset-torso-unique'])).toBe(origUniqueBefore);

    // Pack and unpack .collage archive
    const packed = await packArchive(snap, store.getBlobs());
    const restored = await unpackArchive(packed, decodePngNode);

    expect(canonicalStringify(restored.project)).toBe(canonicalStringify(snap));

    // Verify composited cutout RGBA matches after reopen
    const restoredAsset = restored.project.assets['asset-torso']!;
    if (restoredAsset.kind === 'cutout') {
      const srcBlob = restored.blobs.get(restored.project.sources[restoredAsset.sourceId]!.blobId)!;
      const maskBlob = restored.blobs.get(restoredAsset.maskBlobId!)!;
      const comp = compositeCutoutAsset(
        srcBlob.rgba,
        srcBlob.width,
        srcBlob.height,
        restoredAsset.editRect,
        extractMaskFromRgba(maskBlob.rgba),
        null,
        true,
      );
      expect(comp[3]).toBe(0);
    }
  });
});
