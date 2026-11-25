import { loopSelectorKey } from './clock';
import { AppError } from './errors';
import {
  IDENTITY_AFFINE,
  compensatePivotChange,
  composeLocalMatrix,
  decomposeAffineToTRS,
  invertAffine,
  multiplyAffine,
  validateTransform,
  type Affine2D,
} from './math';
import {
  AssetSchema,
  LoopScopeSchema,
  MaterialRecipeSchema,
  NodeEffectsSchema,
  NodeSchema,
  RationalFpsSchema,
  SamplingOverrideSchema,
  SourceSchema,
  TileParamsSchema,
  TrackSchema,
  TransformSchema,
  createBlankProject,
  defaultEffects,
  type Asset,
  type Interpolation,
  type LoopScope,
  type MaterialRecipe,
  type NodeEffects,
  type Project,
  type SamplingOverride,
  type SceneNode,
  type SourceRecord,
  type TileParams,
  type Track,
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
      type: 'COMMIT_CUTOUT_EDIT';
      assetId: string;
      editRect: { x: number; y: number; width: number; height: number };
      maskBlobId: string | null;
      overlayBlobId: string | null;
      anchorX: number;
      anchorY: number;
    }
  | {
      type: 'CREATE_MATERIAL_ASSET';
      assetId: string;
      name: string;
      recipe: MaterialRecipe;
      rasterBlobId: string;
    }
  | {
      type: 'UPDATE_MATERIAL_ASSET';
      assetId: string;
      recipe: MaterialRecipe;
      rasterBlobId: string;
      name?: string;
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
      type: 'SET_NODE_PIVOT_PRESERVE_WORLD';
      nodeId: string;
      pivotX: number;
      pivotY: number;
      allowAnimated?: boolean;
    }
  | {
      type: 'REPARENT_NODE_PRESERVE_WORLD';
      nodeId: string;
      parentId: string | null;
      allowAnimated?: boolean;
    }
  | {
      type: 'DUPLICATE_SUBTREE';
      rootNodeId: string;
      idMap: Record<string, string>;
      offsetX?: number;
      offsetY?: number;
    }
  | {
      type: 'SET_NODE_TILE_PARAMS';
      nodeId: string;
      tile: Partial<TileParams>;
    }
  | {
      type: 'IMPORT_PACKAGE_PAYLOAD';
      sources: SourceRecord[];
      assets: Asset[];
      nodes: SceneNode[];
      tracks: Track[];
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
    }
  | {
      type: 'DELETE_KEY';
      trackId: string;
      tick: number;
    }
  | {
      type: 'MOVE_KEY';
      trackId: string;
      fromTick: number;
      toTick: number;
      replaceExisting?: boolean;
    }
  | {
      type: 'DUPLICATE_KEY';
      trackId: string;
      fromTick: number;
      toTick: number;
      replaceExisting?: boolean;
    }
  | {
      type: 'SET_KEY_INTERPOLATION';
      trackId: string;
      tick: number;
      interpolation: Interpolation;
    }
  | {
      type: 'CAPTURE_POSE_KEYS';
      rootNodeId: string;
      tick: number;
      interpolation: Interpolation;
    }
  | {
      type: 'UPSERT_LOOP_SCOPE';
      loop: LoopScope;
    }
  | {
      type: 'DELETE_LOOP_SCOPE';
      loopId: string;
    }
  | {
      type: 'SET_NODE_SAMPLING';
      nodeId: string;
      samplingOverride: SamplingOverride;
    }
  | {
      type: 'SET_SHOT_TIMING';
      fps?: RationalFps;
      durationTicks?: number;
      defaultMotionRate?: RationalFps;
      workRange?: { inTick: number; outTick: number };
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

export function hasAnimatedTransform(project: Project, nodeId: string): boolean {
  for (const track of Object.values(project.tracks)) {
    if (
      track.targetKind === 'node' &&
      track.targetId === nodeId &&
      track.property.startsWith('transform.') &&
      track.keys.length > 0
    ) {
      return true;
    }
  }
  return false;
}

function computeBaseWorldMatrix(nodes: Record<string, SceneNode>, nodeId: string): Affine2D {
  const chain: SceneNode[] = [];
  let cursor: string | null = nodeId;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (seen.has(cursor)) {
      throw new AppError('ERR_CYCLE_DETECTED', `Cycle detected at "${cursor}".`);
    }
    seen.add(cursor);
    const n: SceneNode | undefined = nodes[cursor];
    if (!n) {
      throw new AppError('ERR_MISSING_PARENT', `Node "${cursor}" does not exist.`);
    }
    chain.push(n);
    cursor = n.parentId;
  }
  let m = IDENTITY_AFFINE;
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    m = multiplyAffine(m, composeLocalMatrix(chain[i]!.transform));
  }
  return m;
}

