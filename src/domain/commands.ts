import { AppError } from './errors';
import { validateTransform } from './math';
import {
  NodeEffectsSchema,
  NodeSchema,
  SourceSchema,
  TransformSchema,
  createBlankProject,
  defaultEffects,
  type Interpolation,
  type NodeEffects,
  type Project,
  type SceneNode,
  type SourceRecord,
  type TrackProperty,
  type TransformType,
} from './schema';
import type { RationalFps } from './time';

export type Command =
  | {
      type: 'NEW_SHOT';
      projectId?: string;
      name?: string;
      width?: number;
      height?: number;
      fps?: RationalFps;
      durationTicks?: number;
      background?: { color: string; alpha: number };
    }
  | {
      type: 'ADD_SOURCE';
      source: SourceRecord;
    }
  | {
      type: 'UPDATE_SOURCE_META';
      sourceId: string;
      name?: string;
      attribution?: string;
      sourceUrl?: string;
    }
  | {
      type: 'CREATE_CUTOUT_ASSET';
      assetId: string;
      sourceId: string;
      name: string;
    }
  | {
      type: 'RENAME_ASSET';
      assetId: string;
      name: string;
    }
  | {
      type: 'MAKE_ASSET_UNIQUE';
      nodeId: string;
      newAssetId: string;
      newName?: string;
    }
  | {
      type: 'DELETE_ASSET';
      assetId: string;
    }
  | {
      type: 'ADD_NODE';
      node: SceneNode;
    }
  | {
      type: 'DUPLICATE_NODE';
      sourceNodeId: string;
      newNodeId: string;
      newName?: string;
      offsetX?: number;
      offsetY?: number;
    }
  | {
      type: 'DELETE_NODE';
      nodeId: string;
    }
  | {
      type: 'RENAME_NODE';
      nodeId: string;
      name: string;
    }
  | {
      type: 'SET_NODE_LOCKED';
      nodeId: string;
      locked: boolean;
    }
  | {
      type: 'SET_NODE_PARENT';
      nodeId: string;
      parentId: string | null;
    }
  | {
      type: 'SET_NODE_TRANSFORM';
      nodeId: string;
      transform: Partial<TransformType>;
    }
  | {
      type: 'SET_NODE_DRAW_ORDER';
      nodeId: string;
      drawOrder: number;
    }
  | {
      type: 'SET_NODE_VISIBILITY';
      nodeId: string;
      visible: boolean;
    }
  | {
      type: 'SET_NODE_OPACITY';
      nodeId: string;
      opacity: number;
    }
  | {
      type: 'SET_NODE_EFFECTS';
      nodeId: string;
      effects: NodeEffects;
    }
  | {
      type: 'SET_CAMERA';
      x?: number;
      y?: number;
      zoom?: number;
    }
  | {
      type: 'SET_SHOT_BACKGROUND';
      color: string;
      alpha: number;
    }
  | {
      type: 'UPSERT_KEY';
      trackId: string;
      targetKind: 'node' | 'camera';
      targetId: string;
      property: TrackProperty;
      tick: number;
      value: number | boolean;
      interpolation: Interpolation;
    };

function assertNoCycle(nodes: Record<string, SceneNode>, nodeId: string, parentId: string | null): void {
  let cursor = parentId;
  const seen = new Set<string>([nodeId]);
  while (cursor !== null) {
    if (seen.has(cursor)) {
      throw new AppError('ERR_CYCLE_DETECTED', `Reparenting "${nodeId}" under "${parentId}" creates a cycle.`, {
        nodeId,
        parentId,
      });
    }
    seen.add(cursor);
    const parent = nodes[cursor];
    if (!parent) {
      throw new AppError('ERR_MISSING_PARENT', `Parent node "${cursor}" does not exist.`, {
        parentId: cursor,
      });
    }
    cursor = parent.parentId;
  }
}

