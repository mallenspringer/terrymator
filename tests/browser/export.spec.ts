import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { PNG } from 'pngjs';
import { expect, test } from '@playwright/test';
import type { CapabilityReport } from '../../src/export/types';
import type { StudioHarness } from '../../src/test-harness/harness';

declare global {
  interface Window {
    __TERRYMATOR_HARNESS__?: StudioHarness;
  }
}

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findYellowBlockCenterX(rgb: Buffer, width: number, height: number, ySample = 56): number {
  let sumX = 0;
  let count = 0;
  for (let x = 0; x < width; x += 1) {
    const idx = (ySample * width + x) * 3;
    const r = rgb[idx]!;
    const g = rgb[idx + 1]!;
    const b = rgb[idx + 2]!;
    if (r > 180 && g > 150 && b < 80) {
      sumX += x;
      count += 1;
    }
  }
  if (count === 0 || ySample >= height) {
    return -1;
  }
  return sumX / count;
}

test.describe('Export pipeline & independent validation', () => {
  test('probes capabilities and validates PNG sequence, GIF, video codecs, and cancellation', async ({
    page,
  }, testInfo) => {
    const projName = testInfo.project.name;
    const outDir = path.resolve('artifacts/g0');
    fs.mkdirSync(outDir, { recursive: true });

    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__TERRYMATOR_HARNESS__));

    const caps: CapabilityReport = await page.evaluate(async () => {
      const h = window.__TERRYMATOR_HARNESS__!;
      await h.loadFixture('F09_EXPORT_CLOCK');
      return h.probeCapabilities();
    });

    fs.writeFileSync(
      path.join(outDir, `capability-report-${projName}.json`),
      JSON.stringify(caps, null, 2),
    );
    expect(caps.webgl.available).toBe(true);

    // 1. Mandatory PNG Sequence ZIP (alpha = true)
    const pngSeqArtifact = await page.evaluate(async () => {
      const h = window.__TERRYMATOR_HARNESS__!;
      return h.exportRange({
        format: 'png-sequence',
        range: { inTick: 0, outTick: 60_000 },
        fps: { num: 24, den: 1 },
        alpha: true,
      });
    });

    expect(pngSeqArtifact.frameCount).toBe(12);
    expect(pngSeqArtifact.maxQueueDepth).toBeLessThanOrEqual(3);
    const pngZipBytes = new Uint8Array(pngSeqArtifact.bytes);
    fs.writeFileSync(path.join(outDir, `f09-png-seq-${projName}.zip`), pngZipBytes);

    const unzipped = unzipSync(pngZipBytes);
    const seqManifest = JSON.parse(Buffer.from(unzipped['manifest.json']!).toString('utf8')) as {
      frameCount: number;
      frames: Array<{ index: number; file: string; shotTick: number; ptsSeconds: number }>;
    };
    expect(seqManifest.frameCount).toBe(12);

    const framesDir = path.join(outDir, `f09-frames-${projName}`);
    fs.mkdirSync(framesDir, { recursive: true });

    for (let i = 0; i < 12; i += 1) {
      const name = `frame_${String(i).padStart(4, '0')}.png`;
      const rawPng = unzipped[name]!;
      expect(rawPng).toBeDefined();
      if (i === 0 || i === 6 || i === 11) {
        fs.writeFileSync(path.join(framesDir, name), rawPng);
      }
      const decoded = PNG.sync.read(Buffer.from(rawPng));
      expect(decoded.width).toBe(320);
      expect(decoded.height).toBe(180);

      // Transparent corner check
      const bgIdx = (5 * 320 + 315) * 4;
      expect(decoded.data[bgIdx + 3]).toBe(0);

      // Moving yellow square center check: x(i) = 24 + i * 22, center = x(i) + 16
      const expectedCenterX = 24 + i * 22 + 16;
      const centerIdx = (56 * 320 + expectedCenterX) * 4;
      expect(decoded.data[centerIdx]).toBe(255);
      expect(decoded.data[centerIdx + 1]).toBe(220);
      expect(decoded.data[centerIdx + 2]).toBe(0);
      expect(decoded.data[centerIdx + 3]).toBe(255);
    }

    // Semitransparent square check on frame 0 at (156, 30)
    const frame0 = PNG.sync.read(Buffer.from(unzipped['frame_0000.png']!));
    const semiIdx = (30 * 320 + 156) * 4;
    expect(frame0.data[semiIdx + 3]).toBeGreaterThanOrEqual(126);
    expect(frame0.data[semiIdx + 3]).toBeLessThanOrEqual(130);

    // 2. Animated GIF export
    const gifArtifact = await page.evaluate(async () => {
      const h = window.__TERRYMATOR_HARNESS__!;
      return h.exportRange({
        format: 'gif',
        range: { inTick: 0, outTick: 60_000 },
        fps: { num: 24, den: 1 },
        alpha: false,
        matteColor: '#10141e',
      });
    });

    const gifBytes = Buffer.from(gifArtifact.bytes);
    const gifPath = path.join(outDir, `f09-${projName}.gif`);
    fs.writeFileSync(gifPath, gifBytes);
    expect(gifBytes.subarray(0, 6).toString('ascii')).toBe('GIF89a');
    expect(gifBytes.includes(Buffer.from('NETSCAPE2.0'))).toBe(true);

    const ffmpegAvailable = hasFfmpeg();
    if (ffmpegAvailable) {
      const probeGif = JSON.parse(
        execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', gifPath], {
          encoding: 'utf8',
        }),
      ) as { streams: Array<{ codec_name: string; width: number; height: number }> };
      expect(probeGif.streams[0]?.codec_name).toBe('gif');
      expect(probeGif.streams[0]?.width).toBe(320);
      expect(probeGif.streams[0]?.height).toBe(180);
    }

    // 3. Video exports (MP4, MOV, WebM) based on probed capabilities
    const videoTargets: Array<{ format: 'mp4' | 'mov' | 'webm'; codec: string }> = [
      { format: 'mp4', codec: 'avc' },
      { format: 'mov', codec: 'avc' },
      { format: 'webm', codec: 'vp9' },
    ];

    for (const target of videoTargets) {
      const capEntry = caps.codecs.find(
        (c) => c.format === target.format && c.resolution === '320x180@24',
      );
      if (!capEntry?.supported) {
        testInfo.annotations.push({
          type: 'unsupported-codec',
          description: `[${projName}] ${target.format}/${target.codec} unsupported: ${capEntry?.reason ?? 'unknown'}`,
        });
        continue;
      }

      const vidArtifact = await page.evaluate(async (fmt) => {
        const h = window.__TERRYMATOR_HARNESS__!;
        return h.exportRange({
          format: fmt,
          range: { inTick: 0, outTick: 60_000 },
          fps: { num: 24, den: 1 },
          alpha: false,
          matteColor: '#10141e',
        });
      }, target.format);

      expect(vidArtifact.frameCount).toBe(12);
      expect(vidArtifact.maxQueueDepth).toBeLessThanOrEqual(3);
      const vidPath = path.join(outDir, `f09-${projName}.${vidArtifact.extension}`);
      fs.writeFileSync(vidPath, Buffer.from(vidArtifact.bytes));

      if (ffmpegAvailable) {
        const probeJson = JSON.parse(
          execFileSync(
            'ffprobe',
            ['-v', 'error', '-show_format', '-show_streams', '-show_frames', '-of', 'json', vidPath],
            { encoding: 'utf8' },
          ),
        ) as {
          streams: Array<{ codec_name: string; width: number; height: number }>;
          frames: Array<{ pts_time?: string }>;
        };

        expect(probeJson.streams[0]?.width).toBe(320);
        expect(probeJson.streams[0]?.height).toBe(180);
        expect(probeJson.frames.length).toBe(12);

        // Verify monotonic PTS starting at 0
        let prevPts = -1;
        for (const f of probeJson.frames) {
          const pts = Number(f.pts_time ?? 0);
          expect(pts).toBeGreaterThan(prevPts);
          prevPts = pts;
        }
        expect(Number(probeJson.frames[0]?.pts_time ?? 0)).toBeCloseTo(0, 3);

        // Decode raw RGB frames via ffmpeg and verify moving yellow square shifted right
        const rawRgb = execFileSync(
          'ffmpeg',
          ['-v', 'error', '-i', vidPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
          { maxBuffer: 16 * 1024 * 1024 },
        );
        const frameSize = 320 * 180 * 3;
        expect(rawRgb.byteLength).toBe(frameSize * 12);

        const c0 = findYellowBlockCenterX(rawRgb.subarray(0, frameSize), 320, 180);
        const c10 = findYellowBlockCenterX(
          rawRgb.subarray(10 * frameSize, 11 * frameSize),
          320,
          180,
        );
        expect(Math.abs(c0 - (24 + 16))).toBeLessThanOrEqual(3);
        expect(Math.abs(c10 - (24 + 10 * 22 + 16))).toBeLessThanOrEqual(3);
      }
    }

    // 4. Export cancellation & resource cleanup
    const cancelResult = await page.evaluate(async () => {
      const h = window.__TERRYMATOR_HARNESS__!;
      let code = 'NONE';
      try {
        await h.exportRange({
          format: 'png-sequence',
          range: { inTick: 0, outTick: 60_000 },
          fps: { num: 24, den: 1 },
          alpha: true,
          abortAfterFrames: 3,
        });
      } catch (err) {
        code = (err as { code?: string }).code ?? 'UNKNOWN';
      }
      return { code, resources: h.resources() };
    });

    expect(cancelResult.code).toBe('ERR_EXPORT_CANCELLED');
    expect(cancelResult.resources.activeEncoders).toBe(0);
  });
});
