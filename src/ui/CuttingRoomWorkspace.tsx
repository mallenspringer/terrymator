import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { BlobRecord } from '../application/blobStore';
import {
  applyAlphaBrushStroke,
  applyCloneStampStroke,
  applyColorBrushStroke,
  applySelectionToMask,
  colorSelect,
  combineSelection,
  compositeCutoutAsset,
  extendCutoutBuffers,
  extractMaskFromRgba,
  featherMask,
  growMask,
  magicWandSelect,
  rasterizeLasso,
  shrinkMask,
  type EditRect,
  type SelectionCombineMode,
  type SelectionMaskAction,
} from '../assets/cutting';
import type { Point2D } from '../domain/math';
import type { CutoutAsset, SourceRecord } from '../domain/schema';

type CuttingTool = 'wand' | 'color' | 'lasso' | 'restore' | 'erase' | 'clone' | 'paint';
type PreviewBg = 'checker' | 'dark' | 'light';

interface CuttingRoomWorkspaceProps {
  cutouts: CutoutAsset[];
  sources: Record<string, SourceRecord>;
  blobs: Map<string, BlobRecord>;
  activeAssetId: string | null;
  onSelectAsset: (assetId: string) => void;
  onCommitEdit: (params: {
    assetId: string;
    editRect: EditRect;
    mask: Uint8Array | null;
    overlay: Uint8Array | null;
    anchorX: number;
    anchorY: number;
    label: string;
  }) => Promise<void>;
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function CuttingRoomWorkspace({
  cutouts,
  sources,
  blobs,
  activeAssetId,
  onSelectAsset,
  onCommitEdit,
}: CuttingRoomWorkspaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<CuttingTool>('wand');
  const [selMode, setSelMode] = useState<SelectionCombineMode>('replace');
  const [tolerance, setTolerance] = useState<number>(24);
  const [brushRadius, setBrushRadius] = useState<number>(8);
  const [brushHardness, setBrushHardness] = useState<number>(0.8);
  const [brushOpacity, setBrushOpacity] = useState<number>(1);
  const [brushColor, setBrushColor] = useState<string>('#e07a5f');
  const [cloneOffsetX, setCloneOffsetX] = useState<number>(-20);
  const [cloneOffsetY, setCloneOffsetY] = useState<number>(0);
  const [morphRadius, setMorphRadius] = useState<number>(2);
  const [previewBg, setPreviewBg] = useState<PreviewBg>('checker');

  const [selection, setSelection] = useState<Uint8Array | null>(null);
  const [lassoPoints, setLassoPoints] = useState<Point2D[]>([]);

  const strokeRef = useRef<{
    points: Point2D[];
    preComposite: Uint8Array;
    workingMask: Uint8Array;
    workingOverlay: Uint8Array;
  } | null>(null);

  const asset = useMemo(
    () => cutouts.find((c) => c.id === activeAssetId) ?? cutouts[0] ?? null,
    [activeAssetId, cutouts],
  );
  const source = asset ? sources[asset.sourceId] : undefined;
  const sourceBlob = source ? blobs.get(source.blobId) : undefined;

  const currentMask = useMemo(() => {
    if (!asset) return null;
    if (asset.maskBlobId) {
      const mBlob = blobs.get(asset.maskBlobId);
      if (mBlob) return extractMaskFromRgba(mBlob.rgba);
    }
    return new Uint8Array(asset.editRect.width * asset.editRect.height).fill(255);
  }, [asset, blobs]);

  const currentOverlay = useMemo(() => {
    if (!asset) return null;
    if (asset.overlayBlobId) {
      const oBlob = blobs.get(asset.overlayBlobId);
      if (oBlob) return new Uint8Array(oBlob.rgba);
    }
    return new Uint8Array(asset.editRect.width * asset.editRect.height * 4);
  }, [asset, blobs]);

  const compositeRgba = useMemo(() => {
    if (!asset || !sourceBlob || !currentMask || !currentOverlay) return null;
    return compositeCutoutAsset(
      sourceBlob.rgba,
      sourceBlob.width,
      sourceBlob.height,
      asset.editRect,
      currentMask,
      currentOverlay,
      true,
    );
  }, [asset, currentMask, currentOverlay, sourceBlob]);

  const drawCanvas = useCallback(
    (overrideRgba?: Uint8Array) => {
      const canvas = canvasRef.current;
      if (!canvas || !asset) return;
      const w = asset.editRect.width;
      const h = asset.editRect.height;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const rgba = overrideRgba ?? compositeRgba;
      if (!rgba) return;

      ctx.clearRect(0, 0, w, h);
      const copy = new Uint8ClampedArray(rgba.byteLength);
      copy.set(rgba);
      ctx.putImageData(new ImageData(copy, w, h), 0, 0);

      if (selection && selection.length === w * h) {
        const overlayData = ctx.getImageData(0, 0, w, h);
        for (let i = 0; i < selection.length; i += 1) {
          if (selection[i]! > 0) {
            const b = i * 4;
            overlayData.data[b] = Math.min(255, Math.round(overlayData.data[b]! * 0.6 + 34 * 0.4));
            overlayData.data[b + 1] = Math.min(
              255,
              Math.round(overlayData.data[b + 1]! * 0.6 + 211 * 0.4),
            );
            overlayData.data[b + 2] = Math.min(
              255,
              Math.round(overlayData.data[b + 2]! * 0.6 + 238 * 0.4),
            );
            overlayData.data[b + 3] = Math.max(overlayData.data[b + 3]!, 96);
          }
        }
        ctx.putImageData(overlayData, 0, 0);
      }

      if (lassoPoints.length >= 2) {
        ctx.save();
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(lassoPoints[0]!.x, lassoPoints[0]!.y);
        for (let i = 1; i < lassoPoints.length; i += 1) {
          ctx.lineTo(lassoPoints[i]!.x, lassoPoints[i]!.y);
        }
        ctx.stroke();
        ctx.restore();
      }
    },
    [asset, compositeRgba, lassoPoints, selection],
  );

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const toLocalPixel = (e: PointerEvent<HTMLCanvasElement>): Point2D => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = e.currentTarget.width / Math.max(1, rect.width);
    const scaleY = e.currentTarget.height / Math.max(1, rect.height);
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!asset || !sourceBlob || !currentMask || !currentOverlay) return;
    const pt = toLocalPixel(e);

