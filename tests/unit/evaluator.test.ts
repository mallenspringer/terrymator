import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { evaluateScene } from '../../src/domain/evaluator';
import { defaultEffects, type Project } from '../../src/domain/schema';
import { buildG0DemoFixture } from '../../src/test-harness/fixtures';

describe('domain/evaluator', () => {
  it('evaluates G0_DEMO with global drawOrder independent of hierarchy', () => {
    const { project } = buildG0DemoFixture();
    const scene = evaluateScene(project, 60_000);
    // drawOrder: tile-bg(0), arm(10), torso(20), hand(30), fx-badge(40)
    expect(scene.drawList.map((d) => d.nodeId)).toEqual([
      'tile-bg',
      'arm',
      'torso',
      'hand',
      'fx-badge',
    ]);
    // At 60,000 ticks (half of 120,000), arm angle is 45 deg
    const arm = scene.drawList.find((d) => d.nodeId === 'arm')!;
    expect(arm.worldMatrix.a).toBeCloseTo(Math.SQRT1_2, 5);
    expect(arm.worldMatrix.b).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('breaks equal drawOrder ties deterministically by nodeId ascending', () => {
    const { project } = buildG0DemoFixture();
    project.nodes['arm']!.drawOrder = 20;
    project.nodes['torso']!.drawOrder = 20;
    const scene = evaluateScene(project, 0);
    const idxArm = scene.drawList.findIndex((d) => d.nodeId === 'arm');
    const idxTorso = scene.drawList.findIndex((d) => d.nodeId === 'torso');
    expect(idxArm).toBeLessThan(idxTorso);
  });

  it('detects cycles and missing parents/assets', () => {
    const { project } = buildG0DemoFixture();
    const cycleProj: Project = structuredClone(project);
    cycleProj.nodes['torso']!.parentId = 'hand';
    expect(() => evaluateScene(cycleProj, 0)).toThrow(AppError);
    try {
      evaluateScene(cycleProj, 0);
    } catch (e) {
      expect((e as AppError).code).toBe('ERR_CYCLE_DETECTED');
    }

    const missingParentProj: Project = structuredClone(project);
    missingParentProj.nodes['arm']!.parentId = 'nope';
    expect(() => evaluateScene(missingParentProj, 0)).toThrowError(/missing parent/i);

    const missingAssetProj: Project = structuredClone(project);
    missingAssetProj.nodes['arm']!.assetId = 'nope-asset';
    expect(() => evaluateScene(missingAssetProj, 0)).toThrowError(/missing asset/i);
  });

  it('inherits visibility and multiplies opacity; holds opposite-sign scale flips', () => {
    const { project } = buildG0DemoFixture();
    project.nodes['rig-root']!.opacity = 0.5;
    project.nodes['torso']!.opacity = 0.5;
    project.tracks['trk-flip'] = {
      id: 'trk-flip',
      targetKind: 'node',
      targetId: 'torso',
      property: 'transform.sx',
      keys: [
        { tick: 0, value: 1, interpolation: 'linear' },
        { tick: 10_000, value: -1, interpolation: 'hold' },
      ],
    };
    const mid = evaluateScene(project, 5_000);
    const torsoMid = mid.drawList.find((d) => d.nodeId === 'torso')!;
    expect(torsoMid.opacity).toBeCloseTo(0.25, 6);
    expect(torsoMid.worldMatrix.a).toBe(1); // held, did not cross zero

    project.nodes['rig-root']!.visible = false;
    const hidden = evaluateScene(project, 0);
    expect(hidden.drawList.some((d) => d.nodeId === 'hand')).toBe(false);
    void defaultEffects;
  });
});
