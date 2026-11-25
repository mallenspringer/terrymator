import { encodePngRgba } from '../assets/pngCodec';
import { createCutoutSprite, createSolidSquare, createTilePattern } from '../assets/synthetic';
import { AppError } from '../domain/errors';
import { defaultEffects, type Project } from '../domain/schema';
import { TICKS_PER_SECOND } from '../domain/time';
import type { BlobRecord } from '../persistence/zip';

export type FixtureId = 'G0_DEMO' | 'F09_EXPORT_CLOCK';

export interface LoadedFixture {
  project: Project;
  blobs: Map<string, BlobRecord>;
}

function makeBlob(
  id: string,
  img: { width: number; height: number; rgba: Uint8Array },
): BlobRecord {
  const pngBytes = encodePngRgba(img.rgba, img.width, img.height);
  return {
    id,
    role: 'asset',
    mimeType: 'image/png',
    bytes: pngBytes,
    sha256: '0'.repeat(64),
    width: img.width,
    height: img.height,
    rgba: img.rgba,
  };
}

export function buildG0DemoFixture(): LoadedFixture {
  const blobs = new Map<string, BlobRecord>();

  const tileImg = createTilePattern(48, 32);
  blobs.set('blob-tile', makeBlob('blob-tile', tileImg));

  const torsoImg = createCutoutSprite(64, 64, {
    tl: [200, 60, 60],
    tr: [220, 80, 80],
    bl: [180, 50, 50],
    br: [200, 70, 70],
    border: [240, 120, 120],
  });
  blobs.set('blob-torso', makeBlob('blob-torso', torsoImg));

  const armImg = createSolidSquare(48, 24, [60, 180, 90, 255]);
  blobs.set('blob-arm', makeBlob('blob-arm', armImg));

  const handImg = createSolidSquare(24, 24, [70, 130, 240, 255]);
  blobs.set('blob-hand', makeBlob('blob-hand', handImg));

  const badgeImg = createCutoutSprite(40, 40, {
    tl: [240, 200, 40],
    tr: [240, 200, 40],
    bl: [240, 200, 40],
    br: [240, 200, 40],
    border: [255, 255, 160],
  });
  blobs.set('blob-badge', makeBlob('blob-badge', badgeImg));

  const fxBadgeEffects = defaultEffects();
  fxBadgeEffects.dropShadow = {
    enabled: true,
    color: '#000000',
    opacity: 0.9,
    distance: 12,
    softness: 2,
    useGlobalAngle: true,
    angle: 0,
  };
  fxBadgeEffects.outerGlow = {
    enabled: true,
    color: '#00ffff',
    intensity: 1.5,
    radius: 6,
  };

  const project: Project = {
    schemaVersion: 1,
    id: 'proj-g0-demo',
    name: 'G0 Demo Shot',
    revision: 1,
    shot: {
      width: 320,
      height: 180,
      fps: { num: 24, den: 1 },
      durationTicks: TICKS_PER_SECOND * 2,
      defaultMotionRate: { num: 12, den: 1 },
      background: { color: '#1b1f2a', alpha: 0 },
      camera: { x: 160, y: 90, zoom: 1 },
      globalShadowAngle: 45,
    },
    sources: {},
    assets: {
      'asset-tile': {
        id: 'asset-tile',
        name: 'Tile Pattern',
        kind: 'synthetic-rgba',
        width: tileImg.width,
        height: tileImg.height,
        anchorX: 0,
        anchorY: 0,
        blobId: 'blob-tile',
        revision: 1,
      },
      'asset-torso': {
        id: 'asset-torso',
        name: 'Torso',
        kind: 'synthetic-rgba',
        width: torsoImg.width,
        height: torsoImg.height,
        anchorX: 32,
        anchorY: 32,
        blobId: 'blob-torso',
        revision: 1,
      },
      'asset-arm': {
        id: 'asset-arm',
        name: 'Arm',
        kind: 'synthetic-rgba',
        width: armImg.width,
        height: armImg.height,
        anchorX: 8,
        anchorY: 12,
        blobId: 'blob-arm',
        revision: 1,
      },
      'asset-hand': {
        id: 'asset-hand',
        name: 'Hand',
        kind: 'synthetic-rgba',
        width: handImg.width,
        height: handImg.height,
        anchorX: 12,
        anchorY: 12,
        blobId: 'blob-hand',
        revision: 1,
      },
      'asset-badge': {
        id: 'asset-badge',
        name: 'FX Badge',
        kind: 'synthetic-rgba',
        width: badgeImg.width,
        height: badgeImg.height,
        anchorX: 20,
        anchorY: 20,
        blobId: 'blob-badge',
        revision: 1,
      },
    },
    nodes: {
      'tile-bg': {
        id: 'tile-bg',
        name: 'Tile Background',
        kind: 'tile',
        parentId: null,
        assetId: 'asset-tile',
        transform: { x: 0, y: 0, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
        opacity: 1,
        visible: true,
        locked: false,
        drawOrder: 0,
        effects: defaultEffects(),
        tile: {
          width: 140,
          height: 120,
          scaleX: 1,
          scaleY: 1,
          offsetX: -12,
          offsetY: -8,
          scrollRateX: 24,
          scrollRateY: 0,
          repeatX: true,
          repeatY: true,
          mirrorX: true,
          mirrorY: false,
        },
      },
      'rig-root': {
        id: 'rig-root',
        name: 'Puppet Root',
        kind: 'group',
        parentId: null,
        transform: { x: 160, y: 90, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
        opacity: 1,
        visible: true,
        locked: false,
        drawOrder: 5,
        effects: defaultEffects(),
      },
      torso: {
        id: 'torso',
        name: 'Torso',
        kind: 'sprite',
        parentId: 'rig-root',
        assetId: 'asset-torso',
        transform: { x: 0, y: 0, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
        opacity: 1,
        visible: true,
        locked: false,
        drawOrder: 20,
        effects: defaultEffects(),
      },
      arm: {
        id: 'arm',
        name: 'Arm (Behind Torso)',
        kind: 'sprite',
        parentId: 'torso',
        assetId: 'asset-arm',
        transform: { x: 10, y: 0, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
        opacity: 1,
        visible: true,
        locked: false,
        drawOrder: 10,
        effects: defaultEffects(),
      },
      hand: {
        id: 'hand',
        name: 'Hand (In Front)',
        kind: 'sprite',
        parentId: 'arm',
        assetId: 'asset-hand',
        transform: { x: 20, y: 0, angle: 0, sx: -1, sy: 1, pivotX: 0, pivotY: 0 },
        opacity: 1,
        visible: true,
        locked: false,
        drawOrder: 30,
        effects: defaultEffects(),
      },
      'fx-badge': {
        id: 'fx-badge',
        name: 'FX Badge',
        kind: 'sprite',
        parentId: null,
        assetId: 'asset-badge',
        transform: { x: 260, y: 90, angle: 90, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
        opacity: 1,
        visible: true,
        locked: false,
        drawOrder: 40,
        effects: fxBadgeEffects,
      },
    },
    tracks: {
      'trk-arm-angle': {
        id: 'trk-arm-angle',
        targetKind: 'node',
        targetId: 'arm',
        property: 'transform.angle',
        keys: [
          { tick: 0, value: 0, interpolation: 'linear' },
          { tick: TICKS_PER_SECOND, value: 90, interpolation: 'hold' },
        ],
      },
    },
  };

  return { project, blobs };
}

export function buildF09ExportClockFixture(): LoadedFixture {
  const blobs = new Map<string, BlobRecord>();

  const yellow = createSolidSquare(32, 32, [255, 220, 0, 255]);
  const semi = createSolidSquare(32, 32, [0, 200, 255, 128]);
  const red = createSolidSquare(16, 16, [255, 0, 0, 255]);
  const green = createSolidSquare(16, 16, [0, 255, 0, 255]);
  const blue = createSolidSquare(16, 16, [0, 0, 255, 255]);

  blobs.set('blob-yellow', makeBlob('blob-yellow', yellow));
  blobs.set('blob-semi', makeBlob('blob-semi', semi));
  blobs.set('blob-red', makeBlob('blob-red', red));
  blobs.set('blob-green', makeBlob('blob-green', green));
  blobs.set('blob-blue', makeBlob('blob-blue', blue));

  const project: Project = {
    schemaVersion: 1,
    id: 'proj-f09-clock',
    name: 'F09 Export Clock',
    revision: 1,
    shot: {
      width: 320,
      height: 180,
      fps: { num: 24, den: 1 },
      durationTicks: TICKS_PER_SECOND / 2, // 60,000 ticks = 12 frames @ 24 fps
      defaultMotionRate: { num: 24, den: 1 },
      background: { color: '#10141e', alpha: 0 },
      camera: { x: 160, y: 90, zoom: 1 },
      globalShadowAngle: 45,
    },
    sources: {},
    assets: {
      'asset-yellow': {
        id: 'asset-yellow',
        name: 'Yellow Clock Block',
        kind: 'synthetic-rgba',
        width: 32,
        height: 32,
        anchorX: 0,
        anchorY: 0,
        blobId: 'blob-yellow',
        revision: 1,
      },
      'asset-semi': {
        id: 'asset-semi',
        name: 'Semi Block',
        kind: 'synthetic-rgba',
        width: 32,
        height: 32,
        anchorX: 0,
        anchorY: 0,
        blobId: 'blob-semi',
        revision: 1,
      },
      'asset-red': {
        id: 'asset-red',
        name: 'Cal Red',
        kind: 'synthetic-rgba',
        width: 16,
        height: 16,
        anchorX: 0,
        anchorY: 0,
        blobId: 'blob-red',
        revision: 1,
      },
      'asset-green': {
        id: 'asset-green',
        name: 'Cal Green',
        kind: 'synthetic-rgba',
        width: 16,
        height: 16,
        anchorX: 0,
        anchorY: 0,
        blobId: 'blob-green',
        revision: 1,
      },
      'asset-blue': {
        id: 'asset-blue',
        name: 'Cal Blue',
        kind: 'synthetic-rgba',
        width: 16,
        height: 16,
        anchorX: 0,
        anchorY: 0,
        blobId: 'blob-blue',
        revision: 1,
      },
    },
    nodes: {
      'cal-tl': {
        id: 'cal-tl',
        name: 'Cal TL',
        kind: 'sprite',
        parentId: null,
        assetId: 'asset-red',
        transform: { x: 4, y: 4, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
        opacity: 1,
        visible: true,
        locked: false,
        drawOrder: 1,
        effects: defaultEffects(),
      },
      'cal-bl': {
        id: 'cal-bl',
        name: 'Cal BL',
        kind: 'sprite',
        parentId: null,
        assetId: 'asset-green',
        transform: { x: 4, y: 160, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
        opacity: 1,
        visible: true,
        locked: false,
        drawOrder: 2,
        effects: defaultEffects(),
      },
      'cal-br': {
        id: 'cal-br',
        name: 'Cal BR',
        kind: 'sprite',
        parentId: null,
        assetId: 'asset-blue',
        transform: { x: 300, y: 160, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
        opacity: 1,
        visible: true,
        locked: false,
        drawOrder: 3,
        effects: defaultEffects(),
      },
      'square-a': {
        id: 'square-a',
        name: 'Moving Yellow Square',
        kind: 'sprite',
        parentId: null,
        assetId: 'asset-yellow',
        transform: { x: 24, y: 40, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
        opacity: 1,
        visible: true,
        locked: false,
        drawOrder: 10,
        effects: defaultEffects(),
      },
      'square-semi': {
        id: 'square-semi',
        name: 'Moving Semi Square',
        kind: 'sprite',
        parentId: null,
        assetId: 'asset-semi',
        transform: { x: 140, y: 20, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
        opacity: 1,
        visible: true,
        locked: false,
        drawOrder: 20,
        effects: defaultEffects(),
      },
    },
    tracks: {
      'trk-sq-a-x': {
        id: 'trk-sq-a-x',
        targetKind: 'node',
        targetId: 'square-a',
        property: 'transform.x',
        keys: [
          { tick: 0, value: 24, interpolation: 'linear' },
          { tick: 55_000, value: 266, interpolation: 'hold' },
        ],
      },
      'trk-sq-semi-y': {
        id: 'trk-sq-semi-y',
        targetKind: 'node',
        targetId: 'square-semi',
        property: 'transform.y',
        keys: [
          { tick: 0, value: 20, interpolation: 'linear' },
          { tick: 55_000, value: 130, interpolation: 'hold' },
        ],
      },
    },
  };

  return { project, blobs };
}

export function loadFixtureById(id: string): LoadedFixture {
  switch (id) {
    case 'G0_DEMO':
      return buildG0DemoFixture();
    case 'F09_EXPORT_CLOCK':
      return buildF09ExportClockFixture();
    default:
      throw new AppError('ERR_UNKNOWN_FIXTURE', `Unknown fixture ID: "${id}".`);
  }
}
