import { AppError } from './errors';
import { validateTransform } from './math';
import {
  NodeEffectsSchema,
  TransformSchema,
  type Interpolation,
  type NodeEffects,
  type Project,
  type TrackProperty,
  type TransformType,
} from './schema';

export type Command =
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

export function applyCommand(project: Project, command: Command): Project {
  const next: Project = structuredClone(project);

  switch (command.type) {
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
