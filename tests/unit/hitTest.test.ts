import { describe, expect, it } from 'vitest';
import { evaluateScene } from '../../src/domain/evaluator';
import { hitTestScene } from '../../src/domain/hitTest';
import { buildG0DemoFixture } from '../../src/test-harness/fixtures';

describe('domain/hitTest', () => {
  it('respects reverse drawOrder priority and alpha checks', () => {
    const { project, blobs } = buildG0DemoFixture();
    const scene = evaluateScene(project, 0);

    const getAlphaAt = (blobId: string, px: number, py: number) => {
      const blob = blobs.get(blobId);
      if (!blob || px < 0 || py < 0 || px >= blob.width || py >= blob.height) return 0;
      return blob.rgba[(py * blob.width + px) * 4 + 3] ?? 0;
    };

    // At (185, 90): hand (drawOrder 30) overlaps torso (20) and arm (10)
    expect(hitTestScene(scene, { x: 185, y: 90 }, { getAlphaAt })).toBe('hand');

    // At (175, 90): torso (20) overlaps arm (10)
    expect(hitTestScene(scene, { x: 175, y: 90 }, { getAlphaAt })).toBe('torso');

    // At (205, 90): pure arm
    expect(hitTestScene(scene, { x: 205, y: 90 }, { getAlphaAt })).toBe('arm');

    // Empty background
    expect(hitTestScene(scene, { x: 315, y: 5 }, { getAlphaAt })).toBeNull();
  });

  it('skips locked nodes unless includeLocked is true', () => {
    const { project } = buildG0DemoFixture();
    project.nodes['hand']!.locked = true;
    const scene = evaluateScene(project, 0);

    expect(hitTestScene(scene, { x: 185, y: 90 })).toBe('torso');
    expect(hitTestScene(scene, { x: 185, y: 90 }, { includeLocked: true })).toBe('hand');
  });
});
