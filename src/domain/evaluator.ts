import { evaluateLoopTick, resolveApplicableLoop, sampleNodeTick } from './clock';
import { AppError } from './errors';
import {
  IDENTITY_AFFINE,
  applyAffineToPoint,
  composeLocalMatrix,
  multiplyAffine,
  validateTransform,
  type Affine2D,
  type Point2D,
} from './math';
import type {
  Asset,
  Key,
  NodeEffects,
  Project,
  SceneNode,
  TileParams,
  Track,
  TrackProperty,
  TransformType,
} from './schema';
import { TICKS_PER_SECOND } from './time';

export interface EvaluatedCamera {
  x: number;
  y: number;
  zoom: number;
  stageToOutput: Affine2D;
}

export interface EvaluatedDrawItem {
  nodeId: string;
  kind: 'sprite' | 'tile';
  assetId: string;
  assetRevision: number;
  blobId: string;
  assetWidth: number;
  assetHeight: number;
  anchorX: number;
  anchorY: number;
  drawOrder: number;
  opacity: number;
  locked: boolean;
  worldMatrix: Affine2D;
  effects: NodeEffects;
  tile?: TileParams;
}

export interface EvaluatedJoint {
  nodeId: string;
  name: string;
  kind: 'group' | 'sprite' | 'tile';
  parentId: string | null;
  worldPivot: Point2D;
  parentWorldPivot: Point2D | null;
  locked: boolean;
}

export interface EvaluatedScene {
  shotTick: number;
  shotWidth: number;
  shotHeight: number;
  background: {
    color: string;
    alpha: number;
  };
  globalShadowAngle: number;
  camera: EvaluatedCamera;
  drawList: EvaluatedDrawItem[];
  joints: EvaluatedJoint[];
}

export interface EvaluateOptions {
  outputWidth?: number;
  outputHeight?: number;
}

function interpolateNumber(k0: Key, k1: Key, tick: number, property: TrackProperty): number {
  const v0 = Number(k0.value);
  const v1 = Number(k1.value);
  if (k0.interpolation === 'hold' || property === 'drawOrder') {
    return v0;
  }
  if ((property === 'transform.sx' || property === 'transform.sy') && v0 * v1 < 0) {
    return v0;
  }
  const span = k1.tick - k0.tick;
  if (span <= 0) {
    return v1;
  }
  const u = Math.max(0, Math.min(1, (tick - k0.tick) / span));
  if (k0.interpolation === 'linear') {
    return v0 + (v1 - v0) * u;
  }
  const smoothU = u * u * (3 - 2 * u);
  return v0 + (v1 - v0) * smoothU;
}

function evaluateTrackNumber(track: Track | undefined, fallback: number, tick: number): number {
  if (!track || track.keys.length === 0) {
    return fallback;
  }
  const first = track.keys[0]!;
  if (tick <= first.tick) {
    return Number(first.value);
  }
  const last = track.keys[track.keys.length - 1]!;
  if (tick >= last.tick) {
    return Number(last.value);
  }
  for (let i = 0; i < track.keys.length - 1; i += 1) {
    const k0 = track.keys[i]!;
    const k1 = track.keys[i + 1]!;
    if (tick >= k0.tick && tick < k1.tick) {
      return interpolateNumber(k0, k1, tick, track.property);
    }
  }
  return Number(last.value);
}

function evaluateTrackBoolean(track: Track | undefined, fallback: boolean, tick: number): boolean {
  if (!track || track.keys.length === 0) {
    return fallback;
  }
  const first = track.keys[0]!;
  if (tick < first.tick) {
    return Boolean(first.value);
  }
  let chosen = first;
  for (const k of track.keys) {
    if (k.tick <= tick) {
      chosen = k;
    } else {
      break;
    }
  }
  return Boolean(chosen.value);
}

function buildTrackLookup(project: Project): Map<string, Track> {
  const map = new Map<string, Track>();
  for (const track of Object.values(project.tracks)) {
    const key = `${track.targetKind}:${track.targetId}:${track.property}`;
    map.set(key, track);
  }
  return map;
}

function topologicalOrder(nodes: Record<string, SceneNode>): SceneNode[] {
  const ordered: SceneNode[] = [];
  const state = new Map<string, 'visiting' | 'visited'>();

  const visit = (node: SceneNode): void => {
    const current = state.get(node.id);
    if (current === 'visited') {
      return;
    }
    if (current === 'visiting') {
      throw new AppError('ERR_CYCLE_DETECTED', `Cycle detected in node hierarchy at "${node.id}".`, {
        nodeId: node.id,
      });
    }
    state.set(node.id, 'visiting');
    if (node.parentId !== null) {
      const parent = nodes[node.parentId];
      if (!parent) {
        throw new AppError(
          'ERR_MISSING_PARENT',
          `Node "${node.id}" references missing parent "${node.parentId}".`,
          { nodeId: node.id, parentId: node.parentId },
        );
      }
      visit(parent);
    }
    state.set(node.id, 'visited');
    ordered.push(node);
  };

  for (const id of Object.keys(nodes).sort()) {
    const node = nodes[id]!;
    visit(node);
  }
  return ordered;
}

