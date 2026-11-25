import { useEffect, useMemo, useRef, useState } from 'react';
import type { BlobRecord } from '../application/blobStore';
import { isAppError } from '../domain/errors';
import type { Project } from '../domain/schema';
import { SUPPORTED_INTEGER_FPS, planFrames, type RationalFps } from '../domain/time';
import { probeExportCapabilities } from '../export/capabilities';
import { exportProjectRange } from '../export/pipeline';
import type { CapabilityReport, ExportFormat } from '../export/types';
import { downloadBytes } from '../persistence/fileIO';
import { probeWebGlCapabilities } from '../render/capabilities';
import { PixiStageRenderer } from '../render/pixiAdapter';

interface ExportModalProps {
  open: boolean;
  project: Project;
  blobs: Map<string, BlobRecord>;
  currentTick: number;
  onClose: () => void;
}

type RangeMode = 'work-range' | 'full-shot';
type ResolutionPreset = 'shot' | '1080p' | '720p' | '540p';

const FORMAT_LABELS: Record<ExportFormat, string> = {
  'png-sequence': 'PNG Sequence (.zip)',
  'png-still': 'Current Frame PNG (.png)',
  gif: 'Animated GIF (.gif)',
  mp4: 'MP4 Video (.mp4)',
  mov: 'QuickTime MOV (.mov)',
  webm: 'WebM Video (.webm)',
};

const FORMAT_ORDER: ExportFormat[] = ['png-sequence', 'png-still', 'gif', 'mp4', 'mov', 'webm'];

function resolveDimensions(
  preset: ResolutionPreset,
  shotWidth: number,
  shotHeight: number,
): { width: number; height: number } {
  switch (preset) {
    case '1080p':
      return { width: 1920, height: 1080 };
    case '720p':
      return { width: 1280, height: 720 };
    case '540p':
      return { width: 960, height: 540 };
    case 'shot':
    default:
      return { width: shotWidth, height: shotHeight };
  }
}

