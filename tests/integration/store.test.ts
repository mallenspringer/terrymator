import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../../src/application/store';
import { AppError } from '../../src/domain/errors';
import { buildG0DemoFixture } from '../../src/test-harness/fixtures';

describe('application/store', () => {
  it('commits valid commands and increments revision', () => {
    const { project, blobs } = buildG0DemoFixture();
    const store = new ProjectStore();
    store.load(project, blobs);

    const updated = store.dispatch({
      type: 'SET_NODE_DRAW_ORDER',
      nodeId: 'arm',
      drawOrder: 35,
    });
    expect(updated.revision).toBe(2);
    expect(store.evaluate(0).drawList.map((d) => d.nodeId)).toEqual([
      'tile-bg',
      'torso',
      'hand',
      'arm',
      'fx-badge',
    ]);
  });

  it('rejects invalid commands without mutating committed state', () => {
    const { project, blobs } = buildG0DemoFixture();
    const store = new ProjectStore();
    store.load(project, blobs);

    expect(() =>
      store.dispatch({
        type: 'SET_NODE_TRANSFORM',
        nodeId: 'torso',
        transform: { sx: 0 },
      }),
    ).toThrow(AppError);

    expect(store.snapshot().revision).toBe(1);
    expect(store.snapshot().nodes['torso']!.transform.sx).toBe(1);
  });
});
