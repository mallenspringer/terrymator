import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { UndoHistory } from '../../src/application/history';
import { applyCommand } from '../../src/domain/commands';
import { canonicalStringify, createBlankProject } from '../../src/domain/schema';

describe('application/history', () => {
  it('coalesces continuous drag edits into one undo step and clears redo on new edit', () => {
    const history = new UndoHistory();
    let p = createBlankProject({ id: 'p1', width: 640, height: 360 });
    const initial = p;

    const p1 = applyCommand(p, { type: 'SET_CAMERA', x: 330 });
    history.record('Pan', p, p1, 'drag-cam');
    p = p1;

    const p2 = applyCommand(p, { type: 'SET_CAMERA', x: 340 });
    history.record('Pan', p, p2, 'drag-cam');

    expect(history.stats().undoCount).toBe(1);
    const undone = history.undo()!;
    expect(undone.shot.camera.x).toBe(initial.shot.camera.x);
    expect(history.canRedo()).toBe(true);

    const p3 = applyCommand(undone, { type: 'SET_CAMERA', x: 400 });
    history.record('Set Cam', undone, p3);
    expect(history.canRedo()).toBe(false);
  });

  it('evicts oldest entries when maxEntries or maxBytes is exceeded', () => {
    const history = new UndoHistory({ maxEntries: 3, maxBytes: 100_000 });
    let p = createBlankProject({ id: 'p1' });
    for (let i = 0; i < 6; i += 1) {
      const next = applyCommand(p, { type: 'SET_CAMERA', x: i * 10 });
      history.record(`Step ${i}`, p, next);
      p = next;
    }
    expect(history.stats().undoCount).toBe(3);
    expect(history.stats().evictedCount).toBe(3);
  });

  it('property: undo then redo preserves exact canonical snapshot', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -500, max: 500 }), { minLength: 1, maxLength: 10 }),
        (xs) => {
          const history = new UndoHistory();
          let current = createBlankProject({ id: 'p-prop' });
          for (const x of xs) {
            const next = applyCommand(current, { type: 'SET_CAMERA', x });
            history.record('Move', current, next);
            current = next;
          }
          const finalSnap = canonicalStringify(current);
          while (history.canUndo()) {
            current = history.undo()!;
          }
          while (history.canRedo()) {
            current = history.redo()!;
          }
          expect(canonicalStringify(current)).toBe(finalSnap);
        },
      ),
    );
  });
});