export function collectSubtreeNodeIds(project: Project, rootNodeId: string): string[] {
  if (!project.nodes[rootNodeId]) {
    throw new AppError('ERR_INVALID_COMMAND', `Unknown root node "${rootNodeId}".`);
  }
  const result: string[] = [];
  const visit = (id: string) => {
    result.push(id);
    const children = Object.values(project.nodes)
      .filter((n) => n.parentId === id)
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const child of children) {
      visit(child.id);
    }
  };
  visit(rootNodeId);
  return result;
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
    case 'COMMIT_CUTOUT_EDIT': {
      const asset = next.assets[command.assetId];
      if (!asset || asset.kind !== 'cutout') {
        throw new AppError('ERR_MISSING_ASSET', `Cutout asset "${command.assetId}" does not exist.`);
      }
      if (command.editRect.width <= 0 || command.editRect.height <= 0) {
        throw new AppError('ERR_INVALID_SCHEMA', 'editRect dimensions must be positive.');
      }
      asset.editRect = { ...command.editRect };
      asset.maskBlobId = command.maskBlobId;
      asset.overlayBlobId = command.overlayBlobId;
      asset.width = command.editRect.width;
      asset.height = command.editRect.height;
      asset.anchorX = command.anchorX;
      asset.anchorY = command.anchorY;
      asset.revision += 1;
      break;
    }
    case 'CREATE_MATERIAL_ASSET': {
      if (next.assets[command.assetId]) {
        throw new AppError('ERR_INVALID_COMMAND', `Asset "${command.assetId}" already exists.`);
      }
      const recipe = MaterialRecipeSchema.parse(command.recipe);
      if (recipe.imageSourceId && !next.sources[recipe.imageSourceId]) {
        throw new AppError(
          'ERR_MISSING_ASSET',
          `Material references missing source "${recipe.imageSourceId}".`,
        );
      }
      next.assets[command.assetId] = {
        id: command.assetId,
        name: command.name.trim() || 'Material',
        kind: 'material',
        recipe,
        rasterBlobId: command.rasterBlobId,
        width: recipe.width,
        height: recipe.height,
        anchorX: recipe.width / 2,
        anchorY: recipe.height / 2,
        revision: 1,
      };
      break;
    }
    case 'UPDATE_MATERIAL_ASSET': {
      const asset = next.assets[command.assetId];
      if (!asset || asset.kind !== 'material') {
        throw new AppError('ERR_MISSING_ASSET', `Material asset "${command.assetId}" does not exist.`);
      }
      const recipe = MaterialRecipeSchema.parse(command.recipe);
      if (recipe.imageSourceId && !next.sources[recipe.imageSourceId]) {
        throw new AppError(
          'ERR_MISSING_ASSET',
          `Material references missing source "${recipe.imageSourceId}".`,
        );
      }
      if (command.name !== undefined && command.name.trim().length > 0) {
        asset.name = command.name.trim();
      }
      asset.recipe = recipe;
      asset.rasterBlobId = command.rasterBlobId;
      asset.width = recipe.width;
      asset.height = recipe.height;
      asset.revision += 1;
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
    case 'SET_NODE_PIVOT_PRESERVE_WORLD': {
      const node = next.nodes[command.nodeId];
      if (!node) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown node "${command.nodeId}".`);
      }
      if (!command.allowAnimated && hasAnimatedTransform(next, command.nodeId)) {
        throw new AppError(
          'ERR_ANIMATED_TRANSFORM_LOCKED',
          `Cannot preserve-world change pivot on animated node "${command.nodeId}" without explicit override.`,
          { nodeId: command.nodeId },
        );
      }
      const nextTransform = compensatePivotChange(node.transform, command.pivotX, command.pivotY);
      validateTransform(nextTransform);
      node.transform = nextTransform;
      break;
    }
    case 'REPARENT_NODE_PRESERVE_WORLD': {
      const node = next.nodes[command.nodeId];
      if (!node) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown node "${command.nodeId}".`);
      }
      assertNoCycle(next.nodes, command.nodeId, command.parentId);
      if (!command.allowAnimated && hasAnimatedTransform(next, command.nodeId)) {
        throw new AppError(
          'ERR_ANIMATED_TRANSFORM_LOCKED',
          `Cannot preserve-world reparent animated node "${command.nodeId}" without explicit override.`,
          { nodeId: command.nodeId },
        );
      }
      const nodeWorld = computeBaseWorldMatrix(next.nodes, command.nodeId);
      const newParentWorld =
        command.parentId !== null
          ? computeBaseWorldMatrix(next.nodes, command.parentId)
          : IDENTITY_AFFINE;
      const desiredLocal = multiplyAffine(invertAffine(newParentWorld), nodeWorld);
      const decomposed = decomposeAffineToTRS(
        desiredLocal,
        node.transform.pivotX,
        node.transform.pivotY,
        Math.sign(node.transform.sx) || 1,
      );
      node.parentId = command.parentId;
      node.transform = decomposed;
      break;
    }
    case 'DUPLICATE_SUBTREE': {
      const subtreeIds = collectSubtreeNodeIds(next, command.rootNodeId);
      const maxOrder = Object.values(next.nodes).reduce(
        (max, n) => Math.max(max, n.drawOrder),
        0,
      );
      const minSubtreeOrder = subtreeIds.reduce(
        (min, id) => Math.min(min, next.nodes[id]!.drawOrder),
        Infinity,
      );
      const orderShift = maxOrder - minSubtreeOrder + 1;

      for (const oldId of subtreeIds) {
        const newId = command.idMap[oldId];
        if (!newId || next.nodes[newId]) {
          throw new AppError(
            'ERR_INVALID_COMMAND',
            `Invalid or colliding target ID "${newId ?? ''}" for subtree duplication.`,
          );
        }
      }

      for (const oldId of subtreeIds) {
        const orig = next.nodes[oldId]!;
        const newId = command.idMap[oldId]!;
        const copy = structuredClone(orig);
        copy.id = newId;
        copy.name = oldId === command.rootNodeId ? `${orig.name} Copy` : orig.name;
        copy.drawOrder = orig.drawOrder + orderShift;
        if (oldId === command.rootNodeId) {
          copy.parentId = orig.parentId;
          copy.transform.x += command.offsetX ?? 24;
          copy.transform.y += command.offsetY ?? 24;
        } else {
          copy.parentId = orig.parentId ? (command.idMap[orig.parentId] ?? orig.parentId) : null;
        }
        next.nodes[newId] = copy;
      }
      break;
    }
    case 'SET_NODE_TILE_PARAMS': {
      const node = next.nodes[command.nodeId];
      if (!node || node.kind !== 'tile' || !node.tile) {
        throw new AppError('ERR_INVALID_COMMAND', `Node "${command.nodeId}" is not a tile layer.`);
      }
      node.tile = TileParamsSchema.parse({ ...node.tile, ...command.tile });
      break;
    }
    case 'IMPORT_PACKAGE_PAYLOAD': {
      for (const src of command.sources) {
        const parsed = SourceSchema.parse(src);
        next.sources[parsed.id] = parsed;
      }
      for (const asset of command.assets) {
        const parsed = AssetSchema.parse(asset);
        next.assets[parsed.id] = parsed;
      }
      for (const node of command.nodes) {
        const parsed = NodeSchema.parse(node);
        validateTransform(parsed.transform);
        next.nodes[parsed.id] = parsed;
      }
      for (const track of command.tracks) {
        const parsed = TrackSchema.parse(track);
        next.tracks[parsed.id] = parsed;
      }
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
      if (command.property === 'visible' && typeof command.value !== 'boolean') {
        throw new AppError('ERR_INVALID_COMMAND', 'Visibility key requires a boolean value.');
      }
      if (
        command.property !== 'visible' &&
        (typeof command.value !== 'number' || !Number.isFinite(command.value))
      ) {
        throw new AppError('ERR_INVALID_COMMAND', `Property "${command.property}" requires a finite number.`);
      }
      const normalizedValue =
        command.property === 'drawOrder'
          ? Math.round(Number(command.value))
          : command.property === 'opacity'
            ? Math.max(0, Math.min(1, Number(command.value)))
            : command.value;

      const existing = next.tracks[command.trackId];
      if (existing) {
        const filtered = existing.keys.filter((k) => k.tick !== command.tick);
        filtered.push({
          tick: command.tick,
          value: normalizedValue,
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
              value: normalizedValue,
              interpolation: command.interpolation,
            },
          ],
        };
      }
      break;
    }
    case 'DELETE_KEY': {
      const track = next.tracks[command.trackId];
      if (!track) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown track "${command.trackId}".`);
      }
      track.keys = track.keys.filter((k) => k.tick !== command.tick);
      if (track.keys.length === 0) {
        delete next.tracks[command.trackId];
      }
      break;
    }
    case 'MOVE_KEY': {
      if (!Number.isInteger(command.toTick) || command.toTick < 0) {
        throw new AppError('ERR_INVALID_RANGE', 'Target tick must be a non-negative integer.');
      }
      const track = next.tracks[command.trackId];
      if (!track) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown track "${command.trackId}".`);
      }
      const src = track.keys.find((k) => k.tick === command.fromTick);
      if (!src) {
        throw new AppError('ERR_INVALID_COMMAND', `Key at tick ${command.fromTick} not found.`);
      }
      if (command.fromTick !== command.toTick) {
        const collision = track.keys.some((k) => k.tick === command.toTick);
        if (collision && !command.replaceExisting) {
          throw new AppError(
            'ERR_DUPLICATE_KEY',
            `A key already exists at tick ${command.toTick}.`,
            { tick: command.toTick },
          );
        }
        track.keys = track.keys.filter(
          (k) => k.tick !== command.fromTick && k.tick !== command.toTick,
        );
        track.keys.push({ ...src, tick: command.toTick });
        track.keys.sort((a, b) => a.tick - b.tick);
      }
      break;
    }
    case 'DUPLICATE_KEY': {
      if (!Number.isInteger(command.toTick) || command.toTick < 0) {
        throw new AppError('ERR_INVALID_RANGE', 'Target tick must be a non-negative integer.');
      }
      const track = next.tracks[command.trackId];
      if (!track) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown track "${command.trackId}".`);
      }
      const src = track.keys.find((k) => k.tick === command.fromTick);
      if (!src) {
        throw new AppError('ERR_INVALID_COMMAND', `Key at tick ${command.fromTick} not found.`);
      }
      const collision = track.keys.some((k) => k.tick === command.toTick);
      if (collision && !command.replaceExisting) {
        throw new AppError(
          'ERR_DUPLICATE_KEY',
          `A key already exists at tick ${command.toTick}.`,
          { tick: command.toTick },
        );
      }
      track.keys = track.keys.filter((k) => k.tick !== command.toTick);
      track.keys.push({ ...src, tick: command.toTick });
      track.keys.sort((a, b) => a.tick - b.tick);
      break;
    }
    case 'SET_KEY_INTERPOLATION': {
      const track = next.tracks[command.trackId];
      if (!track) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown track "${command.trackId}".`);
      }
      const key = track.keys.find((k) => k.tick === command.tick);
      if (!key) {
        throw new AppError('ERR_INVALID_COMMAND', `Key at tick ${command.tick} not found.`);
      }
      key.interpolation = command.interpolation;
      break;
    }
    case 'CAPTURE_POSE_KEYS': {
      if (!Number.isInteger(command.tick) || command.tick < 0) {
        throw new AppError('ERR_INVALID_RANGE', 'Pose tick must be a non-negative integer.');
      }
      const subtreeIds = collectSubtreeNodeIds(next, command.rootNodeId);
      const props = [
        'transform.x',
        'transform.y',
        'transform.angle',
        'transform.sx',
        'transform.sy',
        'transform.pivotX',
        'transform.pivotY',
      ] as const;

      for (const nodeId of subtreeIds) {
        const node = next.nodes[nodeId]!;
        for (const prop of props) {
          const field = prop.slice('transform.'.length) as keyof TransformType;
          const existingTrack = Object.values(next.tracks).find(
            (t) => t.targetKind === 'node' && t.targetId === nodeId && t.property === prop,
          );
          const trackId = existingTrack?.id ?? `trk-${nodeId}-${prop}`;
          const val = node.transform[field];
          if (existingTrack) {
            existingTrack.keys = existingTrack.keys.filter((k) => k.tick !== command.tick);
            existingTrack.keys.push({
              tick: command.tick,
              value: val,
              interpolation: command.interpolation,
            });
            existingTrack.keys.sort((a, b) => a.tick - b.tick);
          } else {
            next.tracks[trackId] = {
              id: trackId,
              targetKind: 'node',
              targetId: nodeId,
              property: prop,
              keys: [{ tick: command.tick, value: val, interpolation: command.interpolation }],
            };
          }
        }
      }
      break;
    }
    case 'UPSERT_LOOP_SCOPE': {
      const parsed = LoopScopeSchema.parse(command.loop);
      if (parsed.endTick <= parsed.startTick) {
        throw new AppError('ERR_INVALID_RANGE', 'Loop endTick must be greater than startTick.');
      }
      if (parsed.targetKind === 'camera' && parsed.selectorKind !== 'property') {
        throw new AppError(
          'ERR_INVALID_COMMAND',
          'Camera only supports property-level loop scopes.',
        );
      }
      if (parsed.targetKind === 'node' && !next.nodes[parsed.targetId]) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown loop target node "${parsed.targetId}".`);
      }
      const selKey = loopSelectorKey(parsed);
      for (const existing of Object.values(next.loopScopes)) {
        if (existing.id !== parsed.id && loopSelectorKey(existing) === selKey) {
          throw new AppError(
            'ERR_DUPLICATE_KEY',
            'A loop scope with the same selector already exists.',
          );
        }
      }
      next.loopScopes[parsed.id] = parsed;
      break;
    }
    case 'DELETE_LOOP_SCOPE': {
      if (!next.loopScopes[command.loopId]) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown loop scope "${command.loopId}".`);
      }
      delete next.loopScopes[command.loopId];
      break;
    }
    case 'SET_NODE_SAMPLING': {
      const node = next.nodes[command.nodeId];
      if (!node) {
        throw new AppError('ERR_INVALID_COMMAND', `Unknown node "${command.nodeId}".`);
      }
      node.samplingOverride = SamplingOverrideSchema.parse(command.samplingOverride);
      break;
    }
    case 'SET_SHOT_TIMING': {
      if (command.fps) {
        next.shot.fps = RationalFpsSchema.parse(command.fps);
      }
      if (command.defaultMotionRate) {
        next.shot.defaultMotionRate = RationalFpsSchema.parse(command.defaultMotionRate);
      }
      if (command.durationTicks !== undefined) {
        if (!Number.isInteger(command.durationTicks) || command.durationTicks <= 0) {
          throw new AppError('ERR_INVALID_RANGE', 'durationTicks must be a positive integer.');
        }
        next.shot.durationTicks = command.durationTicks;
      }
      if (command.workRange) {
        if (
          !Number.isInteger(command.workRange.inTick) ||
          !Number.isInteger(command.workRange.outTick) ||
          command.workRange.inTick < 0 ||
          command.workRange.outTick <= command.workRange.inTick ||
          command.workRange.outTick > next.shot.durationTicks
        ) {
          throw new AppError('ERR_INVALID_RANGE', 'Invalid workRange bounds.');
        }
        next.shot.workRange = { ...command.workRange };
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
  kind: 'group' | 'sprite' | 'tile';
  parentId?: string | null;
  assetId?: string;
  x?: number;
  y?: number;
  drawOrder?: number;
  tile?: TileParams;
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
    ...(params.tile ? { tile: params.tile } : {}),
  };
}
