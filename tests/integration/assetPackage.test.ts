import { strToU8, zipSync } from 'fflate';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../../src/application/store';
import { canonicalStringify, createBlankProject } from '../../src/domain/schema';
import { packAssetPackage, unpackAssetPackage } from '../../src/persistence/assetPackage';
import { packArchive, unpackArchive } from '../../src/persistence/zip';
import { buildF04JointedPuppet, buildF06Parallax } from '../../src/test-harness/fixtures';

async function decodePngNode(bytes: Uint8Array) {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
}

describe('persistence/assetPackage & G3 archives', () => {
  it('exports and imports rig subtree .collageasset with remapped IDs and stripped external parent', async () => {
    const f04 = buildF04JointedPuppet();
    const srcStore = new ProjectStore();
    srcStore.load(f04.project, f04.blobs);

    // Export upper-arm subtree (has external parent 'torso' -> must be stripped to null!)
    const pkgBytes = await packAssetPackage(srcStore.snapshot(), srcStore.getBlobs(), {
      kind: 'rig',
      rootNodeId: 'upper-arm',
    });
    const unpacked = await unpackAssetPackage(pkgBytes, decodePngNode);
    expect(unpacked.payload.packageType).toBe('rig');
    expect(unpacked.payload.nodes.find((n) => n.id === 'upper-arm')!.parentId).toBeNull();

    // Import twice into a brand-new blank project
    const dstStore = new ProjectStore();
    dstStore.load(createBlankProject({ id: 'dst-proj', width: 320, height: 180 }), new Map());

    const imp1 = await dstStore.importAssetPackage(unpacked);
    const imp2 = await dstStore.importAssetPackage(unpacked);

    expect(imp1.importedNodeIds).toHaveLength(3);
    expect(imp2.importedNodeIds).toHaveLength(3);
    expect(new Set([...imp1.importedNodeIds, ...imp2.importedNodeIds]).size).toBe(6);

    const snap = dstStore.snapshot();
    expect(Object.keys(snap.nodes)).toHaveLength(6);
    expect(Object.keys(snap.assets)).toHaveLength(6);
  });

  it('refuses malformed or path-traversal .collageasset without modifying live store', async () => {
    const store = new ProjectStore();
    store.load(createBlankProject({ id: 'safe-proj' }), new Map());
    const hashBefore = await store.canonicalHash();

    const evilPkg = zipSync({
      '../escape.txt': strToU8('bad'),
    });
    await expect(unpackAssetPackage(evilPkg, decodePngNode)).rejects.toMatchObject({
      code: 'ERR_PATH_TRAVERSAL',
    });
    expect(await store.canonicalHash()).toBe(hashBefore);
  });

  it('roundtrips F04 and F06 .collage archives preserving rigs, pivots, camera, and tile params', async () => {
    for (const fixture of [buildF04JointedPuppet(), buildF06Parallax()]) {
      const store = new ProjectStore();
      store.load(fixture.project, fixture.blobs);
      const packed = await packArchive(store.snapshot(), store.getBlobs());
      const restored = await unpackArchive(packed, decodePngNode);
      expect(canonicalStringify(restored.project)).toBe(canonicalStringify(store.snapshot()));
    }
  });
});