export function applyCommand(project: Project, command: Command): Project {
  if (command.type === 'NEW_SHOT') {
    return createBlankProject({
      id: command.projectId,
      name: command.name,
      width: command.width,
      height: command.height,
      fps: command.fps,
      durationTicks: command.durationTicks,
      background: command.background,
    });
  }

  const next: Project = structuredClone(project);

  switch (command.type) {
    case 'ADD_SOURCE': {
      const parsed = SourceSchema.parse(command.source);
      next.sources[parsed.id] = parsed;
      break;
    }
    case 'UPDATE_SOURCE_META': {
      const src = next.sources[command.sourceId];
      if (!src) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown source "${command.sourceId}".`);
      }
      if (command.name !== undefined && command.name.trim().length > 0) {
        src.name = command.name.trim();
      }
      if (command.attribution !== undefined) {
        src.attribution = command.attribution;
      }
      if (command.sourceUrl !== undefined) {
        src.sourceUrl = command.sourceUrl;
      }
      break;
    }
    case 'CREATE_CUTOUT_ASSET': {
      const src = next.sources[command.sourceId];
      if (!src) {
        throw new AppError('ERR_MISSING_ASSET', `Source "${command.sourceId}" does not exist.`);
      }
      if (next.assets[command.assetId]) {
        throw new AppError('ERR_INVALID_COMMAND', `Asset "${command.assetId}" already exists.`);
      }
      next.assets[command.assetId] = {
        id: command.assetId,
        name: command.name,
        kind: 'cutout',
        sourceId: src.id,
        editRect: { x: 0, y: 0, width: src.width, height: src.height },
        maskBlobId: null,
        overlayBlobId: null,
        width: src.width,
        height: src.height,
        anchorX: src.width / 2,
        anchorY: src.height / 2,
        revision: 1,
      };
      break;
    }
    case 'RENAME_ASSET': {
      const asset = next.assets[command.assetId];
      if (!asset) {
        throw new AppError('ERR_MISSING_ASSET', `Unknown asset "${command.assetId}".`);
      }
      if (command.name.trim().length === 0) {
        throw new AppError('ERR_INVALID_COMMAND', 'Asset name cannot be empty.');
      }
      asset.name = command.name.trim();
      break;
    }
    case 'MAKE_ASSET_UNIQUE': {
      const node = next.nodes[command.nodeId];
      if (!node || !node.assetId) {
        throw new AppError('ERR_INVALID_COMMAND', `Node "${command.nodeId}" has no asset to make unique.`);
      }
      const orig = next.assets[node.assetId];
      if (!orig) {
        throw new AppError('ERR_MISSING_ASSET', `Asset "${node.assetId}" not found.`);
      }
      if (next.assets[command.newAssetId]) {
        throw new AppError('ERR_INVALID_COMMAND', `Asset "${command.newAssetId}" already exists.`);
      }
      const clone = structuredClone(orig);
      clone.id = command.newAssetId;
      clone.name = command.newName ?? `${orig.name} (Unique)`;
      clone.revision = 1;
      next.assets[clone.id] = clone;
      node.assetId = clone.id;
      break;
    }
    case 'DELETE_ASSET': {
      if (!next.assets[command.assetId]) {
        throw new AppError('ERR_MISSING_ASSET', `Unknown asset "${command.assetId}".`);
      }
      const refs = Object.values(next.nodes).filter((n) => n.assetId === command.assetId);
      if (refs.length > 0) {
        throw new AppError(
          'ERR_ASSET_IN_USE',
          `Cannot delete asset "${command.assetId}" because ${refs.length} stage layer(s) still reference it.`,
          { assetId: command.assetId, refCount: refs.length },
        );
      }
      delete next.assets[command.assetId];
      break;
    }
    case 'ADD_NODE': {
      const parsed = NodeSchema.parse(command.node);
      if (next.nodes[parsed.id]) {
        throw new AppError('ERR_INVALID_COMMAND', `Node "${parsed.id}" already exists.`);
      }
      validateTransform(parsed.transform);
      if (parsed.parentId !== null && !next.nodes[parsed.parentId]) {
        throw new AppError('ERR_MISSING_PARENT', `Parent node "${parsed.parentId}" does not exist.`);
      }
      if (parsed.kind !== 'group') {
        if (!parsed.assetId || !next.assets[parsed.assetId]) {
          throw new AppError('ERR_MISSING_ASSET', `Node "${parsed.id}" references missing asset.`);
        }
      }
      next.nodes[parsed.id] = parsed;
      break;
    }
    case 'DUPLICATE_NODE': {
      const orig = next.nodes[command.sourceNodeId];
      if (!orig) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown node "${command.sourceNodeId}".`);
      }
      if (next.nodes[command.newNodeId]) {
        throw new AppError('ERR_INVALID_COMMAND', `Node "${command.newNodeId}" already exists.`);
      }
      const copy = structuredClone(orig);
      copy.id = command.newNodeId;
      copy.name = command.newName ?? `${orig.name} Copy`;
      copy.transform.x += command.offsetX ?? 24;
      copy.transform.y += command.offsetY ?? 24;
      copy.drawOrder = orig.drawOrder + 1;
      next.nodes[copy.id] = copy;
      break;
    }
    case 'DELETE_NODE': {
      const target = next.nodes[command.nodeId];
      if (!target) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown node "${command.nodeId}".`);
      }
      for (const child of Object.values(next.nodes)) {
        if (child.parentId === command.nodeId) {
          child.parentId = target.parentId;
        }
      }
      delete next.nodes[command.nodeId];
      for (const [trackId, track] of Object.entries(next.tracks)) {
        if (track.targetKind === 'node' && track.targetId === command.nodeId) {
          delete next.tracks[trackId];
        }
      }
      break;
    }
    case 'RENAME_NODE': {
      const node = next.nodes[command.nodeId];
      if (!node) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown node "${command.nodeId}".`);
      }
      if (command.name.trim().length === 0) {
        throw new AppError('ERR_INVALID_COMMAND', 'Node name cannot be empty.');
      }
      node.name = command.name.trim();
      break;
    }
    case 'SET_NODE_LOCKED': {
      const node = next.nodes[command.nodeId];
      if (!node) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown node "${command.nodeId}".`);
      }
      node.locked = command.locked;
      break;
    }
    case 'SET_NODE_PARENT': {
      const node = next.nodes[command.nodeId];
      if (!node) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown node "${command.nodeId}".`);
      }
      assertNoCycle(next.nodes, command.nodeId, command.parentId);
      node.parentId = command.parentId;
      break;
    }
    case 'SET_NODE_TRANSFORM': {
      const node = next.nodes[command.nodeId];
      if (!node) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown node "${command.nodeId}".`);
      }
      const merged = TransformSchema.parse({ ...node.transform, ...command.transform });
      validateTransform(merged);
      node.transform = merged;
      break;
    }
    case 'SET_NODE_DRAW_ORDER': {
      const node = next.nodes[command.nodeId];
      if (!node) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown node "${command.nodeId}".`);
      }
      if (!Number.isInteger(command.drawOrder)) {
        throw new AppError('ERR_INVALID_COMMAND', 'drawOrder must be an integer.');
      }
      node.drawOrder = command.drawOrder;
      break;
    }
    case 'SET_NODE_VISIBILITY': {
      const node = next.nodes[command.nodeId];
      if (!node) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown node "${command.nodeId}".`);
      }
      node.visible = command.visible;
      break;
    }
    case 'SET_NODE_OPACITY': {
      const node = next.nodes[command.nodeId];
      if (!node) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown node "${command.nodeId}".`);
      }
      if (!Number.isFinite(command.opacity) || command.opacity < 0 || command.opacity > 1) {
        throw new AppError('ERR_INVALID_COMMAND', 'Opacity must be between 0 and 1.');
      }
      node.opacity = command.opacity;
      break;
    }
    case 'SET_NODE_EFFECTS': {
      const node = next.nodes[command.nodeId];
      if (!node) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown node "${command.nodeId}".`);
      }
      node.effects = NodeEffectsSchema.parse(command.effects);
      break;
    }
    case 'SET_CAMERA': {
      const zoom = command.zoom ?? next.shot.camera.zoom;
      if (!Number.isFinite(zoom) || zoom <= 0) {
        throw new AppError('ERR_SINGULAR_TRANSFORM', 'Camera zoom must be positive.');
      }
      next.shot.camera = {
        x: command.x ?? next.shot.camera.x,
        y: command.y ?? next.shot.camera.y,
        zoom,
      };
      break;
    }
    case 'SET_SHOT_BACKGROUND': {
      if (!/^#[0-9a-fA-F]{6}$/.test(command.color) || command.alpha < 0 || command.alpha > 1) {
        throw new AppError('ERR_INVALID_COMMAND', 'Invalid shot background.');
      }
      next.shot.background = { color: command.color, alpha: command.alpha };
      break;
    }
    case 'UPSERT_KEY': {
      if (!Number.isInteger(command.tick) || command.tick < 0) {
        throw new AppError('ERR_INVALID_RANGE', 'Key tick must be a non-negative integer.');
      }
      if (command.targetKind === 'node' && !next.nodes[command.targetId]) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown target node "${command.targetId}".`);
      }
      const existing = next.tracks[command.trackId];
      if (existing) {
        const filtered = existing.keys.filter((k) => k.tick !== command.tick);
        filtered.push({
          tick: command.tick,
          value: command.value,
          interpolation: command.interpolation,
        });
        filtered.sort((a, b) => a.tick - b.tick);
        existing.keys = filtered;
      } else {
        next.tracks[command.trackId] = {
          id: command.trackId,
          targetKind: command.targetKind,
          targetId: command.targetId,
          property: command.property,
          keys: [
            {
              tick: command.tick,
              value: command.value,
              interpolation: command.interpolation,
            },
          ],
        };
      }
      break;
    }
  }

  next.revision += 1;
  return next;
}

export function createDefaultNode(params: {
  id: string;
  name: string;
  kind: 'group' | 'sprite';
  parentId?: string | null;
  assetId?: string;
  x?: number;
  y?: number;
  drawOrder?: number;
}): SceneNode {
  return {
    id: params.id,
    name: params.name,
    kind: params.kind,
    parentId: params.parentId ?? null,
    ...(params.assetId ? { assetId: params.assetId } : {}),
    transform: {
      x: params.x ?? 0,
      y: params.y ?? 0,
      angle: 0,
      sx: 1,
      sy: 1,
      pivotX: 0,
      pivotY: 0,
    },
    opacity: 1,
    visible: true,
    locked: false,
    drawOrder: params.drawOrder ?? 0,
    effects: defaultEffects(),
  };
}
