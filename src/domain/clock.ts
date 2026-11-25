import { AppError } from './errors';
import type { LoopScope, Project, SceneNode, TrackProperty } from './schema';
import { TICKS_PER_SECOND, positiveMod, type RationalFps } from './time';

export type ResolvedSampling =
  | { mode: 'full-rate' }
  | { mode: 'fixed'; fps: RationalFps };

export function quantizeTickToFps(shotTick: number, fps: RationalFps): number {
  const stepIndex = Math.floor((shotTick * fps.num) / (TICKS_PER_SECOND * fps.den));
  return Math.round((stepIndex * TICKS_PER_SECOND * fps.den) / fps.num);
}

export function resolveNodeSampling(project: Project, nodeId: string): ResolvedSampling {
  let cursor: string | null = nodeId;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const node: SceneNode | undefined = project.nodes[cursor];
    if (!node) break;
    const ov = node.samplingOverride;
    if (ov && ov.mode !== 'inherit') {
      return ov;
    }
    cursor = node.parentId;
  }
  return { mode: 'fixed', fps: project.shot.defaultMotionRate };
}

export function sampleNodeTick(
  project: Project,
  nodeId: string,
  shotTick: number,
  outputFps?: RationalFps,
): number {
  const sampling = resolveNodeSampling(project, nodeId);
  if (sampling.mode === 'full-rate') {
    return outputFps ? quantizeTickToFps(shotTick, outputFps) : shotTick;
  }
  return quantizeTickToFps(shotTick, sampling.fps);
}

export function loopSelectorKey(
  loop: Pick<LoopScope, 'selectorKind' | 'targetKind' | 'targetId' | 'property'>,
): string {
  return `${loop.selectorKind}:${loop.targetKind}:${loop.targetId}:${loop.property ?? '*'}`;
}

/**
 * Resolves at most one applicable loop for a target property using strict priority:
 * explicit property loop > object loop > nearest ancestor group loop.
 */
export function resolveApplicableLoop(
  project: Project,
  targetKind: 'node' | 'camera',
  targetId: string,
  property: TrackProperty,
): LoopScope | null {
  const loops = Object.values(project.loopScopes);
  if (loops.length === 0) return null;

  if (targetKind === 'camera') {
    return (
      loops.find(
        (l) => l.selectorKind === 'property' && l.targetKind === 'camera' && l.property === property,
      ) ?? null
    );
  }

  const propLoop = loops.find(
    (l) =>
      l.selectorKind === 'property' &&
      l.targetKind === 'node' &&
      l.targetId === targetId &&
      l.property === property,
  );
  if (propLoop) return propLoop;

  const objLoop = loops.find(
    (l) => l.selectorKind === 'object' && l.targetKind === 'node' && l.targetId === targetId,
  );
  if (objLoop) return objLoop;

  let cursor: string | null = targetId;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const groupLoop = loops.find(
      (l) => l.selectorKind === 'group' && l.targetKind === 'node' && l.targetId === cursor,
    );
    if (groupLoop) return groupLoop;
    cursor = project.nodes[cursor]?.parentId ?? null;
  }

  return null;
}

export function evaluateLoopTick(sampledTick: number, loop: LoopScope): number {
  const L = loop.endTick - loop.startTick;
  if (!Number.isFinite(L) || L <= 0 || !Number.isFinite(loop.speed) || loop.speed <= 0) {
    throw new AppError('ERR_INVALID_RANGE', `Invalid loop bounds or speed on loop "${loop.id}".`);
  }

  if (sampledTick < loop.activationStartTick) {
    return sampledTick;
  }

  const phase = (sampledTick - loop.activationStartTick) * loop.speed + loop.offsetTicks;

  if (loop.mode === 'repeat') {
    const mapped = Math.round(loop.startTick + positiveMod(phase, L));
    return mapped >= loop.endTick ? loop.startTick : mapped;
  }

  if (loop.mode === 'ping-pong') {
    const cycle = positiveMod(phase, 2 * L);
    return Math.round(loop.startTick + L - Math.abs(cycle - L));
  }

  // once-and-hold
  const clamped = Math.max(0, Math.min(L, phase));
  return Math.round(loop.startTick + clamped);
}
