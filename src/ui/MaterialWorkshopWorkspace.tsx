import { useEffect, useMemo, useRef } from 'react';
import type { BlobRecord } from '../application/blobStore';
import { createId } from '../domain/ids';
import type {
  MaterialAsset,
  MaterialPatternKind,
  MaterialPreset,
  MaterialRecipe,
  MaterialShapeOp,
  SourceRecord,
} from '../domain/schema';

interface MaterialWorkshopWorkspaceProps {
  materials: MaterialAsset[];
  sources: SourceRecord[];
  blobs: Map<string, BlobRecord>;
  activeAssetId: string | null;
  onSelectAsset: (assetId: string) => void;
  onCreateMaterial: () => Promise<void>;
  onUpdateMaterial: (assetId: string, recipe: MaterialRecipe) => Promise<void>;
}

export function MaterialWorkshopWorkspace({
  materials,
  sources,
  blobs,
  activeAssetId,
  onSelectAsset,
  onCreateMaterial,
  onUpdateMaterial,
}: MaterialWorkshopWorkspaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const asset = useMemo(
    () => materials.find((m) => m.id === activeAssetId) ?? materials[0] ?? null,
    [activeAssetId, materials],
  );

  const rasterBlob = asset ? blobs.get(asset.rasterBlobId) : undefined;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rasterBlob) return;
    canvas.width = rasterBlob.width;
    canvas.height = rasterBlob.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const copy = new Uint8ClampedArray(rasterBlob.rgba.byteLength);
    copy.set(rasterBlob.rgba);
    ctx.putImageData(new ImageData(copy, rasterBlob.width, rasterBlob.height), 0, 0);
  }, [rasterBlob]);

  if (!asset) {
    return (
      <section className="stage-center" data-testid="material-empty">
        <div className="row-wrap" style={{ flexDirection: 'column' }}>
          <div style={{ color: '#9aa6b8' }}>No material assets yet.</div>
          <button
            type="button"
            className="studio-btn primary"
            data-testid="mat-create-empty-btn"
            onClick={() => void onCreateMaterial()}
          >
            + New Material
          </button>
        </div>
      </section>
    );
  }

  const recipe = asset.recipe;

  const patchRecipe = (patch: Partial<MaterialRecipe>) => {
    void onUpdateMaterial(asset.id, { ...recipe, ...patch });
  };

  return (
    <div className="studio-workspace" style={{ gridTemplateColumns: '320px 1fr' }}>
      <aside className="dock-panel" aria-label="Material Workshop Controls">
        <div className="panel-section">
          <div className="panel-heading">
            <span>Material Workshop</span>
            <button
              type="button"
              className="studio-btn primary"
              data-testid="mat-new-btn"
              onClick={() => void onCreateMaterial()}
            >
              + New
            </button>
          </div>
          <label className="field-label">
            Active Material
            <select
              className="studio-select"
              data-testid="mat-asset-select"
              value={asset.id}
              onChange={(e) => onSelectAsset(e.target.value)}
            >
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (rev {m.revision})
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="panel-section">
          <div className="panel-heading">
            <span>Material &amp; Texture</span>
          </div>
          <div className="grid-2">
            <label className="field-label">
              Preset
              <select
                className="studio-select"
                data-testid="mat-preset"
                value={recipe.preset}
                onChange={(e) => patchRecipe({ preset: e.target.value as MaterialPreset })}
              >
                <option value="construction-paper">Construction Paper</option>
                <option value="kraft-cardboard">Kraft / Cardboard</option>
                <option value="felt">Felt</option>
                <option value="aged-paper">Aged Paper</option>
                <option value="fabric">Fabric</option>
                <option value="halftone">Halftone</option>
              </select>
            </label>
            <label className="field-label">
              Base Color
              <input
                type="color"
                className="studio-input"
                data-testid="mat-base-color"
                value={recipe.baseColor}
                onChange={(e) => patchRecipe({ baseColor: e.target.value })}
              />
            </label>
            <label className="field-label">
              Seed
              <input
                type="number"
                className="studio-input"
                data-testid="mat-seed"
                value={recipe.seed}
                onChange={(e) => patchRecipe({ seed: Math.round(Number(e.target.value) || 0) })}
              />
            </label>
            <label className="field-label">
              Grain
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                className="studio-input"
                data-testid="mat-grain"
                value={recipe.grainIntensity}
                onChange={(e) =>
                  patchRecipe({ grainIntensity: Math.max(0, Math.min(1, Number(e.target.value))) })
                }
              />
            </label>
            <label className="field-label">
              Tex Scale
              <input
                type="number"
                min="0.2"
                max="8"
                step="0.1"
                className="studio-input"
                data-testid="mat-scale"
                value={recipe.textureScale}
                onChange={(e) =>
                  patchRecipe({ textureScale: Math.max(0.2, Number(e.target.value) || 1) })
                }
              />
            </label>
            <label className="field-label">
              Tex Rotation
              <input
                type="number"
                step="5"
                className="studio-input"
                value={recipe.textureRotation}
                onChange={(e) => patchRecipe({ textureRotation: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="field-label">
              Edge Irregularity
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                className="studio-input"
                data-testid="mat-edge-irreg"
                value={recipe.edgeIrregularity}
                onChange={(e) =>
                  patchRecipe({
                    edgeIrregularity: Math.max(0, Math.min(1, Number(e.target.value))),
                  })
                }
              />
            </label>
            <label className="field-label">
              Edge Darkening
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                className="studio-input"
                data-testid="mat-edge-dark"
                value={recipe.edgeDarkening}
                onChange={(e) =>
                  patchRecipe({ edgeDarkening: Math.max(0, Math.min(1, Number(e.target.value))) })
                }
              />
            </label>
          </div>
        </div>

        <div className="panel-section">
          <div className="panel-heading">
            <span>Pattern &amp; Photo Fill</span>
          </div>
          <div className="grid-2">
            <label className="field-label">
              Pattern
              <select
                className="studio-select"
                data-testid="mat-pattern-kind"
                value={recipe.pattern.kind}
                onChange={(e) =>
                  patchRecipe({
                    pattern: { ...recipe.pattern, kind: e.target.value as MaterialPatternKind },
                  })
                }
              >
                <option value="none">None</option>
                <option value="stripes">Stripes</option>
                <option value="dots">Dots</option>
                <option value="grid">Grid</option>
                <option value="checkerboard">Checkerboard</option>
                <option value="crosshatch">Crosshatch</option>
              </select>
            </label>
            <label className="field-label">
              Pattern Color
              <input
                type="color"
                className="studio-input"
                value={recipe.pattern.color}
                onChange={(e) =>
                  patchRecipe({ pattern: { ...recipe.pattern, color: e.target.value } })
                }
              />
            </label>
          </div>
          <label className="field-label">
            Imported Image Fill (MAT-06)
            <select
              className="studio-select"
              data-testid="mat-photo-source"
              value={recipe.imageSourceId ?? ''}
              onChange={(e) =>
                patchRecipe({ imageSourceId: e.target.value === '' ? null : e.target.value })
              }
            >
              <option value="">(Solid / Procedural Base)</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.width}×{s.height})
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="panel-section" style={{ borderBottom: 'none' }}>
          <div className="panel-heading">
            <span>Shapes ({recipe.shapes.length})</span>
            <div className="row-wrap">
              <button
                type="button"
                className="studio-btn"
                data-testid="mat-add-rect"
                onClick={() =>
                  patchRecipe({
                    shapes: [
                      ...recipe.shapes,
                      {
                        id: createId('shp'),
                        kind: 'rect',
                        op: 'union',
                        x: 24,
                        y: 24,
                        width: 80,
                        height: 80,
                      },
                    ],
                  })
                }
              >
                + Rect
              </button>
              <button
                type="button"
                className="studio-btn"
                data-testid="mat-add-ellipse"
                onClick={() =>
                  patchRecipe({
                    shapes: [
                      ...recipe.shapes,
                      {
                        id: createId('shp'),
                        kind: 'ellipse',
                        op: 'subtract',
                        x: Math.round(recipe.width * 0.25),
                        y: Math.round(recipe.height * 0.25),
                        width: Math.round(recipe.width * 0.5),
                        height: Math.round(recipe.height * 0.5),
                      },
                    ],
                  })
                }
              >
                + Hole
              </button>
            </div>
          </div>

          {recipe.shapes.map((shp, idx) => (
            <div key={shp.id} className="card-item">
              <div className="row-between">
                <strong>
                  #{idx + 1} {shp.kind}
                </strong>
                <select
                  className="studio-select"
                  style={{ width: 100 }}
                  value={shp.op}
                  onChange={(e) => {
                    const next = recipe.shapes.map((s) =>
                      s.id === shp.id ? { ...s, op: e.target.value as MaterialShapeOp } : s,
                    );
                    patchRecipe({ shapes: next });
                  }}
                >
                  <option value="union">Union</option>
                  <option value="subtract">Subtract</option>
                  <option value="intersect">Intersect</option>
                </select>
                {recipe.shapes.length > 1 && (
                  <button
                    type="button"
                    className="studio-btn danger"
                    onClick={() =>
                      patchRecipe({ shapes: recipe.shapes.filter((s) => s.id !== shp.id) })
                    }
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <section className="stage-center" aria-label="Material Preview">
        <canvas
          ref={canvasRef}
          data-testid="material-canvas"
          style={{
            border: '1px solid #38bdf8',
            background:
              'repeating-conic-gradient(#1f2430 0% 25%, #2b3242 0% 50%) 50% / 16px 16px',
            maxWidth: '90%',
            maxHeight: '85%',
          }}
        />
        <div className="stage-status" data-testid="material-status">
          {asset.name} · {asset.width}×{asset.height} · seed {recipe.seed} · rev {asset.revision}
        </div>
      </section>
    </div>
  );
}
