import { AppError } from '../domain/errors';
import { evaluateScene } from '../domain/evaluator';
import type { Project } from '../domain/schema';
import { planFrames } from '../domain/time';
import type { BlobRecord } from '../persistence/zip';
import type { PixiStageRenderer } from '../render/pixiAdapter';
import { GifEncoderAdapter } from './gifEncoder';
import { PngSequenceZipEncoderAdapter, PngStillEncoderAdapter } from './pngEncoder';
import type { EncoderAdapter, ExportArtifact, ExportFormat, ExportOptions } from './types';
import { MediabunnyVideoEncoderAdapter } from './videoEncoder';

const FORMAT_META: Record<ExportFormat, { mimeType: string; extension: string }> = {
  'png-sequence': { mimeType: 'application/zip', extension: 'zip' },
  'png-still': { mimeType: 'image/png', extension: 'png' },
  gif: { mimeType: 'image/gif', extension: 'gif' },
  mp4: { mimeType: 'video/mp4', extension: 'mp4' },
  mov: { mimeType: 'video/quicktime', extension: 'mov' },
  webm: { mimeType: 'video/webm', extension: 'webm' },
};

function createAdapter(format: ExportFormat): EncoderAdapter {
  switch (format) {
    case 'png-sequence':
      return new PngSequenceZipEncoderAdapter();
    case 'png-still':
      return new PngStillEncoderAdapter();
    case 'gif':
      return new GifEncoderAdapter();
    case 'mp4':
      return new MediabunnyVideoEncoderAdapter('mp4', 'avc');
    case 'mov':
      return new MediabunnyVideoEncoderAdapter('mov', 'avc');
    case 'webm':
      return new MediabunnyVideoEncoderAdapter('webm', 'vp9');
  }
}

export async function exportProjectRange(
  project: Project,
  blobs: Map<string, BlobRecord>,
  renderer: PixiStageRenderer,
  options: ExportOptions,
): Promise<ExportArtifact> {
  const startMs = performance.now();
  const width = options.width ?? project.shot.width;
  const height = options.height ?? project.shot.height;
  const frames =
    options.format === 'png-still'
      ? planFrames(options.range, options.fps).slice(0, 1)
      : planFrames(options.range, options.fps);

  const adapter = createAdapter(options.format);
  const matteColor = options.matteColor ?? project.shot.background.color;

  let inFlight = 0;
  let maxQueueDepth = 0;
  let started = false;

  renderer.trackEncoder(1);
  try {
    await adapter.start({
      width,
      height,
      fps: options.fps,
      alpha: options.alpha,
      matteColor,
      totalFrames: frames.length,
    });
    started = true;

    for (const planned of frames) {
      if (options.signal?.aborted) {
        throw new AppError('ERR_EXPORT_CANCELLED', 'Export was cancelled.');
      }

      const scene = evaluateScene(project, planned.shotTick, {
        outputWidth: width,
        outputHeight: height,
      });

      const rendered = await renderer.renderToRgba(scene, blobs, {
        outputWidth: width,
        outputHeight: height,
        transparentBackground: options.alpha,
      });

      if (options.signal?.aborted) {
        throw new AppError('ERR_EXPORT_CANCELLED', 'Export was cancelled.');
      }

      inFlight += 1;
      maxQueueDepth = Math.max(maxQueueDepth, inFlight);
      try {
        await adapter.append({
          index: planned.index,
          shotTick: planned.shotTick,
          ptsSeconds: planned.ptsSeconds,
          durationSeconds: planned.durationSeconds,
          rgba: rendered.rgba,
          width: rendered.width,
          height: rendered.height,
        });
      } finally {
        inFlight -= 1;
      }

      options.onProgress?.({
        completedFrames: planned.index + 1,
        totalFrames: frames.length,
      });
    }

    const bytes = await adapter.finish();
    const meta = FORMAT_META[options.format];
    return {
      format: options.format,
      mimeType: meta.mimeType,
      extension: meta.extension,
      bytes,
      frameCount: frames.length,
      width,
      height,
      fps: options.fps,
      alpha: options.alpha,
      ...(adapter.codec ? { codec: adapter.codec } : {}),
      maxQueueDepth,
      durationMs: Math.round(performance.now() - startMs),
    };
  } catch (err) {
    if (started) {
      await adapter.abort();
    }
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(
      'ERR_EXPORT_FAILED',
      err instanceof Error ? err.message : 'Export pipeline failed.',
    );
  } finally {
    renderer.trackEncoder(-1);
  }
}
