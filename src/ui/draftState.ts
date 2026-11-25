import type { Command } from '../domain/commands';
import type { Interpolation, Project, TrackProperty } from '../domain/schema';

export interface PendingDraft {
  key: string;
  targetKind: 'node' | 'camera';
  targetId: string;
  property: TrackProperty;
  tick: number;
  value: number | boolean;
}

export function draftKey(
  targetKind: 'node' | 'camera',
  targetId: string,
  property: TrackProperty,
): string {
  return `${targetKind}:${targetId}:${property}`;
}

export function findTrack(
  project: Project,
  targetKind: 'node' | 'camera',
  targetId: string,
  property: TrackProperty,
) {
  return Object.values(project.tracks).find(
    (t) => t.targetKind === targetKind && t.targetId === targetId && t.property === property,
  );
}

export function hasExistingTrack(
  project: Project,
  targetKind: 'node' | 'camera',
  targetId: string,
  property: TrackProperty,
): boolean {
  const track = findTrack(project, targetKind, targetId, property);
  return Boolean(track && track.keys.length > 0);
}

export function upsertPendingDraft(
  drafts: PendingDraft[],
  incoming: Omit<PendingDraft, 'key'>,
): PendingDraft[] {
  const key = draftKey(incoming.targetKind, incoming.targetId, incoming.property);
  const filtered = drafts.filter((d) => d.key !== key);
  return [...filtered, { ...incoming, key }];
}

export function applyDraftsToPreviewProject(project: Project, drafts: PendingDraft[]): Project {
  if (drafts.length === 0) return project;
  const clone = structuredClone(project);
  for (const d of drafts) {
    const existing = findTrack(clone, d.targetKind, d.targetId, d.property);
    if (existing) {
      existing.keys = existing.keys.filter((k) => k.tick !== d.tick);
      existing.keys.push({ tick: d.tick, value: d.value, interpolation: 'linear' });
      existing.keys.sort((a, b) => a.tick - b.tick);
    }
  }
  return clone;
}

export function draftsToUpsertCommands(
  project: Project,
  drafts: PendingDraft[],
  defaultInterpolation: Interpolation = 'linear',
): Command[] {
  return drafts.map((d) => {
    const existing = findTrack(project, d.targetKind, d.targetId, d.property);
    return {
      type: 'UPSERT_KEY',
      trackId: existing?.id ?? `trk-${d.targetId}-${d.property}`,
      targetKind: d.targetKind,
      targetId: d.targetId,
      property: d.property,
      tick: d.tick,
      value: d.value,
      interpolation: defaultInterpolation,
    };
  });
}