export function cutoutDerivedBlobKey(assetId: string, revision: number): string {
  return `derived-cutout:${assetId}@${revision}`;
}

function resolveAssetBlobId(project: Project, asset: Asset): string {
  if (asset.kind === 'synthetic-rgba') {
    return asset.blobId;
  }
  if (asset.kind === 'material') {
    if (asset.recipe.imageSourceId && !project.sources[asset.recipe.imageSourceId]) {
      throw new AppError(
        'ERR_MISSING_ASSET',
        `Material asset "${asset.id}" references missing source "${asset.recipe.imageSourceId}".`,
        { assetId: asset.id, sourceId: asset.recipe.imageSourceId },
      );
    }
    return asset.rasterBlobId;
  }
  const source = project.sources[asset.sourceId];
  if (!source) {
    throw new AppError(
      'ERR_MISSING_ASSET',
      `Cutout asset "${asset.id}" references missing source "${asset.sourceId}".`,
      { assetId: asset.id, sourceId: asset.sourceId },
    );
  }
  const needsComposite =
    asset.maskBlobId !== null ||
    asset.overlayBlobId !== null ||
    asset.editRect.x !== 0 ||
    asset.editRect.y !== 0 ||
    asset.editRect.width !== source.width ||
    asset.editRect.height !== source.height;
  return needsComposite ? cutoutDerivedBlobKey(asset.id, asset.revision) : source.blobId;
}

