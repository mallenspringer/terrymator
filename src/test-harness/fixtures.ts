import {
  compositeCutoutAsset,
  maskToPngBytes,
  type EditRect,
} from '../assets/cutting';
import { synthesizeMaterial } from '../assets/materialSynthesis';
import { encodePngRgba } from '../assets/pngCodec';
import { createCutoutSprite, createSolidSquare, createTilePattern } from '../assets/synthetic';
import { AppError } from '../domain/errors';
import {
  createBlankProject,
  createDefaultMaterialRecipe,
  defaultEffects,
  type MaterialRecipe,
  type Project,
} from '../domain/schema';
import { TICKS_PER_SECOND } from '../domain/time';
import type { BlobRecord } from '../persistence/zip';

export type FixtureId =
  | 'G0_DEMO'
  | 'F09_EXPORT_CLOCK'
  | 'F02_HIDDEN_TORSO'
  | 'F03_PAPER_RECIPE'
  | 'F04_JOINTED_PUPPET'
  | 'F05_WALKING_LOOP'
  | 'F06_PARALLAX'
  | 'F08_ARCHIVE';

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
    loopScopes: {},
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
    loopScopes: {},
  };

  return { project, blobs };
}

export function buildF01ColorIslands(): { width: number; height: number; rgba: Uint8Array } {
  const width = 32;
  const height = 32;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      // Outer 2px transparent margin
      if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) {
        continue;
      }
      // Anti-aliased border at x===2 or x===29
      if (x === 2 || x === width - 3) {
        rgba[idx] = 220;
        rgba[idx + 1] = 40;
        rgba[idx + 2] = 40;
        rgba[idx + 3] = 128;
        continue;
      }
      // Blue vertical separator in middle (x: 14..17)
      if (x >= 14 && x <= 17) {
        rgba[idx] = 30;
        rgba[idx + 1] = 80;
        rgba[idx + 2] = 220;
        rgba[idx + 3] = 255;
        continue;
      }
      // Left and right disconnected red islands
      rgba[idx] = 220;
      rgba[idx + 1] = 40;
      rgba[idx + 2] = 40;
      rgba[idx + 3] = 255;
    }
  }
  return { width, height, rgba };
}

export function buildF02HiddenTorsoSheet(): { width: number; height: number; rgba: Uint8Array } {
  const width = 64;
  const height = 64;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      if (x < 4 || y < 4 || x >= 60 || y >= 60) {
        continue;
      }
      // Green obscuring arm strip at x: 24..39
      if (x >= 24 && x < 40 && y >= 10 && y < 54) {
        rgba[idx] = 40;
        rgba[idx + 1] = 190;
        rgba[idx + 2] = 80;
        rgba[idx + 3] = 255;
        continue;
      }
      // Vertical orange/cream stripes on torso
      const isOrange = Math.floor(x / 8) % 2 === 0;
      rgba[idx] = isOrange ? 240 : 250;
      rgba[idx + 1] = isOrange ? 120 : 240;
      rgba[idx + 2] = isOrange ? 40 : 200;
      rgba[idx + 3] = 255;
    }
  }
  return { width, height, rgba };
}

