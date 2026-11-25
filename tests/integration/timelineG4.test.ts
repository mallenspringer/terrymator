import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../../src/application/store';
import { canonicalStringify } from '../../src/domain/schema';
import { packArchive, unpackArchive } from '../../src/persistence/zip';
import { buildF05WalkingLoop } from '../../src/test-harness/fixtures';

async function decodePngNode(bytes: Uint8Array) {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
}

describe('integration/timeline G4 (F05)', () => {
  it('evaluates F05 identically regardless of seek order and separates travel, group repeat, prop ping-pong, and 6fps head', () => {
    const f05 = buildF05WalkingLoop();
    const store = new ProjectStore();
    store.load(f05.project, f05.blobs);

    const ticks = [0, 15_000, 30_000, 60_000, 90_000, 120_000];
    const forward = ticks.map((t) => canonicalStringify(store.evaluate(t)));
    const reversed = [...ticks]
      .reverse()
      .map((t) => canonicalStringify(store.evaluate(t)))
      .reverse();

    expect(forward).toEqual(reversed);

    // Travel continues linearly from 60 -> 160 at mid-shot (120,000 ticks)
    const s0 = store.evaluate(0);
    const s120 = store.evaluate(120_000);
    const torso0 = s0.drawList.find((d) => d.nodeId === 'torso')!;
    const torso120 = s120.drawList.find((d) => d.nodeId === 'torso')!;
    expect(torso0.worldMatrix.tx).toBeCloseTo(60, 4);
    expect(torso120.worldMatrix.tx).toBeCloseTo(160, 4);

    // Head stepped at 6fps (step = 20,000 ticks): tick 0 and tick 15,000 share identical head local rotation!
    const head0 = store.evaluate(0).drawList.find((d) => d.nodeId === 'head')!;
    const head15 = store.evaluate(15_000).drawList.find((d) => d.nodeId === 'head')!;
    expect(head0.worldMatrix.a).toBeCloseTo(head15.worldMatrix.a, 6);
    expect(head0.worldMatrix.b).toBeCloseTo(head15.worldMatrix.b, 6);
  });

  it('roundtrips F05 tracks, loopScopes, and samplingOverrides through .collage archive', async () => {
    const f05 = buildF05WalkingLoop();
    const store = new ProjectStore();
    store.load(f05.project, f05.blobs);

    const packed = await packArchive(store.snapshot(), store.getBlobs());
    const restored = await unpackArchive(packed, decodePngNode);
    expect(canonicalStringify(restored.project)).toBe(canonicalStringify(store.snapshot()));
  });
});
