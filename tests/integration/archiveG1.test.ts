import { strToU8, zipSync } from 'fflate';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../../src/application/store';
import { encodePngRgba } from '../../src/assets/pngCodec';
import { createSolidSquare } from '../../src/assets/synthetic';
import { createDefaultNode } from '../../src/domain/commands';
import { canonicalStringify, createBlankProject } from '../../src/domain/schema';
import { packArchive, unpackArchive } from '../../src/persistence/zip';

async function decodePngNode(bytes: Uint8Array) {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
}

describe('persistence/zip G1', () => {
  it('roundtrips cutout assets, source bytes, and attribution metadata', async () => {
    const store = new ProjectStore();
    store.load(createBlankProject({ id: 'proj-g1', name: 'G1 Shot' }), new Map());

    const sq = createSolidSquare(32, 32, [10, 180, 240, 255]);
    const pngBytes = encodePngRgba(sq.rgba, 32, 32);

    const { source, assetId } = await store.importSource({
      name: 'hero.png',
      bytes: pngBytes,
      mimeType: 'image/png',
      width: 32,
      height: 32,
      rgba: sq.rgba,
      sourceId: 'src-hero',
      createInitialAsset: true,
      assetId: 'asset-hero',
    });

    store.dispatch({
      type: 'UPDATE_SOURCE_META',
      sourceId: source.id,
      attribution: 'Public Domain Scan',
      sourceUrl: 'https://example.org/scan',
    });
    store.dispatch({
      type: 'ADD_NODE',
      node: createDefaultNode({
        id: 'node-hero',
        name: 'Hero',
        kind: 'sprite',
        assetId: assetId!,
        x: 100,
        y: 200,
        drawOrder: 1,
      }),
    });

    const packed = await packArchive(store.snapshot(), store.getBlobs());
    const restored = await unpackArchive(packed, decodePngNode);

    expect(canonicalStringify(restored.project)).toBe(canonicalStringify(store.snapshot()));
    expect(restored.project.sources['src-hero']!.attribution).toBe('Public Domain Scan');
    expect(restored.project.sources['src-hero']!.sourceUrl).toBe('https://example.org/scan');
  });

  it('refuses future schemaVersion and malformed archives without mutating live store', async () => {
    const store = new ProjectStore();
    store.load(createBlankProject({ id: 'live-proj', name: 'Live Work' }), new Map());
    const beforeHash = await store.canonicalHash();

    const futureProj = { ...store.snapshot(), schemaVersion: 99 };
    const futureZip = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({
          kind: 'terrymator-project',
          formatVersion: 1,
          appVersion: '0.1.0',
          projectPath: 'project.json',
          blobs: [],
        }),
      ),
      'project.json': strToU8(JSON.stringify(futureProj)),
    });

    await expect(unpackArchive(futureZip, decodePngNode)).rejects.toMatchObject({
      code: 'ERR_UNSUPPORTED_VERSION',
    });
    expect(await store.canonicalHash()).toBe(beforeHash);
  });
});
