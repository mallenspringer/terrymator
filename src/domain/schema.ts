import { z } from 'zod';
import { AppError } from './errors';

const finiteNumber = z.number().finite();

export const RationalFpsSchema = z.object({
  num: z.number().int().positive(),
  den: z.number().int().positive(),
});

export const TransformSchema = z.object({
  x: finiteNumber,
  y: finiteNumber,
  angle: finiteNumber,
  sx: finiteNumber,
  sy: finiteNumber,
  pivotX: finiteNumber,
  pivotY: finiteNumber,
});

export const DropShadowEffectSchema = z.object({
  enabled: z.boolean(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  opacity: finiteNumber.min(0).max(1),
  distance: finiteNumber.min(0),
  softness: finiteNumber.min(0),
  useGlobalAngle: z.boolean(),
  angle: finiteNumber,
});

export const OuterGlowEffectSchema = z.object({
  enabled: z.boolean(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  intensity: finiteNumber.min(0).max(5),
  radius: finiteNumber.min(0).max(64),
});

export const ColorAdjustEffectSchema = z.object({
  enabled: z.boolean(),
  tint: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  tintAmount: finiteNumber.min(0).max(1),
  brightness: finiteNumber.min(-1).max(1),
  contrast: finiteNumber.min(-1).max(1),
});

export const NodeEffectsSchema = z.object({
  dropShadow: DropShadowEffectSchema,
  outerGlow: OuterGlowEffectSchema,
  colorAdjust: ColorAdjustEffectSchema,
});

export const TileParamsSchema = z.object({
  width: finiteNumber.positive(),
  height: finiteNumber.positive(),
  scaleX: finiteNumber.positive(),
  scaleY: finiteNumber.positive(),
  offsetX: finiteNumber,
  offsetY: finiteNumber,
  scrollRateX: finiteNumber,
  scrollRateY: finiteNumber,
  repeatX: z.boolean(),
  repeatY: z.boolean(),
  mirrorX: z.boolean(),
  mirrorY: z.boolean(),
});

export const NodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['group', 'sprite', 'tile']),
  parentId: z.string().min(1).nullable(),
  assetId: z.string().min(1).optional(),
  transform: TransformSchema,
  opacity: finiteNumber.min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
  drawOrder: z.number().int(),
  effects: NodeEffectsSchema,
  tile: TileParamsSchema.optional(),
});

export const AssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.literal('synthetic-rgba'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  anchorX: finiteNumber,
  anchorY: finiteNumber,
  blobId: z.string().min(1),
  revision: z.number().int().positive(),
});

export const InterpolationSchema = z.enum(['hold', 'linear', 'smooth']);

export const KeyValueSchema = z.union([finiteNumber, z.boolean()]);

export const KeySchema = z.object({
  tick: z.number().int().min(0),
  value: KeyValueSchema,
  interpolation: InterpolationSchema,
});

export const TrackPropertySchema = z.enum([
  'transform.x',
  'transform.y',
  'transform.angle',
  'transform.sx',
  'transform.sy',
  'transform.pivotX',
  'transform.pivotY',
  'opacity',
  'visible',
  'drawOrder',
  'tile.offsetX',
  'tile.offsetY',
  'effects.dropShadow.opacity',
  'effects.dropShadow.distance',
  'effects.outerGlow.intensity',
  'camera.x',
  'camera.y',
  'camera.zoom',
]);

export const TrackSchema = z.object({
  id: z.string().min(1),
  targetKind: z.enum(['node', 'camera']),
  targetId: z.string().min(1),
  property: TrackPropertySchema,
  keys: z.array(KeySchema),
});

export const ShotSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: RationalFpsSchema,
  durationTicks: z.number().int().positive(),
  defaultMotionRate: RationalFpsSchema,
  background: z.object({
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    alpha: finiteNumber.min(0).max(1),
  }),
  camera: z.object({
    x: finiteNumber,
    y: finiteNumber,
    zoom: finiteNumber.positive(),
  }),
  globalShadowAngle: finiteNumber,
});

export const ProjectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  revision: z.number().int().positive(),
  shot: ShotSchema,
  assets: z.record(z.string(), AssetSchema),
  nodes: z.record(z.string(), NodeSchema),
  tracks: z.record(z.string(), TrackSchema),
});

export type RationalFpsType = z.infer<typeof RationalFpsSchema>;
export type TransformType = z.infer<typeof TransformSchema>;
export type NodeEffects = z.infer<typeof NodeEffectsSchema>;
export type TileParams = z.infer<typeof TileParamsSchema>;
export type SceneNode = z.infer<typeof NodeSchema>;
export type SyntheticAsset = z.infer<typeof AssetSchema>;
export type Interpolation = z.infer<typeof InterpolationSchema>;
export type Key = z.infer<typeof KeySchema>;
export type TrackProperty = z.infer<typeof TrackPropertySchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Shot = z.infer<typeof ShotSchema>;
export type Project = z.infer<typeof ProjectSchema>;

export function defaultEffects(): NodeEffects {
  return {
    dropShadow: {
      enabled: false,
      color: '#000000',
      opacity: 0.5,
      distance: 8,
      softness: 4,
      useGlobalAngle: true,
      angle: 45,
    },
    outerGlow: {
      enabled: false,
      color: '#ffffff',
      intensity: 1,
      radius: 8,
    },
    colorAdjust: {
      enabled: false,
      tint: '#ffffff',
      tintAmount: 0,
      brightness: 0,
      contrast: 0,
    },
  };
}

export function validateProject(input: unknown): Project {
  const parsed = ProjectSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('ERR_INVALID_SCHEMA', parsed.error.issues[0]?.message ?? 'Invalid project schema.');
  }
  return parsed.data;
}

function sortCanonical(value: unknown): unknown {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new AppError('ERR_INVALID_SCHEMA', 'Non-finite number cannot be canonically serialized.');
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map(sortCanonical);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const child = record[key];
      if (child !== undefined) {
        sorted[key] = sortCanonical(child);
      }
    }
    return sorted;
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortCanonical(value));
}
