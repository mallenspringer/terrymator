import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../../src/application/store';
import { encodePngRgba } from '../../src/assets/pngCodec';
import { createSolidSquare } from '../../src/assets/synthetic';
import { AppError } from '../../src/domain/errors';
import { canonicalStringify, createBlankProject } from '../../src/domain/schema';
import { MemoryRecoveryStorage, RecoveryManager } from '../../src/persistence/recovery';

async function decodePngNode(bytes: Uint8Array) {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
}

describe('persistence/recovery', () => {
  it('saves, inspects, recovers, and discards recovery generations', async () => {
    const storage = new MemoryRecoveryStorage();
    const recovery = new RecoveryManager(storage);
    const store = new ProjectStore();
    store.load(createBlankProject({ id: 'rec-1', name: 'Recovery Test' }), new Map());

    const sq = createSolidSquare(16, 16, [255, 0, 128, 255]);
    const pngBytes = encodePngRgba(sq.rgba, 16, 16);
    await store.importSource({
      name: 'piece.png',
      bytes: pngBytes,
      mimeType: 'image/png',
      width: 16,
      height: 16,
      rgba: sq.rgba,
      sourceId: 'src-1',
      createInitialAsset: true,
      assetId: 'asset-1',
    });

    await recovery.saveSnapshot(store.snapshot(), store.getBlobs());
    const info = await recovery.inspect();
    expect(info).not.toBeNull();
    expect(info!.projectName).toBe('Recovery Test');

    const restored = await recovery.recover(decodePngNode);
    expect(canonicalStringify(restored.project)).toBe(canonicalStringify(store.snapshot()));

    await recovery.discard();
    expect(await recovery.inspect()).toBeNull();
  });

  it('preserves prior committed generation when a subsequent write fails', async () => {
    const storage = new MemoryRecoveryStorage();
    const recovery = new RecoveryManager(storage);
    const store = new ProjectStore();
    store.load(createBlankProject({ id: 'rec-2', name: 'Gen 1' }), new Map());

    await recovery.saveSnapshot(store.snapshot(), store.getBlobs());
    const gen1Snap = canonicalStringify(store.snapshot());

    store.dispatch({ type: 'SET_CAMERA', x: 999 });
    storage.faults.failOnPutGeneration = true;

    await expect(recovery.saveSnapshot(store.snapshot(), store.getBlobs())).rejects.toBeInstanceOf(
      AppError,
    );

    const recovered = await recovery.recover(decodePngNode);
    expect(canonicalStringify(recovered.project)).toBe(gen1Snap);
  });
});
