import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  evaluateLoopTick,
  quantizeTickToFps,
  resolveApplicableLoop,
  sampleNodeTick,
} from '../../src/domain/clock';
import { applyCommand } from '../../src/domain/commands';
import { AppError } from '../../src/domain/errors';
import type { LoopScope } from '../../src/domain/schema';
import {
  applyDraftsToPreviewProject,
  draftsToUpsertCommands,
  hasExistingTrack,
  upsertPendingDraft,
} from '../../src/ui/draftState';
import { buildF04JointedPuppet, buildF05WalkingLoop } from '../../src/test-harness/fixtures';

describe('domain/clock & loop semantics (G4)', () => {
  it('evaluates repeat boundaries a, b-1, b and negative phase', () => {
    const loop: LoopScope = {
      id: 'l1',
      selectorKind: 'object',
      targetKind: 'node',
      targetId: 'n1',
      startTick: 10_000,
      endTick: 40_000,
      activationStartTick: 0,
      speed: 1,
      offsetTicks: 0,
      mode: 'repeat',
    };
    expect(evaluateLoopTick(10_000, loop)).toBe(20_000); // phase=10_000 -> 10k + 10k
    expect(evaluateLoopTick(0, loop)).toBe(10_000);
    expect(evaluateLoopTick(29_999, loop)).toBe(39_999);
    expect(evaluateLoopTick(30_000, loop)).toBe(10_000); // wraps at L=30_000

    const negLoop: LoopScope = { ...loop, offsetTicks: -5_000 };
    expect(evaluateLoopTick(0, negLoop)).toBe(35_000); // mod(-5000, 30000) = 25000 -> 10k + 25k
  });

  it('evaluates ping-pong turnaround and once-and-hold activation boundary', () => {
    const pp: LoopScope = {
      id: 'pp',
      selectorKind: 'object',
      targetKind: 'node',
      targetId: 'n1',
      startTick: 0,
      endTick: 30_000,
      activationStartTick: 0,
      speed: 1,
      offsetTicks: 0,
      mode: 'ping-pong',
    };
    expect(evaluateLoopTick(0, pp)).toBe(0);
    expect(evaluateLoopTick(30_000, pp)).toBe(30_000);
    expect(evaluateLoopTick(45_000, pp)).toBe(15_000);
    expect(evaluateLoopTick(60_000, pp)).toBe(0);

    const once: LoopScope = { ...pp, mode: 'once-and-hold', activationStartTick: 20_000 };
    expect(evaluateLoopTick(10_000, once)).toBe(10_000); // before activation -> shot time
    expect(evaluateLoopTick(35_000, once)).toBe(15_000); // 15k into loop
    expect(evaluateLoopTick(90_000, once)).toBe(30_000); // held at endTick
  });

  it('enforces scope priority property > object > nearest group and rejects duplicate selector', () => {
    const { project } = buildF05WalkingLoop();
    expect(resolveApplicableLoop(project, 'node', 'arm', 'transform.angle')!.id).toBe(
      'loop-arm-prop',
    );
    expect(resolveApplicableLoop(project, 'node', 'torso', 'transform.y')!.id).toBe(
      'loop-puppet-group',
    );
    expect(resolveApplicableLoop(project, 'node', 'travel-root', 'transform.x')).toBeNull();

    expect(() =>
      applyCommand(project, {
        type: 'UPSERT_LOOP_SCOPE',
        loop: {
          ...project.loopScopes['loop-arm-prop']!,
          id: 'duplicate-selector',
        },
      }),
    ).toThrow(AppError);
  });

  it('quantizes sampling rates and inherits nearest ancestor override', () => {
    const { project } = buildF05WalkingLoop();
    // 6 fps => 20,000 ticks/step
    expect(quantizeTickToFps(15_000, { num: 6, den: 1 })).toBe(0);
    expect(quantizeTickToFps(25_000, { num: 6, den: 1 })).toBe(20_000);
    expect(sampleNodeTick(project, 'head', 25_000)).toBe(20_000);
    // travel-root is full-rate
    expect(sampleNodeTick(project, 'travel-root', 12_345)).toBe(12_345);
  });

  it('property: evaluateLoopTick always lands within [startTick, endTick]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000 }),
        fc.integer({ min: 1, max: 50_000 }),
        fc.integer({ min: 0, max: 300_000 }),
        fc.integer({ min: -50_000, max: 50_000 }),
        fc.double({ min: 0.25, max: 4, noNaN: true, noDefaultInfinity: true }),
        fc.constantFrom<'repeat' | 'ping-pong' | 'once-and-hold'>(
          'repeat',
          'ping-pong',
          'once-and-hold',
        ),
        (start, len, tick, offset, speed, mode) => {
          const end = start + len;
          const loop: LoopScope = {
            id: 'prop-loop',
            selectorKind: 'object',
            targetKind: 'node',
            targetId: 'n1',
            startTick: start,
            endTick: end,
            activationStartTick: 0,
            speed,
            offsetTicks: offset,
            mode,
          };
          const out = evaluateLoopTick(tick, loop);
          expect(out).toBeGreaterThanOrEqual(start);
          if (mode === 'repeat') {
            expect(out).toBeLessThan(end);
          } else {
            expect(out).toBeLessThanOrEqual(end);
          }
        },
      ),
    );
  });

  it('handles MOVE_KEY, DUPLICATE_KEY collisions, and CAPTURE_POSE_KEYS subtree isolation', () => {
    const { project } = buildF04JointedPuppet();
    let p = applyCommand(project, {
      type: 'CAPTURE_POSE_KEYS',
      rootNodeId: 'upper-arm',
      tick: 0,
      interpolation: 'linear',
    });
    // Subtree has upper-arm, forearm, hand (NOT torso or camera!)
    const targetedNodes = new Set(Object.values(p.tracks).map((t) => t.targetId));
    expect(targetedNodes.has('upper-arm')).toBe(true);
    expect(targetedNodes.has('forearm')).toBe(true);
    expect(targetedNodes.has('hand')).toBe(true);
    expect(targetedNodes.has('torso')).toBe(false);
    expect(targetedNodes.has('camera')).toBe(false);

    const trkId = Object.keys(p.tracks)[0]!;
    p = applyCommand(p, { type: 'DUPLICATE_KEY', trackId: trkId, fromTick: 0, toTick: 10_000 });
    expect(() =>
      applyCommand(p, { type: 'MOVE_KEY', trackId: trkId, fromTick: 0, toTick: 10_000 }),
    ).toThrow(AppError);

    p = applyCommand(p, {
      type: 'MOVE_KEY',
      trackId: trkId,
      fromTick: 0,
      toTick: 10_000,
      replaceExisting: true,
    });
    expect(p.tracks[trkId]!.keys.map((k) => k.tick)).toEqual([10_000]);
  });

  it('stages pending drafts without mutating committed project until committed', () => {
    const { project } = buildF05WalkingLoop();
    expect(hasExistingTrack(project, 'node', 'travel-root', 'transform.x')).toBe(true);

    const drafts = upsertPendingDraft([], {
      targetKind: 'node',
      targetId: 'travel-root',
      property: 'transform.x',
      tick: 60_000,
      value: 222,
    });
    const preview = applyDraftsToPreviewProject(project, drafts);
    const prevKey = preview.tracks['trk-travel-x']!.keys.find((k) => k.tick === 60_000);
    expect(prevKey?.value).toBe(222);
    // Committed project unchanged
    expect(project.tracks['trk-travel-x']!.keys.find((k) => k.tick === 60_000)).toBeUndefined();

    const cmds = draftsToUpsertCommands(project, drafts, 'linear');
    expect(cmds).toHaveLength(1);
    const committed = applyCommand(project, cmds[0]!);
    expect(committed.tracks['trk-travel-x']!.keys.find((k) => k.tick === 60_000)?.value).toBe(222);
  });
});