export function ExportModal({ open, project, blobs, currentTick, onClose }: ExportModalProps) {
  const [capabilities, setCapabilities] = useState<CapabilityReport | null>(null);
  const [format, setFormat] = useState<ExportFormat>('png-sequence');
  const [rangeMode, setRangeMode] = useState<RangeMode>('work-range');
  const [resPreset, setResPreset] = useState<ResolutionPreset>('shot');
  const [fpsNum, setFpsNum] = useState<number>(project.shot.fps.num);
  const [alpha, setAlpha] = useState<boolean>(true);
  const [matteColor, setMatteColor] = useState<string>(project.shot.background.color);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [progress, setProgress] = useState<{
    completedFrames: number;
    totalFrames: number;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const webgl = probeWebGlCapabilities();
    void probeExportCapabilities(webgl).then((report) => {
      if (active) {
        setCapabilities(report);
      }
    });
    return () => {
      active = false;
    };
  }, [open]);

  const fps: RationalFps = useMemo(() => ({ num: fpsNum, den: 1 }), [fpsNum]);

  const range = useMemo(() => {
    if (format === 'png-still') {
      const clamped = Math.max(0, Math.min(project.shot.durationTicks - 1, currentTick));
      return { inTick: clamped, outTick: clamped + 1 };
    }
    if (rangeMode === 'work-range') {
      return {
        inTick: project.shot.workRange?.inTick ?? 0,
        outTick: project.shot.workRange?.outTick ?? project.shot.durationTicks,
      };
    }
    return { inTick: 0, outTick: project.shot.durationTicks };
  }, [currentTick, format, project.shot.durationTicks, project.shot.workRange, rangeMode]);

  const plannedFrames = useMemo(
    () => (format === 'png-still' ? 1 : planFrames(range, fps).length),
    [format, fps, range],
  );

  const { width, height } = resolveDimensions(resPreset, project.shot.width, project.shot.height);

  if (!open) return null;

  const formatCap = capabilities?.codecs.find((c) => c.format === format);
  const isSupported = formatCap ? formatCap.supported : true;

  const warnings: string[] = [];
  if (format === 'mp4' && alpha) {
    warnings.push(
      'MP4 (H.264) does not support alpha transparency; output will use the matte background.',
    );
  }
  if (format === 'mov' && alpha) {
    warnings.push('Browser H.264 MOV export is opaque; use PNG Sequence (.zip) for lossless RGBA.');
  }
  if (format === 'gif' && plannedFrames > 300) {
    warnings.push(
      `GIF export has ${plannedFrames} frames; large GIFs may take longer to encode.`,
    );
  }
  if (!isSupported && formatCap?.reason) {
    warnings.push(formatCap.reason);
  }

  const handleStartExport = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsExporting(true);
    setStatusMessage(null);
    setErrorMessage(null);
    setProgress({ completedFrames: 0, totalFrames: plannedFrames });

    const exportRenderer = new PixiStageRenderer();
    try {
      const artifact = await exportProjectRange(project, blobs, exportRenderer, {
        format,
        range,
        fps,
        width,
        height,
        alpha,
        matteColor,
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });
      const baseName =
        project.name.toLowerCase().replace(/[^a-z0-9-_]+/g, '-') || 'terrymator-shot';
      const filename = `${baseName}${artifact.extension}`;
      downloadBytes(artifact.bytes, filename, artifact.mimeType);
      setStatusMessage(
        `Exported ${filename} (${artifact.frameCount} frame${artifact.frameCount === 1 ? '' : 's'}, ${(artifact.bytes.byteLength / 1024).toFixed(1)} KB).`,
      );
    } catch (err) {
      if (isAppError(err) && err.code === 'ERR_EXPORT_CANCELLED') {
        setStatusMessage('Export cancelled.');
      } else {
        setErrorMessage(isAppError(err) ? `${err.code}: ${err.message}` : String(err));
      }
    } finally {
      exportRenderer.dispose();
      abortRef.current = null;
      setIsExporting(false);
    }
  };

  const handleCancel = () => {
    if (isExporting && abortRef.current) {
      abortRef.current.abort();
      return;
    }
    onClose();
  };

  const pct =
    progress && progress.totalFrames > 0
      ? Math.min(100, Math.round((progress.completedFrames / progress.totalFrames) * 100))
      : 0;

  return (
    <div className="modal-backdrop" data-testid="export-modal">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
        style={{ width: 460 }}
      >
        <div className="panel-heading" style={{ marginBottom: 4 }}>
          <span id="export-modal-title">Export Shot</span>
          <button
            type="button"
            className="studio-btn"
            data-testid="export-close-btn"
            disabled={isExporting}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <label className="field-label">
          Format
          <select
            className="studio-select"
            data-testid="export-format-select"
            disabled={isExporting}
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
          >
            {FORMAT_ORDER.map((fmt) => {
              const cap = capabilities?.codecs.find((c) => c.format === fmt);
              const suffix = cap && !cap.supported ? ' (Unsupported)' : '';
              return (
                <option key={fmt} value={fmt}>
                  {FORMAT_LABELS[fmt]}
                  {suffix}
                </option>
              );
            })}
          </select>
        </label>

        <div className="grid-2">
          <label className="field-label">
            Range
            <select
              className="studio-select"
              data-testid="export-range-select"
              disabled={isExporting || format === 'png-still'}
              value={rangeMode}
              onChange={(e) => setRangeMode(e.target.value as RangeMode)}
            >
              <option value="work-range">Work Range</option>
              <option value="full-shot">Full Shot</option>
            </select>
          </label>

          <label className="field-label">
            Resolution
            <select
              className="studio-select"
              data-testid="export-res-select"
              disabled={isExporting}
              value={resPreset}
              onChange={(e) => setResPreset(e.target.value as ResolutionPreset)}
            >
              <option value="shot">
                Shot ({project.shot.width}×{project.shot.height})
              </option>
              <option value="1080p">1080p (1920×1080)</option>
              <option value="720p">720p (1280×720)</option>
              <option value="540p">540p (960×540)</option>
            </select>
          </label>
        </div>

        <div className="grid-2">
          <label className="field-label">
            Frame Rate (FPS)
            <select
              className="studio-select"
              data-testid="export-fps-select"
              disabled={isExporting || format === 'png-still'}
              value={fpsNum}
              onChange={(e) => setFpsNum(Number(e.target.value))}
            >
              {SUPPORTED_INTEGER_FPS.map((rate) => (
                <option key={rate} value={rate}>
                  {rate} fps
                </option>
              ))}
            </select>
          </label>

          <div className="field-label" style={{ justifyContent: 'flex-end', gap: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#e6eaf2' }}>
              <input
                type="checkbox"
                data-testid="export-alpha-checkbox"
                disabled={isExporting}
                checked={alpha}
                onChange={(e) => setAlpha(e.target.checked)}
              />
              Transparent Alpha
            </label>
            {!alpha && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>Matte</span>
                <input
                  type="color"
                  data-testid="export-matte-input"
                  disabled={isExporting}
                  value={matteColor}
                  onChange={(e) => setMatteColor(e.target.value)}
                />
              </label>
            )}
          </div>
        </div>

        <div style={{ fontSize: 12, color: '#9aa6b8' }}>
          Output: {width}×{height} • {plannedFrames} frame{plannedFrames === 1 ? '' : 's'}
          {capabilities ? ` • WebGL ${capabilities.webgl.maxTextureSize}px max` : ''}
        </div>

        {warnings.length > 0 && (
          <div
            data-testid="export-warnings"
            style={{
              background: '#2a2212',
              border: '1px solid #6b4e18',
              color: '#f7d08a',
              borderRadius: 4,
              padding: '6px 8px',
              fontSize: 11,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        )}

        {progress && (
          <div data-testid="export-progress" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="row-between" style={{ fontSize: 11, color: '#cbd5e1' }}>
              <span>Exporting...</span>
              <span>
                {progress.completedFrames} / {progress.totalFrames} ({pct}%)
              </span>
            </div>
            <div
              style={{
                height: 6,
                background: '#0f1218',
                border: '1px solid #2b3242',
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: '#3b82f6',
                  transition: 'width 80ms linear',
                }}
              />
            </div>
          </div>
        )}

        {statusMessage && (
          <div data-testid="export-status" style={{ fontSize: 12, color: '#86efac' }}>
            {statusMessage}
          </div>
        )}

        {errorMessage && (
          <div data-testid="export-error" style={{ fontSize: 12, color: '#fca5a5' }} role="alert">
            {errorMessage}
          </div>
        )}

        <div className="row-between" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="studio-btn"
            data-testid="export-cancel-btn"
            onClick={handleCancel}
          >
            {isExporting ? 'Cancel Export' : 'Cancel'}
          </button>
          <button
            type="button"
            className="studio-btn primary"
            data-testid="export-start-btn"
            disabled={isExporting || !isSupported}
            onClick={() => void handleStartExport()}
          >
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
