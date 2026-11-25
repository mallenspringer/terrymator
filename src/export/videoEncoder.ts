import {
  BufferTarget,
  CanvasSource,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  canEncodeVideo,
  type VideoCodec,
} from 'mediabunny';
import { AppError } from '../domain/errors';
import type { RationalFps } from '../domain/time';
import type { EncoderAdapter } from './types';

function compositeRgbaToCanvas(
  ctx: CanvasRenderingContext2D,
  rgba: Uint8Array,
  width: number,
  height: number,
  alpha: boolean,
  matteColor: string,
): void {
  if (!alpha) {
    ctx.fillStyle = matteColor;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }

  const tmp = new OffscreenCanvas(width, height);
  const tmpCtx = tmp.getContext('2d');
  if (!tmpCtx) {
    throw new AppError('ERR_EXPORT_FAILED', 'Failed to acquire 2D context for frame upload.');
  }
  const copy = new Uint8ClampedArray(rgba.byteLength);
  copy.set(rgba);
  tmpCtx.putImageData(new ImageData(copy, width, height), 0, 0);
  ctx.drawImage(tmp, 0, 0);
}

export class MediabunnyVideoEncoderAdapter implements EncoderAdapter {
  public readonly format: 'mp4' | 'mov' | 'webm';
  public codec: VideoCodec;
  private output: Output<Mp4OutputFormat | MovOutputFormat | WebMOutputFormat, BufferTarget> | null =
    null;
  private source: CanvasSource | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private alpha = false;
  private matteColor = '#000000';
  private aborted = false;

  constructor(format: 'mp4' | 'mov' | 'webm', preferredCodec?: VideoCodec) {
    this.format = format;
    this.codec = preferredCodec ?? (format === 'webm' ? 'vp9' : 'avc');
  }

  public async start(config: {
    width: number;
    height: number;
    fps: RationalFps;
    alpha: boolean;
    matteColor: string;
  }): Promise<void> {
    this.aborted = false;
    this.alpha = config.alpha;
    this.matteColor = config.matteColor;
    const frameRate = config.fps.num / config.fps.den;

    const candidates: VideoCodec[] =
      this.format === 'webm' ? [this.codec, 'vp8'] : [this.codec];
    let selectedCodec: VideoCodec | null = null;
    for (const c of candidates) {
      if (
        typeof globalThis.VideoEncoder === 'function' &&
        (await canEncodeVideo(c, {
          width: config.width,
          height: config.height,
          frameRate,
          quality: QUALITY_HIGH,
        }))
      ) {
        selectedCodec = c;
        break;
      }
    }

    if (!selectedCodec) {
      throw new AppError(
        'ERR_CODEC_UNSUPPORTED',
        `Format "${this.format}" (${candidates.join('/')}) is not supported by this browser's WebCodecs VideoEncoder.`,
        { format: this.format, width: config.width, height: config.height },
      );
    }
    this.codec = selectedCodec;

    const canvas = document.createElement('canvas');
    canvas.width = config.width;
    canvas.height = config.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new AppError('ERR_EXPORT_FAILED', 'Unable to create 2D export canvas.');
    }

    const formatObj =
      this.format === 'mp4'
        ? new Mp4OutputFormat()
        : this.format === 'mov'
          ? new MovOutputFormat()
          : new WebMOutputFormat();

    const target = new BufferTarget();
    const output = new Output({ format: formatObj, target });
    const source = new CanvasSource(canvas, {
      codec: selectedCodec,
      quality: QUALITY_HIGH,
    });
    output.addVideoTrack(source, { frameRate });
    await output.start();

    this.ctx = ctx;
    this.output = output;
    this.source = source;
  }

  public async append(frame: {
    ptsSeconds: number;
    durationSeconds: number;
    rgba: Uint8Array;
    width: number;
    height: number;
  }): Promise<void> {
    if (this.aborted || !this.source || !this.ctx) {
      return;
    }
    compositeRgbaToCanvas(
      this.ctx,
      frame.rgba,
      frame.width,
      frame.height,
      this.alpha,
      this.matteColor,
    );
    await this.source.add(frame.ptsSeconds, frame.durationSeconds);
  }

  public async finish(): Promise<Uint8Array> {
    if (!this.output) {
      throw new AppError('ERR_EXPORT_FAILED', 'Video output not initialized.');
    }
    await this.output.finalize();
    const buffer = this.output.target.buffer;
    this.cleanup();
    if (!buffer) {
      throw new AppError('ERR_EXPORT_FAILED', 'Mediabunny produced an empty buffer.');
    }
    return new Uint8Array(buffer);
  }

  public async abort(): Promise<void> {
    this.aborted = true;
    if (this.output) {
      try {
        await this.output.cancel();
      } catch {
        // Ignore cancel errors during cleanup
      }
    }
    this.cleanup();
  }

  private cleanup(): void {
    this.output = null;
    this.source = null;
    this.ctx = null;
  }
}
