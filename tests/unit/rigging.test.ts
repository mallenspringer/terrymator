import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyCommand, createDefaultNode } from '../../src/domain/commands';
import { AppError } from '../../src/domain/errors';
import { evaluateScene } from '../../src/domain/evaluator';
import { applyAffineToPoint, composeLocalMatrix } from '../../src/domain/math';
import { createBlankProject } from '../../src/domain/schema';
import { buildF04JointedPuppet } from '../../src/test-harness/fixtures';

describe('domain/rigging (F04 & property invariants)', () => {
  it('compensates position on SET_NODE_PIVOT_PRESERVE_WORLD without moving rendered artwork', () => {
    const { project } = buildF04JointedPuppet();
    const before = evaluateScene(project, 0);
    const beforeArm = before.drawList.find((d) => d.nodeId === 'upper-arm')!;
    const cornerBefore = applyAffineToPoint(beforeArm.worldMatrix, { x: 10, y: 5 });

    const updated = applyCommand(project, {
      type: 'SET_NODE_PIVOT_PRESERVE_WORLD',
      nodeId: 'upper-arm',
      pivotX: 12,
      pivotY: -4,
    });
    const after = evaluateScene(updated, 0);
    const afterArm = after.drawList.find((d) => d.nodeId === 'upper-arm')!;
    const cornerAfter = applyAffineToPoint(afterArm.worldMatrix, { x: 10, y: 5 });

    expect(cornerAfter.x).toBeCloseTo(cornerBefore.x, 5);
    expect(cornerAfter.y).toBeCloseTo(cornerBefore.y, 5);
  });

  it('refuses preserve-world reparenting when non-uniform parent scale + child rotation introduces shear', () => {
    const { project } = buildF04JointedPuppet();
    let p = applyCommand(project, {
      type: 'SET_NODE_TRANSFORM',
      nodeId: 'torso',
      transform: { sx: 2, sy: 1 },
    });
    p = applyCommand(p, {
      type: 'ADD_NODE',
      node: {
        ...createDefaultNode({ id: 'prop', name: 'Prop', kind: 'group' }),
        transform: { x: 200, y: 100, angle: 30, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
      },
    });

    expect(() =>
      applyCommand(p, {
        type: 'REPARENT_NODE_PRESERVE_WORLD',
        nodeId: 'prop',
        parentId: 'torso',
      }),
    ).toThrow(AppError);

    try {
      applyCommand(p, {
        type: 'REPARENT_NODE_PRESERVE_WORLD',
        nodeId: 'prop',
        parentId: 'torso',
      });
    } catch (e) {
      expect((e as AppError).code).toBe('ERR_SHEAR_NOT_REPRESENTABLE');
    }
  });

  it('blocks preserve-world pivot/reparent on animated nodes unless allowAnimated is set', () => {
    const { project } = buildF04JointedPuppet();
    const animated = applyCommand(project, {
      type: 'UPSERT_KEY',
      trackId: 'trk-arm',
      targetKind: 'node',
      targetId: 'upper-arm',
      property: 'transform.angle',
      tick: 0,
      value: 15,
      interpolation: 'linear',
    });

    expect(() =>
      applyCommand(animated, {
        type: 'SET_NODE_PIVOT_PRESERVE_WORLD',
        nodeId: 'upper-arm',
        pivotX: 0,
        pivotY: 0,
      }),
    ).toThrowError(/animated/i);

    const allowed = applyCommand(animated, {
      type: 'SET_NODE_PIVOT_PRESERVE_WORLD',
      nodeId: 'upper-arm',
      pivotX: 0,
      pivotY: 0,
      allowAnimated: true,
    });
    expect(allowed.nodes['upper-arm']!.transform.pivotX).toBe(0);
  });

  it('duplicates full subtree with fresh IDs and preserved internal hierarchy', () => {
    const { project } = buildF04JointedPuppet();
    const dup = applyCommand(project, {
      type: 'DUPLICATE_SUBTREE',
      rootNodeId: 'upper-arm',
      idMap: {
        'upper-arm': 'upper-arm-2',
        forearm: 'forearm-2',
        hand: 'hand-2',
      },
      offsetX: 10,
      offsetY: 20,
    });

    expect(dup.nodes['upper-arm-2']!.parentId).toBe('torso');
    expect(dup.nodes['forearm-2']!.parentId).toBe('upper-arm-2');
    expect(dup.nodes['hand-2']!.parentId).toBe('forearm-2');
    expect(dup.nodes['hand-2']!.assetId).toBe('asset-f04-hand');
  });

  it('property: REPARENT_NODE_PRESERVE_WORLD preserves exact world transform for uniform parents', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -200, max: 200, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -200, max: 200, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.5, max: 2.5, noNaN: true, noDefaultInfinity: true }),
        fc.constantFrom(-1, 1),
        (px, py, pAngle, pScale, sxSign) => {
          let p = createBlankProject({ id: 'prop-rig' });
          p = applyCommand(p, {
            type: 'ADD_NODE',
            node: {
              ...createDefaultNode({ id: 'parent', name: 'Parent', kind: 'group' }),
              transform: {
                x: px,
                y: py,
                angle: pAngle,
                sx: pScale,
                sy: pScale,
                pivotX: 5,
                pivotY: -5,
              },
            },
          });
          p = applyCommand(p, {
            type: 'ADD_NODE',
            node: {
              ...createDefaultNode({ id: 'child', name: 'Child', kind: 'group' }),
              transform: {
                x: 40,
                y: -30,
                angle: 25,
                sx: 1.5 * sxSign,
                sy: 0.8,
                pivotX: 10,
                pivotY: 12,
              },
            },
          });

          const beforeWorld = composeLocalMatrix(p.nodes['child']!.transform);
          const beforePt = applyAffineToPoint(beforeWorld, { x: 17, y: -9 });

          const reparented = applyCommand(p, {
            type: 'REPARENT_NODE_PRESERVE_WORLD',
            nodeId: 'child',
            parentId: 'parent',
          });
          const afterScene = evaluateScene(reparented, 0);
          const childJoint = afterScene.joints.find((j) => j.nodeId === 'child')!;
          const parentWorld = composeLocalMatrix(reparented.nodes['parent']!.transform);
          const childLocal = composeLocalMatrix(reparented.nodes['child']!.transform);
          const afterPt = applyAffineToPoint(
            {
              a: parentWorld.a * childLocal.a + parentWorld.c * childLocal.b,
              b: parentWorld.b * childLocal.a + parentWorld.d * childLocal.b,
              c: parentWorld.a * childLocal.c + parentWorld.c * childLocal.d,
              d: parentWorld.b * childLocal.c + parentWorld.d * childLocal.d,
              tx: parentWorld.a * childLocal.tx + parentWorld.c * childLocal.ty + parentWorld.tx,
              ty: parentWorld.b * childLocal.tx + parentWorld.d * childLocal.ty + parentWorld.ty,
            },
            { x: 17, y: -9 },
          );

          expect(afterPt.x).toBeCloseTo(beforePt.x, 4);
          expect(afterPt.y).toBeCloseTo(beforePt.y, 4);
          expect(childJoint.parentId).toBe('parent');
        },
      ),
    );
  });
});
