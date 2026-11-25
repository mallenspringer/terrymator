import { DropShadowFilter, GlowFilter } from 'pixi-filters';
import {
  BufferImageSource,
  ColorMatrixFilter,
  Container,
  Filter,
  Graphics,
  Matrix,
  Sprite,
  Texture,
  TilingSprite,
  WebGLRenderer,
} from 'pixi.js';
import { encodePngRgba } from '../assets/pngCodec';
import { AppError } from '../domain/errors';
import type { EvaluatedDrawItem, EvaluatedScene } from '../domain/evaluator';
import { applyAffineToPoint, invertAffine, type Affine2D, type Point2D } from '../domain/math';
import type { NodeEffects } from '../domain/schema';
import { positiveMod } from '../domain/time';
import type { BlobRecord } from '../persistence/zip';

export interface EditorViewport {
  panX: number;
  panY: number;
  zoom: number;
}

export interface RenderOptions {
  outputWidth?: number;
  outputHeight?: number;
  transparentBackground?: boolean;
  viewport?: EditorViewport;
  showGuides?: boolean;
  selectedNodeId?: string | null;
}

export function canvasPointToStage(
  cx: number,
  cy: number,
  outW: number,
  outH: number,
  viewport: EditorViewport,
  stageToOutput: Affine2D,
): Point2D {
  const ox = (cx - outW / 2 - viewport.panX) / viewport.zoom + outW / 2;
  const oy = (cy - outH / 2 - viewport.panY) / viewport.zoom + outH / 2;
  return applyAffineToPoint(invertAffine(stageToOutput), { x: ox, y: oy });
}

export interface ResourceCounters {
  textures: number;
  mirroredTextures: number;
  filters: number;
  activeRenderTargets: number;
  objectUrls: number;
  activeEncoders: number;
}

