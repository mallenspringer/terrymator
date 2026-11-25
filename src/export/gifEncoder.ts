import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { RationalFps } from '../domain/time';
import type { EncoderAdapter } from './types';

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Computes centisecond delays per frame using cumulative rounding
 * so total GIF duration stays faithful to FPS with >= 2 cs per frame.
 */
export function computeGifDelaysCs(frameCount: number, fps: RationalFps): number[] {
  const delays: number[] = [];
  let prevTotalCs = 0;
  for (let i = 0; i < frameCount; i += 1) {
    const targetEndCs = Math.round(((i + 1) * 100 * fps.den) / fps.num);
    const delta = Math.max(2, targetEndCs - prevTotalCs);
    delays.push(delta);
    prevTotalCs += delta;
  }
  return delays;
}

function flattenAlphaForGif(
  rgba: Uint8Array,
  matte: [number, number, number],
  binaryAlpha: boolean,
): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const a = rgba[i + 3]!;
    if (binaryAlpha) {
      if (a < 128) {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        out[i + 3] = 0;
      } else {
        out[i] = r;
        out[i + 1] = g;
        out[i + 2] = b;
        out[i + 3] = 255;
      }
    } else {
      const alphaNorm = a / 255;
      const inv = 1 - alphaNorm;
      out[i] = Math.round(r * alphaNorm + matte[0] * inv);
      out[i + 1] = Math.round(g * alphaNorm + matte[1] * inv);
      out[i + 2] = Math.round(b * alphaNorm + matte[2] * inv);
      out[i + 3] = 255;
    }
  }
  return out;
}

export class GifEncoderAdapter implements EncoderAdapter {
  public readonly format = 'gif' as const;
  public readonly codec = 'gif89a-256';
  private encoder: ReturnType<typeof GIFEncoder> | null = null;
  private delaysCs: number[] = [];
  private matte: [number, number, number] = [0, 0, 0];
  private binaryAlpha = false;
  private aborted = false;

  public async start(config: {
    width: number;
    height: number;
    fps: RationalFps;
    alpha: boolean;
    matteColor: string;
    totalFrames: number;
  }): Promise<void> {
    this.aborted = false;
    this.encoder = GIFEncoder();
    this.delaysCs = computeGifDelaysCs(config.totalFrames, config.fps);
    this.matte = hexToRgb(config.matteColor);
    this.binaryAlpha = config.alpha;
  }

  public async append(frame: {
    index: number;
    rgba: Uint8Array;
    width: number;
    height: number;
  }): Promise<void> {
    if (this.aborted || !this.encoder) {
      return;
    }
    const prepared = flattenAlphaForGif(frame.rgba, this.matte, this.binaryAlpha);
    const palette = quantize(prepared, 256, {
      format: this.binaryAlpha ? 'rgba4444' : 'rgb565',
      oneBitAlpha: this.binaryAlpha,
    });
    const indexed = applyPalette(prepared, palette, this.binaryAlpha ? 'rgba4444' : 'rgb565');
    const delayMs = (this.delaysCs[frame.index] ?? 4) * 10;

    let transparentIndex = 0;
    if (this.binaryAlpha) {
      const idx = palette.findIndex((c) => (c[3] ?? 255) === 0);
      transparentIndex = idx >= 0 ? idx : 0;
    }

    this.encoder.writeFrame(indexed, frame.width, frame.height, {
      palette,
      delay: delayMs,
      repeat: 0,
      transparent: this.binaryAlpha,
      transparentIndex,
      dispose: this.binaryAlpha ? 2 : 1,
    });
  }

  public async finish(): Promise<Uint8Array> {
    if (!this.encoder) {
      throw new Error('GIF encoder not started.');
    }
    this.encoder.finish();
    const bytes = this.encoder.bytes();
    this.encoder = null;
    return bytes;
  }

  public async abort(): Promise<void> {
    this.aborted = true;
    this.encoder = null;
  }
}
