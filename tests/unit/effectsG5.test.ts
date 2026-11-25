import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/domain/commands';
import { evaluateScene } from '../../src/domain/evaluator';
import { defaultEffects } from '../../src/domain/schema';
import { buildF07Lighting, buildG0DemoFixture } from '../../src/test-harness/fixtures';

describe('unit/effectsG5', () => {
  it('updates shot.globalShadowAngle via SET_GLOBAL_SHADOW_ANGLE and rejects non-finite values', () => {
    const { project } = buildF07Lighting();
    expect(project.shot.globalShadowAngle).toBe(0);

    const updated = applyCommand(project, { type: 'SET_GLOBAL_SHADOW_ANGLE', angle: 135 });
    expect(updated.shot.globalShadowAngle).toBe(135);
    expect(updated.revision).toBe(project.revision + 1);

    expect(() =>
      applyCommand(project, { type: 'SET_GLOBAL_SHADOW_ANGLE', angle: Number.NaN }),
    ).toThrow(/globalShadowAngle must be finite/);
  });

  it('batch-applies NodeEffects to an entire group subtree via BATCH_SET_GROUP_EFFECTS', () => {
    const { project } = buildG0DemoFixture();
    const customFx = defaultEffects();
    customFx.dropShadow = {
      enabled: true,
      color: '#112233',
      opacity: 0.75,
      distance: 14,
      softness: 4,
      useGlobalAngle: false,
      angle: 60,
    };
    customFx.colorAdjust = {
      enabled: true,
      tint: '#ff00aa',
      tintAmount: 0.5,
      brightness: 0.1,
      contrast: -0.1,
    };

    const next = applyCommand(project, {
      type: 'BATCH_SET_GROUP_EFFECTS',
      rootNodeId: 'rig-root',
      effects: customFx,
    });

    expect(next.nodes['rig-root']!.effects).toEqual(customFx);
    expect(next.nodes['torso']!.effects).toEqual(customFx);
    expect(next.nodes['arm']!.effects).toEqual(customFx);
    expect(next.nodes['hand']!.effects).toEqual(customFx);
    // Unrelated node outside the group should remain unchanged
    expect(next.nodes['tile-bg']!.effects.dropShadow.enabled).toBe(false);
  });

  it('propagates SET_NODE_EFFECTS and globalShadowAngle into evaluated scene output', () => {
    const { project } = buildF07Lighting();
    const fx = defaultEffects();
    fx.outerGlow = { enabled: true, color: '#00aaff', intensity: 2.5, radius: 12 };

    const updated = applyCommand(project, {
      type: 'SET_NODE_EFFECTS',
      nodeId: 'node-global-shadow',
      effects: fx,
    });
    const angled = applyCommand(updated, { type: 'SET_GLOBAL_SHADOW_ANGLE', angle: -45 });

    const evaluated = evaluateScene(angled, 0);
    expect(evaluated.globalShadowAngle).toBe(-45);
    const item = evaluated.drawList.find((r) => r.nodeId === 'node-global-shadow');
    expect(item?.effects.outerGlow.enabled).toBe(true);
    expect(item?.effects.outerGlow.color).toBe('#00aaff');
  });
});
