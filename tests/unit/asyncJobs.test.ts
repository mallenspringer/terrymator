import { describe, expect, it } from 'vitest';
import { AsyncJobGuard } from '../../src/application/asyncJobs';
import { createBlankProject } from '../../src/domain/schema';

describe('application/asyncJobs stale-result guard', () => {
  it('ignores older async job after a newer job or revision/project change', async () => {
    const guard = new AsyncJobGuard();
    let project = createBlankProject({ id: 'proj-a' });
    project.assets['a1'] = {
      id: 'a1',
      name: 'Cutout',
      kind: 'cutout',
      sourceId: 's1',
      editRect: { x: 0, y: 0, width: 32, height: 32 },
      maskBlobId: null,
      overlayBlobId: null,
      width: 32,
      height: 32,
      anchorX: 16,
      anchorY: 16,
      revision: 1,
    };

    const committed: string[] = [];
    let resolveSlow!: (v: string) => void;
    const slowPromise = new Promise<string>((r) => {
      resolveSlow = r;
    });

    const slowRun = guard.runGuarded(
      'cutout:a1',
      () => project,
      'a1',
      () => slowPromise,
      (val) => committed.push(val),
    );

    const fastRun = await guard.runGuarded(
      'cutout:a1',
      () => project,
      'a1',
      async () => 'fast-result',
      (val) => committed.push(val),
    );
    expect(fastRun).toEqual({ committed: true, stale: false });

    // Now resolve the slow older job -> must be ignored!
    resolveSlow('slow-stale-result');
    expect(await slowRun).toEqual({ committed: false, stale: true });
    expect(committed).toEqual(['fast-result']);

    // Also test project switch invalidation
    const token = guard.begin('cutout:a1', project, 'a1');
    project = createBlankProject({ id: 'proj-b' });
    expect(guard.isCurrent(token, project)).toBe(false);
  });
});
