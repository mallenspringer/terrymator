import { zipSync, strToU8, unzipSync } from 'fflate';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../../src/application/store';
import { AppError } from '../../src/domain/errors';
import { sha256Hex } from '../../src/domain/hash';
import { packArchive, unpackArchive } from '../../src/persistence/zip';
import { buildG0DemoFixture } from '../../src/test-harness/fixtures';

async function decodePngNode(
  bytes: Uint8Array,
): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
}

describe('integration/f11BrokenFiles', () => {
  it('rejects all F11 malformed/corrupt/unsafe archives with AppError and leaves live store intact', async () => {
    const { project, blobs } = buildG0DemoFixture();
    const store = new ProjectStore();
    store.load(project, blobs);
    const baselineHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(store.snapshot())));

    const validZip = await packArchive(project, blobs);
    const validEntries = unzipSync(validZip);

    const expectRejected = async (bytes: Uint8Array, expectedCode: string | RegExp) => {
      let caught: unknown;
      try {
        const unpacked = await unpackArchive(bytes, decodePngNode);
        store.replaceProjectTransactional(unpacked.project, unpacked.blobs);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).code).toMatch(expectedCode);
      const currentHash = await sha256Hex(
        new TextEncoder().encode(JSON.stringify(store.snapshot())),
      );
      expect(currentHash).toBe(baselineHash);
    };

    // 1. Not a zip
    await expectRejected(strToU8('not-a-zip-archive'), 'ERR_ARCHIVE_INVALID');

    // 2. Missing project.json
    const noProject = { ...validEntries };
    delete noProject['project.json'];
    await expectRejected(zipSync(noProject), 'ERR_ARCHIVE_INVALID');

    // 3. Invalid JSON in project.json
    await expectRejected(
      zipSync({ ...validEntries, 'project.json': strToU8('{invalid-json') }),
      'ERR_ARCHIVE_INVALID',
    );

    // 4. Invalid schema
    const badSchema = JSON.parse(new TextDecoder().decode(validEntries['project.json'])) as Record<
      string,
      unknown
    >;
    badSchema.shot = { width: -10 };
    await expectRejected(
      zipSync({ ...validEntries, 'project.json': strToU8(JSON.stringify(badSchema)) }),
      'ERR_INVALID_SCHEMA',
    );

    // 5. Future schemaVersion
    const futureProj = structuredClone(project) as unknown as Record<string, unknown>;
    futureProj.schemaVersion = 999;
    await expectRejected(
      zipSync({ ...validEntries, 'project.json': strToU8(JSON.stringify(futureProj)) }),
      'ERR_UNSUPPORTED_VERSION',
    );

    // 6. Future formatVersion in manifest.json
    const badManifest = JSON.parse(
      new TextDecoder().decode(validEntries['manifest.json']),
    ) as Record<string, unknown>;
    badManifest.formatVersion = 999;
    await expectRejected(
      zipSync({ ...validEntries, 'manifest.json': strToU8(JSON.stringify(badManifest)) }),
      'ERR_UNSUPPORTED_VERSION',
    );

    // 7. Cyclic parentId in project.json
    const cyclicProj = structuredClone(project);
    cyclicProj.nodes['rig-root']!.parentId = 'hand';
    await expectRejected(
      zipSync({ ...validEntries, 'project.json': strToU8(JSON.stringify(cyclicProj)) }),
      'ERR_CYCLE_DETECTED',
    );

    // 8. Missing blob file
    const missingBlobEntries = { ...validEntries };
    delete missingBlobEntries['assets/blob-torso.png'];
    await expectRejected(zipSync(missingBlobEntries), /ERR_ARCHIVE_INVALID|ERR_MISSING_ASSET/);

    // 9. Tampered blob bytes (SHA-256 mismatch)
    await expectRejected(
      zipSync({
        ...validEntries,
        'assets/blob-torso.png': strToU8('corrupted-png-bytes'),
      }),
      /ERR_ARCHIVE_INVALID|ERR_INVALID_IMAGE/,
    );

    // 10. Path traversal entry
    await expectRejected(
      zipSync({
        ...validEntries,
        '../escape.txt': strToU8('evil'),
      }),
      'ERR_PATH_TRAVERSAL',
    );

    // 11. Missing assetId reference in a sprite node
    const missingAssetProj = structuredClone(project);
    missingAssetProj.nodes['torso']!.assetId = 'asset-does-not-exist';
    await expectRejected(
      zipSync({ ...validEntries, 'project.json': strToU8(JSON.stringify(missingAssetProj)) }),
      'ERR_MISSING_ASSET',
    );

    // 12. Non-image PNG payload with matching manifest SHA-256 checksum
    const corruptPng = strToU8('not-a-valid-png-stream');
    const corruptPngSha = await sha256Hex(corruptPng);
    const corruptManifest = JSON.parse(
      new TextDecoder().decode(validEntries['manifest.json']),
    ) as { blobs: Array<{ id: string; sha256: string; byteLength: number }> };
    const torsoEntry = corruptManifest.blobs.find((b) => b.id === 'blob-torso');
    if (torsoEntry) {
      torsoEntry.sha256 = corruptPngSha;
      torsoEntry.byteLength = corruptPng.byteLength;
    }
    await expectRejected(
      zipSync({
        ...validEntries,
        'manifest.json': strToU8(JSON.stringify(corruptManifest)),
        'assets/blob-torso.png': corruptPng,
      }),
      'ERR_INVALID_IMAGE',
    );

    // 13. Oversized / zip-bomb protection (exceeds DEFAULT_MAX_ENTRIES = 10_000)
    const manyEntries: Record<string, Uint8Array> = { ...validEntries };
    const tiny = strToU8('x');
    for (let i = 0; i < 10_005; i += 1) {
      manyEntries[`extra/${i}.txt`] = tiny;
    }
    await expectRejected(zipSync(manyEntries, { level: 0 }), 'ERR_ARCHIVE_LIMIT_EXCEEDED');
  });
});
