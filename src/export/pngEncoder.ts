import { strToU8, zipSync } from 'fflate';
import { encodePngRgba } from '../assets/pngCodec';
import { canonicalStringify } from '../domain/schema';
import type { RationalFps } from '../domain/time';
import type { EncoderAdapter } from './types';

export class PngStillEncoderAdapter implements EncoderAdapter {
  public readonly format = 'png-still' as const;
  public readonly codec = 'png-rgba';
  private lastPng: Uint8Array | null = null;

  public async start(): Promise<void> {
    this.lastPng = null;
  }

  public async append(frame: { rgba: Uint8Array; width: number; height: number }): Promise<void> {
    this.lastPng = encodePngRgba(frame.rgba, frame.width, frame.height);
  }

  public async finish(): Promise<Uint8Array> {
    if (!this.lastPng) {
      throw new Error('No frame appended for PNG still.');
    }
    return this.lastPng;
  }

  public async abort(): Promise<void> {
    this.lastPng = null;
  }
}

export class PngSequenceZipEncoderAdapter implements EncoderAdapter {
  public readonly format = 'png-sequence' as const;
  public readonly codec = 'png-rgba';
  private files: Record<string, Uint8Array> = {};
  private manifestFrames: Array<{
    index: number;
    file: string;
    shotTick: number;
    ptsSeconds: number;
    durationSeconds: number;
  }> = [];
  private fps: RationalFps = { num: 24, den: 1 };
  private width = 0;
  private height = 0;
  private alpha = true;

  public async start(config: {
    width: number;
    height: number;
    fps: RationalFps;
    alpha: boolean;
  }): Promise<void> {
    this.files = {};
    this.manifestFrames = [];
    this.fps = config.fps;
    this.width = config.width;
    this.height = config.height;
    this.alpha = config.alpha;
  }

  public async append(frame: {
    index: number;
    shotTick: number;
    ptsSeconds: number;
    durationSeconds: number;
    rgba: Uint8Array;
    width: number;
    height: number;
  }): Promise<void> {
    const fileName = `frame_${String(frame.index).padStart(4, '0')}.png`;
    this.files[fileName] = encodePngRgba(frame.rgba, frame.width, frame.height);
    this.manifestFrames.push({
      index: frame.index,
      file: fileName,
      shotTick: frame.shotTick,
      ptsSeconds: frame.ptsSeconds,
      durationSeconds: frame.durationSeconds,
    });
  }

  public async finish(): Promise<Uint8Array> {
    const manifest = {
      format: 'terrymator-png-sequence',
      version: 1,
      width: this.width,
      height: this.height,
      fps: this.fps,
      alpha: this.alpha,
      frameCount: this.manifestFrames.length,
      frames: this.manifestFrames,
    };
    this.files['manifest.json'] = strToU8(canonicalStringify(manifest));
    const zipBytes = zipSync(this.files, { level: 0 });
    this.files = {};
    this.manifestFrames = [];
    return zipBytes;
  }

  public async abort(): Promise<void> {
    this.files = {};
    this.manifestFrames = [];
  }
}
