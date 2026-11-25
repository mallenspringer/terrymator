import { QUALITY_HIGH, canEncodeVideo } from 'mediabunny';
import type { WebGlCapabilities } from '../render/capabilities';
import type { CapabilityReport, CodecCapabilityEntry } from './types';

async function probeCodec(
  format: 'mp4' | 'mov' | 'webm',
  codec: 'avc' | 'vp9' | 'vp8',
  width: number,
  height: number,
  frameRate: number,
): Promise<CodecCapabilityEntry> {
  const resolution = `${width}x${height}@${frameRate}`;
  if (typeof globalThis.VideoEncoder !== 'function') {
    return {
      format,
      codec,
      resolution,
      supported: false,
      reason: 'WebCodecs VideoEncoder API is not available in this runtime.',
    };
  }
  try {
    const supported = await canEncodeVideo(codec, {
      width,
      height,
      frameRate,
      quality: QUALITY_HIGH,
    });
    return {
      format,
      codec,
      resolution,
      supported,
      ...(supported
        ? {}
        : {
            reason: `Browser VideoEncoder reported "${codec}" unsupported for ${resolution}.`,
          }),
    };
  } catch (err) {
    return {
      format,
      codec,
      resolution,
      supported: false,
      reason: err instanceof Error ? err.message : 'Unknown codec probe failure.',
    };
  }
}

export async function probeExportCapabilities(webgl: WebGlCapabilities): Promise<CapabilityReport> {
  const codecs: CodecCapabilityEntry[] = [
    {
      format: 'png-sequence',
      codec: 'png-rgba',
      resolution: 'any',
      supported: true,
    },
    {
      format: 'png-still',
      codec: 'png-rgba',
      resolution: 'any',
      supported: true,
    },
    {
      format: 'gif',
      codec: 'gif89a-256',
      resolution: 'any',
      supported: true,
    },
    await probeCodec('mp4', 'avc', 320, 180, 24),
    await probeCodec('mp4', 'avc', 1920, 1080, 24),
    await probeCodec('mov', 'avc', 320, 180, 24),
    await probeCodec('mov', 'avc', 1920, 1080, 24),
    await probeCodec('webm', 'vp9', 320, 180, 24),
    await probeCodec('webm', 'vp9', 1920, 1080, 24),
    await probeCodec('webm', 'vp8', 320, 180, 24),
  ];

  return {
    probedAtIso: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
    platform: typeof navigator !== 'undefined' ? navigator.platform : 'node',
    webgl: {
      available: webgl.available,
      contextType: webgl.contextType,
      renderer: webgl.renderer,
      vendor: webgl.vendor,
      unmaskedRenderer: webgl.unmaskedRenderer,
      maxTextureSize: webgl.maxTextureSize,
      hasWebCodecsVideoEncoder: webgl.hasWebCodecsVideoEncoder,
    },
    codecs,
  };
}
