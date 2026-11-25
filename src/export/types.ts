import type { RationalFps, TickRange } from '../domain/time';

export type ExportFormat = 'png-sequence' | 'png-still' | 'gif' | 'mp4' | 'mov' | 'webm';

export interface ExportOptions {
  format: ExportFormat;
  range: TickRange;
  fps: RationalFps;
  width?: number;
  height?: number;
  alpha: boolean;
  matteColor?: string;
  signal?: AbortSignal;
  onProgress?: (progress: { completedFrames: number; totalFrames: number }) => void;
}

export interface ExportArtifact {
  format: ExportFormat;
  mimeType: string;
  extension: string;
  bytes: Uint8Array;
  frameCount: number;
  width: number;
  height: number;
  fps: RationalFps;
  alpha: boolean;
  codec?: string;
  maxQueueDepth: number;
  durationMs: number;
}

export interface EncoderAdapter {
  readonly format: ExportFormat;
  readonly codec?: string;
  start(config: {
    width: number;
    height: number;
    fps: RationalFps;
    alpha: boolean;
    matteColor: string;
    totalFrames: number;
  }): Promise<void>;
  append(frame: {
    index: number;
    shotTick: number;
    ptsSeconds: number;
    durationSeconds: number;
    rgba: Uint8Array;
    width: number;
    height: number;
  }): Promise<void>;
  finish(): Promise<Uint8Array>;
  abort(): Promise<void>;
}

export interface CodecCapabilityEntry {
  format: 'mp4' | 'mov' | 'webm' | 'gif' | 'png-sequence' | 'png-still';
  codec: string;
  resolution: string;
  supported: boolean;
  reason?: string;
}

export interface CapabilityReport {
  probedAtIso: string;
  userAgent: string;
  platform: string;
  webgl: {
    available: boolean;
    contextType: string;
    renderer: string;
    vendor: string;
    unmaskedRenderer: string | null;
    maxTextureSize: number;
    hasWebCodecsVideoEncoder: boolean;
  };
  codecs: CodecCapabilityEntry[];
}
