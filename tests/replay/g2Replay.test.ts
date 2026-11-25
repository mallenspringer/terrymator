import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectStore, type ReplayLog } from '../../src/application/store';
import { loadFixtureById } from '../../src/test-harness/fixtures';

describe('replay/g2_assets_replay', () => {
  it('replays G2 cutout commit, node move, and make-unique deterministically', async () => {
    const raw = fs.readFileSync(
      path.resolve('tests/fixtures/replays/g2_assets_replay.json'),
      'utf8',
    );
    const log = JSON.parse(raw) as ReplayLog;

    const runOnce = async () => {
      const store = new ProjectStore();
      const fixture = loadFixtureById(log.fixtureId);
      store.load(fixture.project, fixture.blobs);
      return store.replay(log);
    };

    const r1 = await runOnce();
    const r2 = await runOnce();

    expect(r1.ok).toBe(true);
    expect(r1.commandsApplied).toBe(3);
    expect(r1.checkpointsChecked).toBe(1);
    expect(r1.finalSnapshotHash).toBe(r2.finalSnapshotHash);
  });
});