export function evaluateScene(
  project: Project,
  shotTick: number,
  options: EvaluateOptions = {},
): EvaluatedScene {
  if (!Number.isFinite(shotTick) || shotTick < 0) {
    throw new AppError('ERR_INVALID_RANGE', 'Evaluation shotTick must be a finite non-negative number.', {
      shotTick,
    });
  }

  const tracks = buildTrackLookup(project);
  const getTrack = (kind: 'node' | 'camera', targetId: string, prop: TrackProperty): Track | undefined =>
    tracks.get(`${kind}:${targetId}:${prop}`);

  const resolveTick = (
    kind: 'node' | 'camera',
    targetId: string,
    prop: TrackProperty,
    sampledTick: number,
  ): number => {
    const loop = resolveApplicableLoop(project, kind, targetId, prop);
    return loop ? evaluateLoopTick(sampledTick, loop) : sampledTick;
  };

  const camX = evaluateTrackNumber(
    getTrack('camera', 'camera', 'camera.x'),
    project.shot.camera.x,
    resolveTick('camera', 'camera', 'camera.x', shotTick),
  );
  const camY = evaluateTrackNumber(
    getTrack('camera', 'camera', 'camera.y'),
    project.shot.camera.y,
    resolveTick('camera', 'camera', 'camera.y', shotTick),
  );
  const camZoom = evaluateTrackNumber(
    getTrack('camera', 'camera', 'camera.zoom'),
    project.shot.camera.zoom,
    resolveTick('camera', 'camera', 'camera.zoom', shotTick),
  );
  if (!Number.isFinite(camZoom) || camZoom <= 0) {
    throw new AppError('ERR_SINGULAR_TRANSFORM', 'Camera zoom must be positive.', { camZoom });
  }

  const outWidth = options.outputWidth ?? project.shot.width;
  const outHeight = options.outputHeight ?? project.shot.height;
  const fitScale = Math.min(outWidth / project.shot.width, outHeight / project.shot.height);
  const totalScale = fitScale * camZoom;

  const stageToOutput: Affine2D = {
    a: totalScale,
    b: 0,
    c: 0,
    d: totalScale,
    tx: outWidth / 2 - camX * totalScale,
    ty: outHeight / 2 - camY * totalScale,
  };

  const orderedNodes = topologicalOrder(project.nodes);
  const worldMatrices = new Map<string, Affine2D>();
  const worldPivots = new Map<string, Point2D>();
  const effectiveVisible = new Map<string, boolean>();
  const effectiveOpacity = new Map<string, number>();

  const drawList: EvaluatedDrawItem[] = [];
  const joints: EvaluatedJoint[] = [];
  const timeSeconds = shotTick / TICKS_PER_SECOND;

  for (const node of orderedNodes) {
    const nodeSampledTick = sampleNodeTick(project, node.id, shotTick);
    const evalNum = (prop: TrackProperty, fallback: number): number =>
      evaluateTrackNumber(
        getTrack('node', node.id, prop),
        fallback,
        resolveTick('node', node.id, prop, nodeSampledTick),
      );
    const evalBool = (prop: TrackProperty, fallback: boolean): boolean =>
      evaluateTrackBoolean(
        getTrack('node', node.id, prop),
        fallback,
        resolveTick('node', node.id, prop, nodeSampledTick),
      );

    const transform: TransformType = {
      x: evalNum('transform.x', node.transform.x),
      y: evalNum('transform.y', node.transform.y),
      angle: evalNum('transform.angle', node.transform.angle),
      sx: evalNum('transform.sx', node.transform.sx),
      sy: evalNum('transform.sy', node.transform.sy),
      pivotX: evalNum('transform.pivotX', node.transform.pivotX),
      pivotY: evalNum('transform.pivotY', node.transform.pivotY),
    };
    validateTransform(transform);

    const localMatrix = composeLocalMatrix(transform);
    const parentWorld = node.parentId ? (worldMatrices.get(node.parentId) ?? IDENTITY_AFFINE) : IDENTITY_AFFINE;
    const worldMatrix = multiplyAffine(parentWorld, localMatrix);
    worldMatrices.set(node.id, worldMatrix);

    const worldPivot = applyAffineToPoint(worldMatrix, {
      x: transform.pivotX,
      y: transform.pivotY,
    });
    worldPivots.set(node.id, worldPivot);

    const parentVis = node.parentId ? (effectiveVisible.get(node.parentId) ?? true) : true;
    const localVis = evalBool('visible', node.visible);
    const visible = parentVis && localVis;
    effectiveVisible.set(node.id, visible);

    const parentOp = node.parentId ? (effectiveOpacity.get(node.parentId) ?? 1) : 1;
    const localOp = Math.max(0, Math.min(1, evalNum('opacity', node.opacity)));
    const opacity = parentOp * localOp;
    effectiveOpacity.set(node.id, opacity);

    if (visible) {
      joints.push({
        nodeId: node.id,
        name: node.name,
        kind: node.kind,
        parentId: node.parentId,
        worldPivot,
        parentWorldPivot: node.parentId ? (worldPivots.get(node.parentId) ?? null) : null,
        locked: node.locked,
      });
    }

    if (node.kind === 'group') {
      continue;
    }

    if (!node.assetId) {
      throw new AppError('ERR_MISSING_ASSET', `Rendered node "${node.id}" has no assetId.`, {
        nodeId: node.id,
      });
    }
    const asset = project.assets[node.assetId];
    if (!asset) {
      throw new AppError(
        'ERR_MISSING_ASSET',
        `Node "${node.id}" references missing asset "${node.assetId}".`,
        { nodeId: node.id, assetId: node.assetId },
      );
    }

    const blobId = resolveAssetBlobId(project, asset);

    if (!visible || opacity <= 0) {
      continue;
    }

    const drawOrder = Math.round(evalNum('drawOrder', node.drawOrder));

    const effects: NodeEffects = {
      dropShadow: {
        ...node.effects.dropShadow,
        opacity: Math.max(
          0,
          Math.min(1, evalNum('effects.dropShadow.opacity', node.effects.dropShadow.opacity)),
        ),
        distance: Math.max(
          0,
          evalNum('effects.dropShadow.distance', node.effects.dropShadow.distance),
        ),
      },
      outerGlow: {
        ...node.effects.outerGlow,
        intensity: Math.max(
          0,
          evalNum('effects.outerGlow.intensity', node.effects.outerGlow.intensity),
        ),
      },
      colorAdjust: { ...node.effects.colorAdjust },
    };

    let evaluatedTile: TileParams | undefined;
    if (node.kind === 'tile') {
      if (!node.tile) {
        throw new AppError('ERR_INVALID_SCHEMA', `Tile node "${node.id}" is missing tile parameters.`);
      }
      const baseOffX = evalNum('tile.offsetX', node.tile.offsetX);
      const baseOffY = evalNum('tile.offsetY', node.tile.offsetY);
      evaluatedTile = {
        ...node.tile,
        offsetX: baseOffX + node.tile.scrollRateX * timeSeconds,
        offsetY: baseOffY + node.tile.scrollRateY * timeSeconds,
      };
    }

    drawList.push({
      nodeId: node.id,
      kind: node.kind,
      assetId: asset.id,
      assetRevision: asset.revision,
      blobId,
      assetWidth: asset.width,
      assetHeight: asset.height,
      anchorX: asset.anchorX,
      anchorY: asset.anchorY,
      drawOrder,
      opacity,
      locked: node.locked,
      worldMatrix,
      effects,
      ...(evaluatedTile ? { tile: evaluatedTile } : {}),
    });
  }

  drawList.sort((a, b) => {
    if (a.drawOrder !== b.drawOrder) {
      return a.drawOrder - b.drawOrder;
    }
    return a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0;
  });

  return {
    shotTick,
    shotWidth: project.shot.width,
    shotHeight: project.shot.height,
    background: { ...project.shot.background },
    globalShadowAngle: project.shot.globalShadowAngle,
    camera: {
      x: camX,
      y: camY,
      zoom: camZoom,
      stageToOutput,
    },
    drawList,
    joints,
  };
}
