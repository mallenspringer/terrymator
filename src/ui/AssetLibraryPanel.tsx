import { useMemo, useRef, type ChangeEvent } from 'react';
import type { BlobRecord } from '../application/blobStore';
import { cutoutDerivedBlobKey } from '../domain/evaluator';
import type { Asset, SourceRecord } from '../domain/schema';

interface AssetLibraryPanelProps {
  sources: SourceRecord[];
  assets: Asset[];
  blobs: Map<string, BlobRecord>;
  onImportFiles: (files: FileList) => void;
  onCreateCutoutFromSource: (sourceId: string) => void;
  onCreateMaterial: () => void;
  onEditAsset: (asset: Asset) => void;
  onUpdateSourceMeta: (sourceId: string, attribution: string, sourceUrl: string) => void;
  onAddAssetToStage: (assetId: string) => void;
  onAddTileToStage: (assetId: string) => void;
  onExportAssetPackage: (assetId: string) => void;
  onDeleteAsset: (assetId: string) => void;
}

function rgbaToThumbDataUrl(blob: BlobRecord | undefined): string | null {
  if (!blob) return null;
  const canvas = document.createElement('canvas');
  canvas.width = blob.width;
  canvas.height = blob.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const copy = new Uint8ClampedArray(blob.rgba.byteLength);
  copy.set(blob.rgba);
  ctx.putImageData(new ImageData(copy, blob.width, blob.height), 0, 0);
  return canvas.toDataURL('image/png');
}

export function AssetLibraryPanel({
  sources,
  assets,
  blobs,
  onImportFiles,
  onCreateCutoutFromSource,
  onCreateMaterial,
  onEditAsset,
  onUpdateSourceMeta,
  onAddAssetToStage,
  onAddTileToStage,
  onExportAssetPackage,
  onDeleteAsset,
}: AssetLibraryPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const thumbUrls = useMemo(() => {
    const map = new Map<string, string>();
    for (const asset of assets) {
      let blobId: string | undefined;
      if (asset.kind === 'synthetic-rgba') {
        blobId = asset.blobId;
      } else if (asset.kind === 'material') {
        blobId = asset.rasterBlobId;
      } else {
        const derivedKey = cutoutDerivedBlobKey(asset.id, asset.revision);
        blobId = blobs.has(derivedKey)
          ? derivedKey
          : sources.find((s) => s.id === asset.sourceId)?.blobId;
      }
      if (blobId && !map.has(asset.id)) {
        const url = rgbaToThumbDataUrl(blobs.get(blobId));
        if (url) map.set(asset.id, url);
      }
    }
    return map;
  }, [assets, blobs, sources]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onImportFiles(e.target.files);
      e.target.value = '';
    }
  };

  return (
    <aside className="dock-panel" aria-label="Asset Library">
      <div className="panel-section">
        <div className="panel-heading">
          <span>Assets ({assets.length})</span>
          <div className="row-wrap">
            <button
              type="button"
              className="studio-btn primary"
              data-testid="import-image-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              + Image
            </button>
            <button
              type="button"
              className="studio-btn"
              data-testid="new-material-btn"
              onClick={onCreateMaterial}
            >
              + Material
            </button>
          </div>
          <input
            ref={fileInputRef}
            data-testid="import-image-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>

        {assets.length === 0 ? (
          <div style={{ color: '#6b778c', fontSize: 12 }}>
            Import a PNG/JPEG/WebP image or create a Material shape.
          </div>
        ) : (
          assets.map((asset) => {
            const thumb = thumbUrls.get(asset.id);
            return (
              <div key={asset.id} className="card-item" data-testid={`asset-card-${asset.id}`}>
                <div className="row-between">
                  <div className="row-wrap" style={{ minWidth: 0 }}>
                    {thumb && <img src={thumb} alt={asset.name} className="thumb-preview" />}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{asset.name}</div>
                      <div style={{ fontSize: 11, color: '#8f9bb3' }}>
                        {asset.kind} · {asset.width}×{asset.height} · rev {asset.revision}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="row-wrap">
                  <button
                    type="button"
                    className="studio-btn"
                    data-testid="add-to-stage-btn"
                    onClick={() => onAddAssetToStage(asset.id)}
                  >
                    Add to Stage
                  </button>
                  <button
                    type="button"
                    className="studio-btn"
                    data-testid="add-tile-to-stage-btn"
                    onClick={() => onAddTileToStage(asset.id)}
                  >
                    + Tile
                  </button>
                  {asset.kind !== 'synthetic-rgba' && (
                    <button
                      type="button"
                      className="studio-btn"
                      data-testid="edit-asset-btn"
                      onClick={() => onEditAsset(asset)}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    className="studio-btn"
                    data-testid="export-asset-pkg-btn"
                    onClick={() => onExportAssetPackage(asset.id)}
                  >
                    Pkg
                  </button>
                  <button
                    type="button"
                    className="studio-btn danger"
                    data-testid="delete-asset-btn"
                    onClick={() => onDeleteAsset(asset.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="panel-section" style={{ borderBottom: 'none' }}>
        <div className="panel-heading">
          <span>Sources ({sources.length})</span>
        </div>
        {sources.map((src) => (
          <div key={src.id} className="card-item" data-testid={`source-card-${src.id}`}>
            <div className="row-between">
              <strong style={{ fontSize: 12 }}>{src.name}</strong>
              <button
                type="button"
                className="studio-btn"
                data-testid="new-cutout-from-source-btn"
                onClick={() => onCreateCutoutFromSource(src.id)}
              >
                + Cutout
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#8f9bb3' }}>
              {src.mimeType} · {src.width}×{src.height} · sha {src.sha256.slice(0, 8)}
            </div>
            <label className="field-label">
              Attribution
              <input
                type="text"
                className="studio-input"
                data-testid="source-attribution-input"
                value={src.attribution ?? ''}
                placeholder="Author / collection note"
                onChange={(e) => onUpdateSourceMeta(src.id, e.target.value, src.sourceUrl ?? '')}
              />
            </label>
            <label className="field-label">
              Source URL (local note only)
              <input
                type="text"
                className="studio-input"
                data-testid="source-url-input"
                value={src.sourceUrl ?? ''}
                placeholder="Optional source URL"
                onChange={(e) => onUpdateSourceMeta(src.id, src.attribution ?? '', e.target.value)}
              />
            </label>
          </div>
        ))}
      </div>
    </aside>
  );
}