function parseHexColor(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

function createMirroredRgba(
  src: Uint8Array,
  w: number,
  h: number,
  mirrorX: boolean,
  mirrorY: boolean,
): { rgba: Uint8Array; width: number; height: number } {
  const outW = mirrorX ? w * 2 : w;
  const outH = mirrorY ? h * 2 : h;
  const out = new Uint8Array(outW * outH * 4);

  for (let y = 0; y < outH; y += 1) {
    const sy = y < h ? y : h - 1 - (y - h);
    for (let x = 0; x < outW; x += 1) {
      const sx = x < w ? x : w - 1 - (x - w);
      const sIdx = (sy * w + sx) * 4;
      const dIdx = (y * outW + x) * 4;
      out[dIdx] = src[sIdx]!;
      out[dIdx + 1] = src[sIdx + 1]!;
      out[dIdx + 2] = src[sIdx + 2]!;
      out[dIdx + 3] = src[sIdx + 3]!;
    }
  }
  return { rgba: out, width: outW, height: outH };
}

function buildEffectsFilters(
  effects: NodeEffects,
  globalShadowAngle: number,
  cameraScale: number,
): Filter[] {
  const filters: Filter[] = [];

  if (effects.colorAdjust.enabled) {
    const cm = new ColorMatrixFilter();
    if (effects.colorAdjust.brightness !== 0) {
      cm.brightness(1 + effects.colorAdjust.brightness, false);
    }
    if (effects.colorAdjust.contrast !== 0) {
      cm.contrast(effects.colorAdjust.contrast, true);
    }
    if (effects.colorAdjust.tintAmount > 0) {
      cm.tint(parseHexColor(effects.colorAdjust.tint), true);
      cm.alpha = 1;
    }
    filters.push(cm);
  }

  if (effects.outerGlow.enabled && effects.outerGlow.intensity > 0) {
    const glow = new GlowFilter({
      color: parseHexColor(effects.outerGlow.color),
      outerStrength: effects.outerGlow.intensity,
      innerStrength: 0,
      distance: Math.max(4, effects.outerGlow.radius),
      quality: 0.25,
    });
    glow.padding = Math.ceil(effects.outerGlow.radius) + 8;
    filters.push(glow);
  }

  if (effects.dropShadow.enabled && effects.dropShadow.opacity > 0) {
    const angleDeg = effects.dropShadow.useGlobalAngle
      ? globalShadowAngle
      : effects.dropShadow.angle;
    const rad = (angleDeg * Math.PI) / 180;
    const dist = effects.dropShadow.distance * cameraScale;
    const shadow = new DropShadowFilter({
      color: parseHexColor(effects.dropShadow.color),
      alpha: effects.dropShadow.opacity,
      offset: {
        x: Math.cos(rad) * dist,
        y: Math.sin(rad) * dist,
      },
      blur: Math.max(0, effects.dropShadow.softness),
      quality: 4,
    });
    shadow.padding = Math.ceil(dist + effects.dropShadow.softness * 2) + 12;
    filters.push(shadow);
  }

  return filters;
}

export class PixiStageRenderer {
  private renderer: WebGLRenderer | null = null;
  private width = 0;
  private height = 0;
  private baseTextures = new Map<string, Texture>();
  private mirroredTextures = new Map<string, Texture>();
  private activeFilterCount = 0;
  private activeEncoders = 0;
  private objectUrls = 0;

  public async init(width: number, height: number, canvas?: HTMLCanvasElement): Promise<void> {
    if (
      this.renderer &&
      this.width === width &&
      this.height === height &&
      (!canvas || this.renderer.canvas === canvas)
    ) {
      return;
    }
    this.dispose();
    const renderer = new WebGLRenderer();
    await renderer.init({
      width,
      height,
      canvas,
      resolution: 1,
      autoDensity: false,
      antialias: false,
      backgroundAlpha: 0,
      clearBeforeRender: true,
      preserveDrawingBuffer: true,
    });
    this.renderer = renderer;
    this.width = width;
    this.height = height;
  }

  public getCanvas(): HTMLCanvasElement {
    if (!this.renderer) {
      throw new AppError('ERR_RENDER_NOT_READY', 'Renderer is not initialized.');
    }
    return this.renderer.canvas as HTMLCanvasElement;
  }

  public trackEncoder(delta: number): void {
    this.activeEncoders = Math.max(0, this.activeEncoders + delta);
  }

  public trackObjectUrl(delta: number): void {
    this.objectUrls = Math.max(0, this.objectUrls + delta);
  }

  public getResourceCounters(): ResourceCounters {
    return {
      textures: this.baseTextures.size,
      mirroredTextures: this.mirroredTextures.size,
      filters: this.activeFilterCount,
      activeRenderTargets: this.renderer ? 1 : 0,
      objectUrls: this.objectUrls,
      activeEncoders: this.activeEncoders,
    };
  }

  private getOrCreateBaseTexture(blob: BlobRecord, revision: number): Texture {
    const key = `${blob.id}@${revision}`;
    const existing = this.baseTextures.get(key);
    if (existing) {
      return existing;
    }
    const source = new BufferImageSource({
      resource: new Uint8Array(blob.rgba),
      width: blob.width,
      height: blob.height,
      format: 'rgba8unorm',
      alphaMode: 'no-premultiply-alpha',
      scaleMode: 'nearest',
      addressMode: 'repeat',
    });
    const texture = new Texture({ source });
    this.baseTextures.set(key, texture);
    return texture;
  }

  private getOrCreateTileTexture(
    blob: BlobRecord,
    revision: number,
    mirrorX: boolean,
    mirrorY: boolean,
  ): Texture {
    if (!mirrorX && !mirrorY) {
      return this.getOrCreateBaseTexture(blob, revision);
    }
    const key = `${blob.id}@${revision}:m${mirrorX ? 1 : 0}${mirrorY ? 1 : 0}`;
    const existing = this.mirroredTextures.get(key);
    if (existing) {
      return existing;
    }
    const mirrored = createMirroredRgba(blob.rgba, blob.width, blob.height, mirrorX, mirrorY);
    const source = new BufferImageSource({
      resource: mirrored.rgba,
      width: mirrored.width,
      height: mirrored.height,
      format: 'rgba8unorm',
      alphaMode: 'no-premultiply-alpha',
      scaleMode: 'nearest',
      addressMode: 'repeat',
    });
    const texture = new Texture({ source });
    this.mirroredTextures.set(key, texture);
    return texture;
  }

  private buildDisplayObject(
    item: EvaluatedDrawItem,
    blobs: Map<string, BlobRecord>,
    stageToOutput: EvaluatedScene['camera']['stageToOutput'],
    globalShadowAngle: number,
    createdFilters: Filter[],
  ): Container {
    const blob = blobs.get(item.blobId);
    if (!blob) {
      throw new AppError('ERR_MISSING_ASSET', `Missing blob "${item.blobId}" during render.`);
    }

    const wrapper = new Container();
    wrapper.alpha = item.opacity;

    const cameraScale = Math.hypot(stageToOutput.a, stageToOutput.b);

    if (item.kind === 'sprite') {
      const texture = this.getOrCreateBaseTexture(blob, item.assetRevision);
      const sprite = new Sprite(texture);
      sprite.anchor.set(item.anchorX / blob.width, item.anchorY / blob.height);

      const m = item.worldMatrix;
      sprite.setFromMatrix(new Matrix(m.a, m.b, m.c, m.d, m.tx, m.ty));
      wrapper.addChild(sprite);
    } else {
      const tile = item.tile!;
      const texture = this.getOrCreateTileTexture(
        blob,
        item.assetRevision,
        tile.mirrorX,
        tile.mirrorY,
      );
      const singleW = blob.width * tile.scaleX;
      const singleH = blob.height * tile.scaleY;
      const drawW = tile.repeatX ? tile.width : Math.min(tile.width, singleW);
      const drawH = tile.repeatY ? tile.height : Math.min(tile.height, singleH);

      const tiling = new TilingSprite({
        texture,
        width: drawW,
        height: drawH,
      });
      tiling.tileScale.set(tile.scaleX, tile.scaleY);

      const wrapW = texture.width * tile.scaleX;
      const wrapH = texture.height * tile.scaleY;
      const effX = tile.repeatX ? positiveMod(tile.offsetX, wrapW) : 0;
      const effY = tile.repeatY ? positiveMod(tile.offsetY, wrapH) : 0;
      tiling.tilePosition.set(effX, effY);
      tiling.anchor.set(item.anchorX / drawW, item.anchorY / drawH);

      const m = item.worldMatrix;
      tiling.setFromMatrix(new Matrix(m.a, m.b, m.c, m.d, m.tx, m.ty));
      wrapper.addChild(tiling);
    }

    const nodeFilters = buildEffectsFilters(item.effects, globalShadowAngle, cameraScale);
    if (nodeFilters.length > 0) {
      wrapper.filters = nodeFilters;
      createdFilters.push(...nodeFilters);
    }
    return wrapper;
  }

  public async render(
    scene: EvaluatedScene,
    blobs: Map<string, BlobRecord>,
    options: RenderOptions = {},
  ): Promise<void> {
    const outW = options.outputWidth ?? scene.shotWidth;
    const outH = options.outputHeight ?? scene.shotHeight;
    await this.init(outW, outH);
    if (!this.renderer) {
      throw new AppError('ERR_RENDER_NOT_READY', 'Renderer failed to initialize.');
    }

    const root = new Container();
    const createdFilters: Filter[] = [];

    const vp = options.viewport;
    const viewportContainer = new Container();
    if (vp) {
      const z = vp.zoom;
      const vTx = outW / 2 + vp.panX - (outW / 2) * z;
      const vTy = outH / 2 + vp.panY - (outH / 2) * z;
      viewportContainer.setFromMatrix(new Matrix(z, 0, 0, z, vTx, vTy));
    }
    root.addChild(viewportContainer);

    const transparent = options.transparentBackground ?? scene.background.alpha === 0;
    if (!transparent && scene.background.alpha > 0) {
      const bg = new Graphics();
      bg.rect(0, 0, outW, outH).fill({
        color: parseHexColor(scene.background.color),
        alpha: scene.background.alpha,
      });
      viewportContainer.addChild(bg);
    }

    const cameraContainer = new Container();
    const camM = scene.camera.stageToOutput;
    cameraContainer.setFromMatrix(new Matrix(camM.a, camM.b, camM.c, camM.d, camM.tx, camM.ty));
    viewportContainer.addChild(cameraContainer);

    for (const item of scene.drawList) {
      const obj = this.buildDisplayObject(
        item,
        blobs,
        scene.camera.stageToOutput,
        scene.globalShadowAngle,
        createdFilters,
      );
      cameraContainer.addChild(obj);
    }

    if (options.showGuides) {
      const guides = new Graphics();
      guides
        .rect(0, 0, scene.shotWidth, scene.shotHeight)
        .stroke({ color: 0x5c7cfa, width: 1.5, alpha: 0.75 });

      if (options.selectedNodeId) {
        const sel = scene.drawList.find((d) => d.nodeId === options.selectedNodeId);
        if (sel) {
          const w = sel.kind === 'tile' && sel.tile ? sel.tile.width : sel.assetWidth;
          const h = sel.kind === 'tile' && sel.tile ? sel.tile.height : sel.assetHeight;
          const corners = [
            applyAffineToPoint(sel.worldMatrix, { x: -sel.anchorX, y: -sel.anchorY }),
            applyAffineToPoint(sel.worldMatrix, { x: w - sel.anchorX, y: -sel.anchorY }),
            applyAffineToPoint(sel.worldMatrix, { x: w - sel.anchorX, y: h - sel.anchorY }),
            applyAffineToPoint(sel.worldMatrix, { x: -sel.anchorX, y: h - sel.anchorY }),
          ];
          guides
            .moveTo(corners[0]!.x, corners[0]!.y)
            .lineTo(corners[1]!.x, corners[1]!.y)
            .lineTo(corners[2]!.x, corners[2]!.y)
            .lineTo(corners[3]!.x, corners[3]!.y)
            .closePath()
            .stroke({ color: 0x22d3ee, width: 2, alpha: 0.95 });
        }
      }
      cameraContainer.addChild(guides);
    }

    this.activeFilterCount = createdFilters.length;
    this.renderer.render({ container: root, clear: true });

    for (const f of createdFilters) {
      f.destroy();
    }
    this.activeFilterCount = 0;
    root.destroy({ children: true });
  }

  public async renderToRgba(
    scene: EvaluatedScene,
    blobs: Map<string, BlobRecord>,
    options: RenderOptions = {},
  ): Promise<{ width: number; height: number; rgba: Uint8Array }> {
    await this.render(scene, blobs, options);
    if (!this.renderer) {
      throw new AppError('ERR_RENDER_NOT_READY', 'Renderer is not initialized.');
    }
    const canvas = this.getCanvas();
    const gl = this.renderer.gl;
    const w = this.width;
    const h = this.height;
    const raw = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);

    // WebGL readPixels is bottom-up and premultiplied; flip vertically and un-premultiply
    const out = new Uint8Array(w * h * 4);
    const rowBytes = w * 4;
    for (let y = 0; y < h; y += 1) {
      const srcRow = (h - 1 - y) * rowBytes;
      const dstRow = y * rowBytes;
      for (let x = 0; x < w; x += 1) {
        const s = srcRow + x * 4;
        const d = dstRow + x * 4;
        const a = raw[s + 3]!;
        if (a === 0) {
          out[d] = 0;
          out[d + 1] = 0;
          out[d + 2] = 0;
          out[d + 3] = 0;
        } else if (a === 255) {
          out[d] = raw[s]!;
          out[d + 1] = raw[s + 1]!;
          out[d + 2] = raw[s + 2]!;
          out[d + 3] = 255;
        } else {
          out[d] = Math.min(255, Math.round((raw[s]! * 255) / a));
          out[d + 1] = Math.min(255, Math.round((raw[s + 1]! * 255) / a));
          out[d + 2] = Math.min(255, Math.round((raw[s + 2]! * 255) / a));
          out[d + 3] = a;
        }
      }
    }
    void canvas;
    return { width: w, height: h, rgba: out };
  }

  public async renderToPng(
    scene: EvaluatedScene,
    blobs: Map<string, BlobRecord>,
    options: RenderOptions = {},
  ): Promise<{ width: number; height: number; pngBytes: Uint8Array; rgba: Uint8Array }> {
    const { width, height, rgba } = await this.renderToRgba(scene, blobs, options);
    const pngBytes = encodePngRgba(rgba, width, height);
    return { width, height, pngBytes, rgba };
  }

  public clearTextures(): void {
    for (const tex of this.baseTextures.values()) {
      tex.destroy(true);
    }
    this.baseTextures.clear();
    for (const tex of this.mirroredTextures.values()) {
      tex.destroy(true);
    }
    this.mirroredTextures.clear();
  }

  public dispose(): void {
    this.clearTextures();
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
    this.width = 0;
    this.height = 0;
    this.activeFilterCount = 0;
  }
}