    if (tool === 'clone' && e.altKey) {
      setCloneOffsetX(Math.round(pt.x));
      setCloneOffsetY(Math.round(pt.y));
      return;
    }

    if (tool === 'wand' || tool === 'color') {
      const unmasked = compositeCutoutAsset(
        sourceBlob.rgba,
        sourceBlob.width,
        sourceBlob.height,
        asset.editRect,
        null,
        currentOverlay,
        false,
      );
      const nextSel =
        tool === 'wand'
          ? magicWandSelect(unmasked, asset.editRect.width, asset.editRect.height, pt.x, pt.y, tolerance)
          : colorSelect(unmasked, asset.editRect.width, asset.editRect.height, pt.x, pt.y, tolerance);
      setSelection((prev) =>
        prev && prev.length === nextSel.length ? combineSelection(prev, nextSel, selMode) : nextSel,
      );
      return;
    }

    if (tool === 'lasso') {
      setLassoPoints((prev) => [...prev, pt]);
      return;
    }

    // Brush stroke tools: restore, erase, clone, paint
    e.currentTarget.setPointerCapture(e.pointerId);
    const preComposite = compositeCutoutAsset(
      sourceBlob.rgba,
      sourceBlob.width,
      sourceBlob.height,
      asset.editRect,
      null,
      currentOverlay,
      false,
    );
    strokeRef.current = {
      points: [pt],
      preComposite,
      workingMask: new Uint8Array(currentMask),
      workingOverlay: new Uint8Array(currentOverlay),
    };
  };

  const handlePointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const stroke = strokeRef.current;
    if (!stroke || !asset || !sourceBlob) return;
    const pt = toLocalPixel(e);
    stroke.points.push(pt);

    const w = asset.editRect.width;
    const h = asset.editRect.height;
    let nextMask = stroke.workingMask;
    let nextOverlay = stroke.workingOverlay;

    if (tool === 'restore' || tool === 'erase') {
      nextMask = applyAlphaBrushStroke(stroke.workingMask, w, h, stroke.points, {
        mode: tool,
        radius: brushRadius,
        hardness: brushHardness,
        opacity: brushOpacity,
      });
    } else if (tool === 'clone') {
      nextOverlay = applyCloneStampStroke(
        stroke.preComposite,
        stroke.workingOverlay,
        w,
        h,
        stroke.points,
        {
          offsetX: cloneOffsetX,
          offsetY: cloneOffsetY,
          radius: brushRadius,
          hardness: brushHardness,
          opacity: brushOpacity,
        },
      );
    } else if (tool === 'paint') {
      nextOverlay = applyColorBrushStroke(stroke.workingOverlay, w, h, stroke.points, {
        color: hexToRgbTuple(brushColor),
        radius: brushRadius,
        hardness: brushHardness,
        opacity: brushOpacity,
      });
    }

    const preview = compositeCutoutAsset(
      sourceBlob.rgba,
      sourceBlob.width,
      sourceBlob.height,
      asset.editRect,
      nextMask,
      nextOverlay,
      true,
    );
    drawCanvas(preview);
  };

  const handlePointerUp = async (e: PointerEvent<HTMLCanvasElement>) => {
    const stroke = strokeRef.current;
    if (!stroke || !asset) return;
    strokeRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const w = asset.editRect.width;
    const h = asset.editRect.height;
    let finalMask = stroke.workingMask;
    let finalOverlay: Uint8Array | null = asset.overlayBlobId ? stroke.workingOverlay : null;

    if (tool === 'restore' || tool === 'erase') {
      finalMask = applyAlphaBrushStroke(stroke.workingMask, w, h, stroke.points, {
        mode: tool,
        radius: brushRadius,
        hardness: brushHardness,
        opacity: brushOpacity,
      });
    } else if (tool === 'clone') {
      finalOverlay = applyCloneStampStroke(
        stroke.preComposite,
        stroke.workingOverlay,
        w,
        h,
        stroke.points,
        {
          offsetX: cloneOffsetX,
          offsetY: cloneOffsetY,
          radius: brushRadius,
          hardness: brushHardness,
          opacity: brushOpacity,
        },
      );
    } else if (tool === 'paint') {
      finalOverlay = applyColorBrushStroke(stroke.workingOverlay, w, h, stroke.points, {
        color: hexToRgbTuple(brushColor),
        radius: brushRadius,
        hardness: brushHardness,
        opacity: brushOpacity,
      });
    }

    await onCommitEdit({
      assetId: asset.id,
      editRect: asset.editRect,
      mask: finalMask,
      overlay: finalOverlay,
      anchorX: asset.anchorX,
      anchorY: asset.anchorY,
      label: `Cutting ${tool} stroke`,
    });
  };

  const handleCloseLasso = () => {
    if (!asset || lassoPoints.length < 3) return;
    const nextSel = rasterizeLasso(asset.editRect.width, asset.editRect.height, lassoPoints);
    setSelection((prev) =>
      prev && prev.length === nextSel.length ? combineSelection(prev, nextSel, selMode) : nextSel,
    );
    setLassoPoints([]);
  };

  const handleApplySelection = async (action: SelectionMaskAction) => {
    if (!asset || !currentMask || !selection) return;
    const nextMask = applySelectionToMask(currentMask, selection, action);
    await onCommitEdit({
      assetId: asset.id,
      editRect: asset.editRect,
      mask: nextMask,
      overlay: asset.overlayBlobId ? currentOverlay : null,
      anchorX: asset.anchorX,
      anchorY: asset.anchorY,
      label: `Selection ${action}`,
    });
  };

  const handleMorphMask = async (kind: 'grow' | 'shrink' | 'feather') => {
    if (!asset || !currentMask) return;
    const w = asset.editRect.width;
    const h = asset.editRect.height;
    const nextMask =
      kind === 'grow'
        ? growMask(currentMask, w, h, morphRadius)
        : kind === 'shrink'
          ? shrinkMask(currentMask, w, h, morphRadius)
          : featherMask(currentMask, w, h, morphRadius);
    await onCommitEdit({
      assetId: asset.id,
      editRect: asset.editRect,
      mask: nextMask,
      overlay: asset.overlayBlobId ? currentOverlay : null,
      anchorX: asset.anchorX,
      anchorY: asset.anchorY,
      label: `Mask ${kind}`,
    });
  };

  const handleExtendRect = async () => {
    if (!asset || !currentMask) return;
    const extended = extendCutoutBuffers(asset.editRect, currentMask, currentOverlay, {
      left: 16,
      top: 16,
      right: 16,
      bottom: 16,
    });
    await onCommitEdit({
      assetId: asset.id,
      editRect: extended.editRect,
      mask: extended.mask,
      overlay: extended.overlay,
      anchorX: asset.anchorX + extended.deltaAnchorX,
      anchorY: asset.anchorY + extended.deltaAnchorY,
      label: 'Extend edit region',
    });
  };

  const bgStyle =
    previewBg === 'checker'
      ? 'repeating-conic-gradient(#1f2430 0% 25%, #2b3242 0% 50%) 50% / 16px 16px'
      : previewBg === 'dark'
        ? '#0d1017'
        : '#e5e7eb';

  if (!asset) {
    return (
      <section className="stage-center" data-testid="cutting-empty">
        <div style={{ color: '#9aa6b8' }}>Import an image first to edit cutouts.</div>
      </section>
    );
  }

  return (
    <div className="studio-workspace" style={{ gridTemplateColumns: '300px 1fr' }}>
      <aside className="dock-panel" aria-label="Cutting Tools">
        <div className="panel-section">
          <div className="panel-heading">
            <span>Cutting Room</span>
          </div>
          <label className="field-label">
            Cutout Asset
            <select
              className="studio-select"
              data-testid="cut-asset-select"
              value={asset.id}
              onChange={(e) => {
                setSelection(null);
                setLassoPoints([]);
                onSelectAsset(e.target.value);
              }}
            >
              {cutouts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.width}×{c.height})
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Preview Background
            <select
              className="studio-select"
              data-testid="cut-preview-bg"
              value={previewBg}
              onChange={(e) => setPreviewBg(e.target.value as PreviewBg)}
            >
              <option value="checker">Checkerboard</option>
              <option value="dark">Solid Dark</option>
              <option value="light">Solid Light</option>
            </select>
          </label>
        </div>

        <div className="panel-section">
          <div className="panel-heading">
            <span>Tools</span>
          </div>
          <div className="row-wrap">
            {(
              [
                ['wand', 'Magic Wand'],
                ['color', 'Color Select'],
                ['lasso', 'Lasso'],
                ['restore', 'Restore Brush'],
                ['erase', 'Erase Brush'],
                ['clone', 'Clone Stamp'],
                ['paint', 'Color Brush'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`studio-btn${tool === id ? ' primary' : ''}`}
                data-testid={`cut-tool-${id}`}
                onClick={() => setTool(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="panel-section">
          <div className="panel-heading">
            <span>Selection</span>
          </div>
          <div className="grid-2">
            <label className="field-label">
              Mode
              <select
                className="studio-select"
                data-testid="cut-sel-mode"
                value={selMode}
                onChange={(e) => setSelMode(e.target.value as SelectionCombineMode)}
              >
                <option value="replace">Replace</option>
                <option value="add">Add</option>
                <option value="subtract">Subtract</option>
              </select>
            </label>
            <label className="field-label">
              Tolerance
              <input
                type="number"
                min="0"
                max="255"
                className="studio-input"
                data-testid="cut-tolerance"
                value={tolerance}
                onChange={(e) => setTolerance(Math.max(0, Math.min(255, Number(e.target.value))))}
              />
            </label>
          </div>
          {tool === 'lasso' && (
            <button
              type="button"
              className="studio-btn primary"
              data-testid="cut-close-lasso"
              disabled={lassoPoints.length < 3}
              onClick={handleCloseLasso}
            >
              Close Lasso ({lassoPoints.length} pts)
            </button>
          )}
          <div className="row-wrap">
            <button
              type="button"
              className="studio-btn danger"
              data-testid="cut-sel-erase"
              disabled={!selection}
              onClick={() => void handleApplySelection('erase')}
            >
              Erase Sel
            </button>
            <button
              type="button"
              className="studio-btn"
              data-testid="cut-sel-keep"
              disabled={!selection}
              onClick={() => void handleApplySelection('keep')}
            >
              Keep Sel
            </button>
            <button
              type="button"
              className="studio-btn"
              data-testid="cut-sel-restore"
              disabled={!selection}
              onClick={() => void handleApplySelection('restore')}
            >
              Restore Sel
            </button>
            <button
              type="button"
              className="studio-btn"
              data-testid="cut-sel-clear"
              disabled={!selection}
              onClick={() => setSelection(null)}
            >
              Clear
            </button>
          </div>
        </div>

        <div className="panel-section">
          <div className="panel-heading">
            <span>Brush &amp; Clone</span>
          </div>
          <div className="grid-2">
            <label className="field-label">
              Radius
              <input
                type="number"
                min="1"
                max="100"
                className="studio-input"
                data-testid="cut-brush-radius"
                value={brushRadius}
                onChange={(e) => setBrushRadius(Math.max(1, Number(e.target.value)))}
              />
            </label>
            <label className="field-label">
              Hardness
              <input
                type="number"
                min="0"
                max="1"
                step="0.1"
                className="studio-input"
                data-testid="cut-brush-hardness"
                value={brushHardness}
                onChange={(e) => setBrushHardness(Math.max(0, Math.min(1, Number(e.target.value))))}
              />
            </label>
            <label className="field-label">
              Opacity
              <input
                type="number"
                min="0.05"
                max="1"
                step="0.05"
                className="studio-input"
                data-testid="cut-brush-opacity"
                value={brushOpacity}
                onChange={(e) => setBrushOpacity(Math.max(0.05, Math.min(1, Number(e.target.value))))}
              />
            </label>
            <label className="field-label">
              Paint Color
              <input
                type="color"
                className="studio-input"
                data-testid="cut-brush-color"
                value={brushColor}
                onChange={(e) => setBrushColor(e.target.value)}
              />
            </label>
            <label className="field-label">
              Clone Offset X
              <input
                type="number"
                className="studio-input"
                data-testid="cut-clone-offset-x"
                value={cloneOffsetX}
                onChange={(e) => setCloneOffsetX(Number(e.target.value) || 0)}
              />
            </label>
            <label className="field-label">
              Clone Offset Y
              <input
                type="number"
                className="studio-input"
                data-testid="cut-clone-offset-y"
                value={cloneOffsetY}
                onChange={(e) => setCloneOffsetY(Number(e.target.value) || 0)}
              />
            </label>
          </div>
        </div>

        <div className="panel-section" style={{ borderBottom: 'none' }}>
          <div className="panel-heading">
            <span>Mask &amp; Region</span>
          </div>
          <label className="field-label">
            Edge Radius (px)
            <input
              type="number"
              min="1"
              max="24"
              className="studio-input"
              value={morphRadius}
              onChange={(e) => setMorphRadius(Math.max(1, Number(e.target.value)))}
            />
          </label>
          <div className="row-wrap">
            <button
              type="button"
              className="studio-btn"
              data-testid="cut-mask-grow"
              onClick={() => void handleMorphMask('grow')}
            >
              Grow
            </button>
            <button
              type="button"
              className="studio-btn"
              data-testid="cut-mask-shrink"
              onClick={() => void handleMorphMask('shrink')}
            >
              Shrink
            </button>
            <button
              type="button"
              className="studio-btn"
              data-testid="cut-mask-feather"
              onClick={() => void handleMorphMask('feather')}
            >
              Feather
            </button>
            <button
              type="button"
              className="studio-btn"
              data-testid="cut-extend-rect"
              onClick={() => void handleExtendRect()}
            >
              Extend +16px
            </button>
          </div>
        </div>
      </aside>

      <section className="stage-center" aria-label="Cutting Canvas">
        <canvas
          ref={canvasRef}
          data-testid="cutting-canvas"
          style={{
            border: '1px solid #38bdf8',
            background: bgStyle,
            maxWidth: '90%',
            maxHeight: '85%',
            imageRendering: 'pixelated',
            cursor: 'crosshair',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(e) => void handlePointerUp(e)}
        />
        <div className="stage-status" data-testid="cutting-status">
          {asset.name} · rect ({asset.editRect.x},{asset.editRect.y}) {asset.editRect.width}×
          {asset.editRect.height} · rev {asset.revision}
        </div>
      </section>
    </div>
  );
}
