import { strToU8, zipSync } from 'fflate';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { canonicalStringify } from '../../src/domain/schema';
import { packArchive, unpackArchive } from '../../src/persistence/zip';
import { buildG0DemoFixture } from '../../src/test-harness/fixtures';

async function decodePngNode(
  pngBytes: Uint8Array,
): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const png = PNG.sync.read(Buffer.from(pngBytes));
  return {
    width: png.width,
    height: png.height,
    rgba: new Uint8Array(png.data),
  };
}

describe('persistence/zip archive', () => {
  it('roundtrips project and blobs with exact canonical equality', async () => {
    const { project, blobs } = buildG0DemoFixture();
    const archiveBytes = await packArchive(project, blobs);
    const restored = await unpackArchive(archiveBytes, decodePngNode);

    expect(canonicalStringify(restored.project)).toBe(canonicalStringify(project));
    expect(restored.blobs.size).toBe(blobs.size);
    for (const [id, orig] of blobs.entries()) {
      const got = restored.blobs.get(id)!;
      expect(Buffer.compare(Buffer.from(got.pngBytes), Buffer.from(orig.pngBytes))).toBe(0);
    }
  });

  it('rejects path traversal entries', async () => {
    const badZip = zipSync({
      '../evil.txt': strToU8('nope'),
    });
    await expect(unpackArchive(badZip, decodePngNode)).rejects.toMatchObject({
      code: 'ERR_PATH_TRAVERSAL',
    });
  });

  it('rejects tampered blob hash mismatch', async () => {
    const { project, blobs } = buildG0DemoFixture();
    const archiveBytes = await packArchive(project, blobs);
    // Corrupt one byte inside the zip? Better: build a zip with mismatched manifest hash
    const fakeBytes = new Uint8Array([1, 2, 3, 4]);
    const badManifest = {
      kind: 'terrymator-project',
      formatVersion: 1,
      appVersion: '0.1.0',
      projectPath: 'project.json',
      blobs: [
        {
          id: 'blob-tile',
          path: 'assets/blob-tile.png',
          byteLength: fakeBytes.byteLength,
          mimeType: 'image/png',
          sha256: '0'.repeat(64),
          width: 48,
          height: 32,
        },
      ],
    };
    const tampered = zipSync({
      'manifest.json': strToU8(JSON.stringify(badManifest)),
      'project.json': strToU8(canonicalStringify(project)),
      'assets/blob-tile.png': fakeBytes,
    });
    await expect(unpackArchive(tampered, decodePngNode)).rejects.toBeInstanceOf(AppError);
    void archiveBytes;
  });

  it('rejects archives exceeding uncompressed byte limit (zip bomb guard)', async () => {
    const { project, blobs } = buildG0DemoFixture();
    const archiveBytes = await packArchive(project, blobs);
    await expect(
      unpackArchive(archiveBytes, decodePngNode, { maxTotalUncompressedBytes: 512 }),
    ).rejects.toMatchObject({
      code: 'ERR_ARCHIVE_LIMIT_EXCEEDED',
    });
  });
});
