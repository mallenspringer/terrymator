import { ProjectStore, type ReplayLog, type ReplayReport } from '../application/store';
import type { Command } from '../domain/commands';
import type { EvaluatedScene } from '../domain/evaluator';
import type { Project } from '../domain/schema';
import { probeExportCapabilities } from '../export/capabilities';
import { exportProjectRange } from '../export/pipeline';
import type { CapabilityReport, ExportOptions } from '../export/types';
import { packArchive, unpackArchive } from '../persistence/zip';
import { probeWebGlCapabilities } from '../render/capabilities';
import { PixiStageRenderer, type RenderOptions, type ResourceCounters } from '../render/pixiAdapter';
import { loadFixtureById } from './fixtures';

export interface FrameArtifactDto {
  width: number;
  height: number;
  rgba: number[];
  pngBytes: number[];
}

export interface ExportArtifactDto {
  format: string;
  mimeType: string;
  extension: string;
  bytes: number[];
  frameCount: number;
  width: number;
  height: number;
  fps: { num: number; den: number };
  alpha: boolean;
  codec?: string;
  maxQueueDepth: number;
  durationMs: number;
}

export interface StudioHarness {
  loadFixture(id: string): Promise<void>;
  loadArchive(bytes: number[]): Promise<void>;
  packCurrentArchive(): Promise<number[]>;
  dispatch(command: Command): Promise<Project>;
  snapshot(): Project;
  evaluate(tick: number): EvaluatedScene;
  render(tick: number, options?: RenderOptions): Promise<FrameArtifactDto>;
  exportRange(
    options: Omit<ExportOptions, 'signal' | 'onProgress'> & { abortAfterFrames?: number },
  ): Promise<ExportArtifactDto>;
  replay(log: ReplayLog): Promise<ReplayReport>;
  resources(): ResourceCounters;
  probeCapabilities(): Promise<CapabilityReport>;
  dispose(): void;
}

async function decodePngInBrowser(
  pngBytes: Uint8Array,
): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const copy = new Uint8Array(pngBytes.byteLength);
  copy.set(pngBytes);
  const blob = new Blob([copy.buffer], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return {
    width: imgData.width,
    height: imgData.height,
    rgba: new Uint8Array(imgData.data.buffer),
  };
}

export function createStudioHarness(): StudioHarness {
  const store = new ProjectStore();
  const renderer = new PixiStageRenderer();

  return {
    async loadFixture(id: string): Promise<void> {
      const fixture = loadFixtureById(id);
      store.load(fixture.project, fixture.blobs);
    },

    async loadArchive(bytes: number[]): Promise<void> {
      const unpacked = await unpackArchive(new Uint8Array(bytes), decodePngInBrowser);
      store.load(unpacked.project, unpacked.blobs);
    },

    async packCurrentArchive(): Promise<number[]> {
      const packed = await packArchive(store.snapshot(), store.getBlobs());
      return Array.from(packed);
    },

    async dispatch(command: Command): Promise<Project> {
      return store.dispatch(command);
    },

    snapshot(): Project {
      return store.snapshot();
    },

    evaluate(tick: number): EvaluatedScene {
      return store.evaluate(tick);
    },

    async render(tick: number, options?: RenderOptions): Promise<FrameArtifactDto> {
      const scene = store.evaluate(tick, {
        outputWidth: options?.outputWidth,
        outputHeight: options?.outputHeight,
      });
      const result = await renderer.renderToPng(scene, store.getBlobs(), options);
      return {
        width: result.width,
        height: result.height,
        rgba: Array.from(result.rgba),
        pngBytes: Array.from(result.pngBytes),
      };
    },

    async exportRange(options): Promise<ExportArtifactDto> {
      const controller = new AbortController();
      const { abortAfterFrames, ...exportOpts } = options;
      const artifact = await exportProjectRange(store.snapshot(), store.getBlobs(), renderer, {
        ...exportOpts,
        signal: controller.signal,
        onProgress(progress) {
          if (abortAfterFrames !== undefined && progress.completedFrames >= abortAfterFrames) {
            controller.abort();
          }
        },
      });
      return {
        format: artifact.format,
        mimeType: artifact.mimeType,
        extension: artifact.extension,
        bytes: Array.from(artifact.bytes),
        frameCount: artifact.frameCount,
        width: artifact.width,
        height: artifact.height,
        fps: artifact.fps,
        alpha: artifact.alpha,
        ...(artifact.codec ? { codec: artifact.codec } : {}),
        maxQueueDepth: artifact.maxQueueDepth,
        durationMs: artifact.durationMs,
      };
    },

    async replay(log: ReplayLog): Promise<ReplayReport> {
      return store.replay(log);
    },

    resources(): ResourceCounters {
      return renderer.getResourceCounters();
    },

    async probeCapabilities(): Promise<CapabilityReport> {
      return probeExportCapabilities(probeWebGlCapabilities());
    },

    dispose(): void {
      renderer.dispose();
    },
  };
}

declare global {
  interface Window {
    __TERRYMATOR_HARNESS__?: StudioHarness;
  }
}

export function mountHarness(): StudioHarness {
  const harness = createStudioHarness();
  window.__TERRYMATOR_HARNESS__ = harness;
  return harness;
}