export function buildF02HiddenTorso(): LoadedFixture {
  const sheet = buildF02HiddenTorsoSheet();
  const sheetBlob = makeBlob('blob-f02-sheet', sheet);
  sheetBlob.role = 'source';

  const project = createBlankProject({
    id: 'proj-f02-torso',
    name: 'F02 Hidden Torso',
    width: 320,
    height: 180,
    background: { color: '#10141e', alpha: 0 },
  });

  project.sources['src-f02'] = {
    id: 'src-f02',
    name: 'f02-sheet.png',
    blobId: sheetBlob.id,
    sha256: sheetBlob.sha256,
    mimeType: 'image/png',
    width: 64,
    height: 64,
  };

  project.assets['asset-torso'] = {
    id: 'asset-torso',
    name: 'Torso',
    kind: 'cutout',
    sourceId: 'src-f02',
    editRect: { x: 0, y: 0, width: 64, height: 64 },
    maskBlobId: null,
    overlayBlobId: null,
    width: 64,
    height: 64,
    anchorX: 32,
    anchorY: 32,
    revision: 1,
  };

  project.assets['asset-arm'] = {
    id: 'asset-arm',
    name: 'Arm',
    kind: 'cutout',
    sourceId: 'src-f02',
    editRect: { x: 0, y: 0, width: 64, height: 64 },
    maskBlobId: null,
    overlayBlobId: null,
    width: 64,
    height: 64,
    anchorX: 32,
    anchorY: 32,
    revision: 1,
  };

  project.nodes['node-torso'] = {
    id: 'node-torso',
    name: 'Torso',
    kind: 'sprite',
    parentId: null,
    assetId: 'asset-torso',
    transform: { x: 120, y: 90, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    drawOrder: 10,
    effects: defaultEffects(),
  };

  project.nodes['node-arm'] = {
    id: 'node-arm',
    name: 'Arm',
    kind: 'sprite',
    parentId: null,
    assetId: 'asset-arm',
    transform: { x: 120, y: 90, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    drawOrder: 20,
    effects: defaultEffects(),
  };

  return { project, blobs: new Map([[sheetBlob.id, sheetBlob]]) };
}

export function buildF03PaperRecipeData(): MaterialRecipe {
  return createDefaultMaterialRecipe({
    width: 128,
    height: 128,
    seed: 4242,
    preset: 'construction-paper',
    baseColor: '#d97757',
    grainIntensity: 0.6,
    edgeIrregularity: 0,
    edgeDarkening: 0.3,
    pattern: {
      kind: 'stripes',
      color: '#2b2d42',
      opacity: 0.25,
      scale: 12,
    },
    shapes: [
      { id: 's1', kind: 'rect', op: 'union', x: 8, y: 8, width: 112, height: 112 },
      { id: 's2', kind: 'ellipse', op: 'subtract', x: 44, y: 44, width: 40, height: 40 },
      {
        id: 's3',
        kind: 'polygon',
        op: 'union',
        points: [
          { x: 16, y: 16 },
          { x: 36, y: 16 },
          { x: 26, y: 36 },
        ],
      },
    ],
  });
}

export function buildF03PaperRecipe(): LoadedFixture {
  const recipe = buildF03PaperRecipeData();
  const synth = synthesizeMaterial(recipe);
  const matBlob = makeBlob('blob-f03-mat', synth);

  const project = createBlankProject({
    id: 'proj-f03-paper',
    name: 'F03 Paper Recipe',
    width: 320,
    height: 180,
    background: { color: '#10141e', alpha: 0 },
  });

  project.assets['asset-paper'] = {
    id: 'asset-paper',
    name: 'Paper Cutout',
    kind: 'material',
    recipe,
    rasterBlobId: matBlob.id,
    width: recipe.width,
    height: recipe.height,
    anchorX: recipe.width / 2,
    anchorY: recipe.height / 2,
    revision: 1,
  };

  project.nodes['node-paper'] = {
    id: 'node-paper',
    name: 'Paper Node',
    kind: 'sprite',
    parentId: null,
    assetId: 'asset-paper',
    transform: { x: 160, y: 90, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    drawOrder: 10,
    effects: defaultEffects(),
  };

  return { project, blobs: new Map([[matBlob.id, matBlob]]) };
}

export function buildF08ArchiveProject(): LoadedFixture {
  const base = buildF02HiddenTorso();
  const sheetBlob = base.blobs.get('blob-f02-sheet')!;

  // Add mask + overlay to asset-torso
  const editRect: EditRect = { x: 0, y: 0, width: 64, height: 64 };
  const mask = new Uint8Array(64 * 64).fill(255);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      mask[y * 64 + x] = 0;
    }
  }
  const maskPng = maskToPngBytes(mask, 64, 64);
  const maskRgba = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i += 1) {
    maskRgba[i * 4] = 255;
    maskRgba[i * 4 + 1] = 255;
    maskRgba[i * 4 + 2] = 255;
    maskRgba[i * 4 + 3] = mask[i]!;
  }
  const maskBlob: BlobRecord = {
    id: 'blob-f08-mask',
    role: 'mask',
    mimeType: 'image/png',
    bytes: maskPng,
    sha256: '0'.repeat(64),
    width: 64,
    height: 64,
    rgba: maskRgba,
  };

  const overlayRgba = compositeCutoutAsset(
    createSolidSquare(64, 64, [240, 120, 40, 255]).rgba,
    64,
    64,
    editRect,
    null,
    null,
    false,
  );
  const overlayBlob = makeBlob('blob-f08-overlay', { width: 64, height: 64, rgba: overlayRgba });
  overlayBlob.role = 'overlay';

  const torso = base.project.assets['asset-torso']!;
  if (torso.kind === 'cutout') {
    torso.maskBlobId = maskBlob.id;
    torso.overlayBlobId = overlayBlob.id;
    torso.revision = 2;
  }

  // Unique sibling cutout sharing src-f02
  base.project.assets['asset-torso-unique'] = {
    id: 'asset-torso-unique',
    name: 'Torso Unique',
    kind: 'cutout',
    sourceId: 'src-f02',
    editRect: { x: 0, y: 0, width: 64, height: 64 },
    maskBlobId: null,
    overlayBlobId: null,
    width: 64,
    height: 64,
    anchorX: 32,
    anchorY: 32,
    revision: 1,
  };

  // Seeded material asset
  const recipe = buildF03PaperRecipeData();
  const matSynth = synthesizeMaterial(recipe);
  const matBlob = makeBlob('blob-f08-mat', matSynth);
  base.project.assets['asset-f08-paper'] = {
    id: 'asset-f08-paper',
    name: 'F08 Paper',
    kind: 'material',
    recipe,
    rasterBlobId: matBlob.id,
    width: recipe.width,
    height: recipe.height,
    anchorX: recipe.width / 2,
    anchorY: recipe.height / 2,
    revision: 1,
  };

  base.project.nodes['node-paper'] = {
    id: 'node-paper',
    name: 'Paper Prop',
    kind: 'sprite',
    parentId: null,
    assetId: 'asset-f08-paper',
    transform: { x: 240, y: 90, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    drawOrder: 5,
    effects: defaultEffects(),
  };

  base.blobs.set(sheetBlob.id, sheetBlob);
  base.blobs.set(maskBlob.id, maskBlob);
  base.blobs.set(overlayBlob.id, overlayBlob);
  base.blobs.set(matBlob.id, matBlob);
  return base;
}

export function buildF04JointedPuppet(): LoadedFixture {
  const blobs = new Map<string, BlobRecord>();
  const torsoImg = createSolidSquare(60, 80, [200, 50, 50, 255]);
  const upperImg = createSolidSquare(44, 16, [40, 190, 70, 255]);
  const foreImg = createSolidSquare(40, 14, [240, 210, 40, 255]);
  const handImg = createSolidSquare(18, 18, [50, 130, 240, 255]);

  blobs.set('blob-f04-torso', makeBlob('blob-f04-torso', torsoImg));
  blobs.set('blob-f04-upper', makeBlob('blob-f04-upper', upperImg));
  blobs.set('blob-f04-fore', makeBlob('blob-f04-fore', foreImg));
  blobs.set('blob-f04-hand', makeBlob('blob-f04-hand', handImg));

  const project = createBlankProject({
    id: 'proj-f04-puppet',
    name: 'F04 Jointed Puppet',
    width: 320,
    height: 180,
    background: { color: '#10141e', alpha: 0 },
  });

  project.assets = {
    'asset-f04-torso': {
      id: 'asset-f04-torso',
      name: 'Torso',
      kind: 'synthetic-rgba',
      width: 60,
      height: 80,
      anchorX: 30,
      anchorY: 40,
      blobId: 'blob-f04-torso',
      revision: 1,
    },
    'asset-f04-upper': {
      id: 'asset-f04-upper',
      name: 'Upper Arm',
      kind: 'synthetic-rgba',
      width: 44,
      height: 16,
      anchorX: 22,
      anchorY: 8,
      blobId: 'blob-f04-upper',
      revision: 1,
    },
    'asset-f04-fore': {
      id: 'asset-f04-fore',
      name: 'Forearm',
      kind: 'synthetic-rgba',
      width: 40,
      height: 14,
      anchorX: 20,
      anchorY: 7,
      blobId: 'blob-f04-fore',
      revision: 1,
    },
    'asset-f04-hand': {
      id: 'asset-f04-hand',
      name: 'Hand',
      kind: 'synthetic-rgba',
      width: 18,
      height: 18,
      anchorX: 9,
      anchorY: 9,
      blobId: 'blob-f04-hand',
      revision: 1,
    },
  };

  project.nodes = {
    'puppet-root': {
      id: 'puppet-root',
      name: 'Puppet Root',
      kind: 'group',
      parentId: null,
      transform: { x: 150, y: 90, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      drawOrder: 1,
      effects: defaultEffects(),
    },
    torso: {
      id: 'torso',
      name: 'Torso',
      kind: 'sprite',
      parentId: 'puppet-root',
      assetId: 'asset-f04-torso',
      transform: { x: 0, y: 0, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      drawOrder: 20,
      effects: defaultEffects(),
    },
    'upper-arm': {
      id: 'upper-arm',
      name: 'Upper Arm',
      kind: 'sprite',
      parentId: 'torso',
      assetId: 'asset-f04-upper',
      transform: { x: 20, y: -15, angle: 0, sx: 1, sy: 1, pivotX: -16, pivotY: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      drawOrder: 10,
      effects: defaultEffects(),
    },
    forearm: {
      id: 'forearm',
      name: 'Forearm',
      kind: 'sprite',
      parentId: 'upper-arm',
      assetId: 'asset-f04-fore',
      transform: { x: 16, y: 0, angle: 0, sx: 1, sy: 1, pivotX: -14, pivotY: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      drawOrder: 30,
      effects: defaultEffects(),
    },
    hand: {
      id: 'hand',
      name: 'Hand',
      kind: 'sprite',
      parentId: 'forearm',
      assetId: 'asset-f04-hand',
      transform: { x: 18, y: 0, angle: 0, sx: -1, sy: 1, pivotX: 0, pivotY: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      drawOrder: 35,
      effects: defaultEffects(),
    },
  };

  return { project, blobs };
}

export function buildF06Parallax(): LoadedFixture {
  const blobs = new Map<string, BlobRecord>();
  const tileImg = createTilePattern(48, 32);
  const fgImg = createSolidSquare(32, 24, [190, 80, 160, 255]);
  blobs.set('blob-f06-tile', makeBlob('blob-f06-tile', tileImg));
  blobs.set('blob-f06-fg', makeBlob('blob-f06-fg', fgImg));

  const project = createBlankProject({
    id: 'proj-f06-parallax',
    name: 'F06 Parallax',
    width: 320,
    height: 180,
    background: { color: '#10141e', alpha: 0 },
  });

  project.assets = {
    'asset-f06-tile': {
      id: 'asset-f06-tile',
      name: 'Asymmetric Tile',
      kind: 'synthetic-rgba',
      width: 48,
      height: 32,
      anchorX: 0,
      anchorY: 0,
      blobId: 'blob-f06-tile',
      revision: 1,
    },
    'asset-f06-fg': {
      id: 'asset-f06-fg',
      name: 'FG Tile',
      kind: 'synthetic-rgba',
      width: 32,
      height: 24,
      anchorX: 0,
      anchorY: 0,
      blobId: 'blob-f06-fg',
      revision: 1,
    },
  };

  project.nodes = {
    'sky-tiles': {
      id: 'sky-tiles',
      name: 'Sky Mirrored Tiles',
      kind: 'tile',
      parentId: null,
      assetId: 'asset-f06-tile',
      transform: { x: 0, y: 0, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      drawOrder: 0,
      effects: defaultEffects(),
      tile: {
        width: 320,
        height: 80,
        scaleX: 1,
        scaleY: 1,
        offsetX: -14,
        offsetY: -6,
        scrollRateX: 0,
        scrollRateY: 0,
        repeatX: true,
        repeatY: true,
        mirrorX: true,
        mirrorY: false,
      },
    },
    'hills-tiles': {
      id: 'hills-tiles',
      name: 'Hills Single Row',
      kind: 'tile',
      parentId: null,
      assetId: 'asset-f06-tile',
      transform: { x: 0, y: 80, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      drawOrder: 10,
      effects: defaultEffects(),
      tile: {
        width: 320,
        height: 100,
        scaleX: 1,
        scaleY: 1,
        offsetX: -35,
        offsetY: 0,
        scrollRateX: 0,
        scrollRateY: 0,
        repeatX: true,
        repeatY: false,
        mirrorX: false,
        mirrorY: false,
      },
    },
    'fg-tiles': {
      id: 'fg-tiles',
      name: 'FG Scaled Tiles',
      kind: 'tile',
      parentId: null,
      assetId: 'asset-f06-fg',
      transform: { x: 0, y: 140, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      drawOrder: 20,
      effects: defaultEffects(),
      tile: {
        width: 160,
        height: 40,
        scaleX: 1.5,
        scaleY: 1.5,
        offsetX: -10,
        offsetY: -5,
        scrollRateX: 0,
        scrollRateY: 0,
        repeatX: true,
        repeatY: true,
        mirrorX: false,
        mirrorY: false,
      },
    },
  };

  return { project, blobs };
}

export function buildF05WalkingLoop(): LoadedFixture {
  const blobs = new Map<string, BlobRecord>();
  const tileImg = createTilePattern(48, 32);
  const torsoImg = createSolidSquare(40, 50, [210, 70, 60, 255]);
  const armImg = createSolidSquare(36, 12, [50, 190, 90, 255]);
  const headImg = createSolidSquare(24, 24, [240, 200, 60, 255]);
  const badgeImg = createSolidSquare(16, 16, [80, 160, 240, 255]);

  blobs.set('blob-f05-tile', makeBlob('blob-f05-tile', tileImg));
  blobs.set('blob-f05-torso', makeBlob('blob-f05-torso', torsoImg));
  blobs.set('blob-f05-arm', makeBlob('blob-f05-arm', armImg));
  blobs.set('blob-f05-head', makeBlob('blob-f05-head', headImg));
  blobs.set('blob-f05-badge', makeBlob('blob-f05-badge', badgeImg));

  const project = createBlankProject({
    id: 'proj-f05-walking',
    name: 'F05 Walking Loop',
    width: 320,
    height: 180,
    fps: { num: 24, den: 1 },
    durationTicks: TICKS_PER_SECOND * 2,
    background: { color: '#10141e', alpha: 0 },
  });

  project.assets = {
    'asset-f05-tile': {
      id: 'asset-f05-tile',
      name: 'BG Tile',
      kind: 'synthetic-rgba',
      width: 48,
      height: 32,
      anchorX: 0,
      anchorY: 0,
      blobId: 'blob-f05-tile',
      revision: 1,
    },
    'asset-f05-torso': {
      id: 'asset-f05-torso',
      name: 'Torso',
      kind: 'synthetic-rgba',
      width: 40,
      height: 50,
      anchorX: 20,
      anchorY: 25,
      blobId: 'blob-f05-torso',
      revision: 1,
    },
    'asset-f05-arm': {
      id: 'asset-f05-arm',
      name: 'Arm',
      kind: 'synthetic-rgba',
      width: 36,
      height: 12,
      anchorX: 6,
      anchorY: 6,
      blobId: 'blob-f05-arm',
      revision: 1,
    },
    'asset-f05-head': {
      id: 'asset-f05-head',
      name: 'Head',
      kind: 'synthetic-rgba',
      width: 24,
      height: 24,
      anchorX: 12,
      anchorY: 12,
      blobId: 'blob-f05-head',
      revision: 1,
    },
    'asset-f05-badge': {
      id: 'asset-f05-badge',
      name: 'Once Badge',
      kind: 'synthetic-rgba',
      width: 16,
      height: 16,
      anchorX: 8,
      anchorY: 8,
      blobId: 'blob-f05-badge',
      revision: 1,
    },
  };

  project.nodes = {
    'bg-parallax': {
      id: 'bg-parallax',
      name: 'Parallax BG',
      kind: 'tile',
      parentId: null,
      assetId: 'asset-f05-tile',
      transform: { x: 0, y: 120, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      drawOrder: 0,
      effects: defaultEffects(),
      tile: {
        width: 320,
        height: 60,
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
        scrollRateX: -48,
        scrollRateY: 0,
        repeatX: true,
        repeatY: true,
        mirrorX: false,
        mirrorY: false,
      },
    },
    'travel-root': {
      id: 'travel-root',
      name: 'Travel Root',
      kind: 'group',
      parentId: null,
      transform: { x: 60, y: 100, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      drawOrder: 5,
      samplingOverride: { mode: 'full-rate' },
      effects: defaultEffects(),
    },
    'puppet-loop': {
      id: 'puppet-loop',
      name: 'Puppet Loop',
      kind: 'group',
      parentId: 'travel-root',
      transform: { x: 0, y: 0, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      drawOrder: 6,
      effects: defaultEffects(),
    },
    torso: {
      id: 'torso',
      name: 'Torso',
      kind: 'sprite',
      parentId: 'puppet-loop',
      assetId: 'asset-f05-torso',
      transform: { x: 0, y: 0, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      drawOrder: 20,
      effects: defaultEffects(),
    },
    arm: {
      id: 'arm',
      name: 'Arm',
      kind: 'sprite',
      parentId: 'torso',
      assetId: 'asset-f05-arm',
      transform: { x: 10, y: -5, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      drawOrder: 30,
      effects: defaultEffects(),
    },
    head: {
      id: 'head',
      name: 'Head (6fps)',
      kind: 'sprite',
      parentId: 'torso',
      assetId: 'asset-f05-head',
      transform: { x: 0, y: -32, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      drawOrder: 25,
      samplingOverride: { mode: 'fixed', fps: { num: 6, den: 1 } },
      effects: defaultEffects(),
    },
    'badge-once': {
      id: 'badge-once',
      name: 'Once Badge',
      kind: 'sprite',
      parentId: null,
      assetId: 'asset-f05-badge',
      transform: { x: 280, y: 40, angle: 0, sx: 1, sy: 1, pivotX: 0, pivotY: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      drawOrder: 40,
      effects: defaultEffects(),
    },
  };

  project.tracks = {
    'trk-travel-x': {
      id: 'trk-travel-x',
      targetKind: 'node',
      targetId: 'travel-root',
      property: 'transform.x',
      keys: [
        { tick: 0, value: 60, interpolation: 'linear' },
        { tick: TICKS_PER_SECOND * 2, value: 260, interpolation: 'hold' },
      ],
    },
    'trk-torso-y': {
      id: 'trk-torso-y',
      targetKind: 'node',
      targetId: 'torso',
      property: 'transform.y',
      keys: [
        { tick: 0, value: 0, interpolation: 'smooth' },
        { tick: 30_000, value: -12, interpolation: 'smooth' },
        { tick: 60_000, value: 0, interpolation: 'hold' },
      ],
    },
    'trk-arm-angle': {
      id: 'trk-arm-angle',
      targetKind: 'node',
      targetId: 'arm',
      property: 'transform.angle',
      keys: [
        { tick: 0, value: 0, interpolation: 'linear' },
        { tick: 30_000, value: 60, interpolation: 'hold' },
      ],
    },
    'trk-head-angle': {
      id: 'trk-head-angle',
      targetKind: 'node',
      targetId: 'head',
      property: 'transform.angle',
      keys: [
        { tick: 0, value: -15, interpolation: 'linear' },
        { tick: 60_000, value: 15, interpolation: 'hold' },
      ],
    },
    'trk-badge-y': {
      id: 'trk-badge-y',
      targetKind: 'node',
      targetId: 'badge-once',
      property: 'transform.y',
      keys: [
        { tick: 0, value: 40, interpolation: 'linear' },
        { tick: 30_000, value: 80, interpolation: 'hold' },
      ],
    },
  };

  project.loopScopes = {
    'loop-puppet-group': {
      id: 'loop-puppet-group',
      selectorKind: 'group',
      targetKind: 'node',
      targetId: 'puppet-loop',
      startTick: 0,
      endTick: 60_000,
      activationStartTick: 0,
      speed: 1,
      offsetTicks: 0,
      mode: 'repeat',
    },
    'loop-arm-prop': {
      id: 'loop-arm-prop',
      selectorKind: 'property',
      targetKind: 'node',
      targetId: 'arm',
      property: 'transform.angle',
      startTick: 0,
      endTick: 30_000,
      activationStartTick: 0,
      speed: 1,
      offsetTicks: -5_000,
      mode: 'ping-pong',
    },
    'loop-badge-once': {
      id: 'loop-badge-once',
      selectorKind: 'object',
      targetKind: 'node',
      targetId: 'badge-once',
      startTick: 0,
      endTick: 30_000,
      activationStartTick: 30_000,
      speed: 1,
      offsetTicks: 0,
      mode: 'once-and-hold',
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
    case 'F02_HIDDEN_TORSO':
      return buildF02HiddenTorso();
    case 'F03_PAPER_RECIPE':
      return buildF03PaperRecipe();
    case 'F04_JOINTED_PUPPET':
      return buildF04JointedPuppet();
    case 'F05_WALKING_LOOP':
      return buildF05WalkingLoop();
    case 'F06_PARALLAX':
      return buildF06Parallax();
    case 'F08_ARCHIVE':
      return buildF08ArchiveProject();
    default:
      throw new AppError('ERR_UNKNOWN_FIXTURE', `Unknown fixture ID: "${id}".`);
  }
}
