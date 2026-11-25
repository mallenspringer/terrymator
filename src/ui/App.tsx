import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ProjectStore } from '../application/store';
import { decodeImageInBrowser } from '../assets/sourceImport';
import { collectSubtreeNodeIds, createDefaultNode, type Command } from '../domain/commands';
import { isAppError } from '../domain/errors';
import { evaluateScene } from '../domain/evaluator';
import { createId } from '../domain/ids';
import {
  createBlankProject,
  createDefaultMaterialRecipe,
  type CutoutAsset,
  type MaterialAsset,
  type MaterialRecipe,
  type NodeEffects,
  type Project,
  type TileParams,
  type TrackProperty,
  type TransformType,
} from '../domain/schema';
import { TICKS_PER_SECOND, frameIndexToTick } from '../domain/time';
import { packAssetPackage, unpackAssetPackage } from '../persistence/assetPackage';
import { downloadBytes, readFileAsUint8Array } from '../persistence/fileIO';
import {
  IndexedDbRecoveryStorage,
  RecoveryManager,
  type RecoveryInfo,
} from '../persistence/recovery';
import { packArchive, unpackArchive } from '../persistence/zip';
import { PixiStageRenderer, type EditorViewport } from '../render/pixiAdapter';
import { AssetLibraryPanel } from './AssetLibraryPanel';
import { CuttingRoomWorkspace } from './CuttingRoomWorkspace';
import {
  applyDraftsToPreviewProject,
  draftsToUpsertCommands,
  findTrack,
  hasExistingTrack,
  upsertPendingDraft,
  type PendingDraft,
} from './draftState';
import { ExportModal } from './ExportModal';
import { LayersInspectorPanel } from './LayersInspectorPanel';
import { MaterialWorkshopWorkspace } from './MaterialWorkshopWorkspace';
import { StageViewport } from './StageViewport';
import { TimelinePanel } from './TimelinePanel';
import './styles.css';

type WorkspaceMode = 'studio' | 'cutting' | 'material';

export function App() {
  const [store] = useState(() => {
    const s = new ProjectStore();
    s.load(createBlankProject(), new Map());
    return s;
  });
  const [renderer] = useState(() => new PixiStageRenderer());
  const [recovery] = useState(() => new RecoveryManager(new IndexedDbRecoveryStorage()));

  const openInputRef = useRef<HTMLInputElement | null>(null);
  const pkgInputRef = useRef<HTMLInputElement | null>(null);

  const [workspace, setWorkspace] = useState<WorkspaceMode>('studio');
  const [project, setProject] = useState<Project>(() => store.snapshot());
  const [dirty, setDirty] = useState<boolean>(() => store.isDirty());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeCutoutId, setActiveCutoutId] = useState<string | null>(null);
  const [activeMaterialId, setActiveMaterialId] = useState<string | null>(null);
  const [showWireframe, setShowWireframe] = useState<boolean>(false);
  const [viewport, setViewport] = useState<EditorViewport>({ panX: 0, panY: 0, zoom: 1 });
  const [currentTick, setCurrentTick] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [loopPlayback, setLoopPlayback] = useState<boolean>(true);
  const [autoKey, setAutoKey] = useState<boolean>(false);
  const [pendingDrafts, setPendingDrafts] = useState<PendingDraft[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recoveryInfo, setRecoveryInfo] = useState<RecoveryInfo | null>(null);
  const [confirmState, setConfirmState] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);

  useEffect(() => {
    const unsub = store.subscribe(() => {
      setProject(store.snapshot());
      setDirty(store.isDirty());
    });
    return unsub;
  }, [store]);

  useEffect(() => {
    let active = true;
    void recovery
      .inspect()
      .then((info) => {
        if (active && info) {
          setRecoveryInfo(info);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [recovery]);

  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      void recovery.saveSnapshot(store.snapshot(), store.getBlobs()).catch((err) => {
        setErrorMsg(
          `Autosave warning: ${isAppError(err) ? err.message : 'Unable to write recovery snapshot.'}`,
        );
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [dirty, project.revision, recovery, store]);

  useEffect(() => {
    return () => {
      renderer.dispose();
    };
  }, [renderer]);

  const handleSaveArchive = useCallback(async () => {
    if (pendingDrafts.length > 0) {
      setErrorMsg('ERR_PENDING_DRAFT: Key or discard pending timeline drafts before saving.');
      return;
    }
    try {
      setErrorMsg(null);
      const snap = store.snapshot();
      const bytes = await packArchive(snap, store.getBlobs());
      const safeName = snap.name.toLowerCase().replace(/[^a-z0-9-_]+/g, '-') || 'shot';
      downloadBytes(bytes, `${safeName}.collage`, 'application/zip');
      store.markSaved();
    } catch (err) {
      setErrorMsg(isAppError(err) ? `${err.code}: ${err.message}` : String(err));
    }
  }, [pendingDrafts.length, store]);

  // Wall-clock playback loop (never integrates transforms)
  useEffect(() => {
    if (!isPlaying) return;
    const workRange = project.shot.workRange ?? {
      inTick: 0,
      outTick: project.shot.durationTicks,
    };
    const span = Math.max(1, workRange.outTick - workRange.inTick);
    const startOffset =
      currentTick >= workRange.inTick && currentTick < workRange.outTick
        ? currentTick - workRange.inTick
        : 0;
    const startWallMs = performance.now() - (startOffset / TICKS_PER_SECOND) * 1000;

    let rafId = 0;
    const step = (now: number) => {
      const elapsedTicks = Math.round(((now - startWallMs) / 1000) * TICKS_PER_SECOND);
      if (loopPlayback) {
        const wrapped = workRange.inTick + (elapsedTicks % span);
        setCurrentTick(wrapped);
        rafId = requestAnimationFrame(step);
      } else if (workRange.inTick + elapsedTicks >= workRange.outTick) {
        setCurrentTick(workRange.outTick - 1);
        setIsPlaying(false);
      } else {
        setCurrentTick(workRange.inTick + elapsedTicks);
        rafId = requestAnimationFrame(step);
      }
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, loopPlayback, project.shot.durationTicks, project.shot.workRange]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmState) {
          setConfirmState(null);
          return;
        }
        if (showExportModal) {
          setShowExportModal(false);
          return;
        }
      }
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          store.redo();
        } else {
          store.undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSaveArchive();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (pendingDrafts.length === 0) {
          setIsPlaying(false);
          setShowExportModal(true);
        } else {
          setErrorMsg('ERR_PENDING_DRAFT: Key or discard pending drafts before exporting.');
        }
      } else if (workspace === 'studio' && !showExportModal && !confirmState) {
        if (e.code === 'Space') {
          e.preventDefault();
          if (pendingDrafts.length === 0) {
            setIsPlaying((p) => !p);
          } else {
            setErrorMsg('ERR_PENDING_DRAFT: Key or discard pending drafts before changing timeline time.');
          }
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          if (pendingDrafts.length > 0) {
            setErrorMsg('ERR_PENDING_DRAFT: Key or discard pending drafts before changing timeline time.');
            return;
          }
          setIsPlaying(false);
          const fps = project.shot.fps;
          const tpf = (TICKS_PER_SECOND * fps.den) / fps.num;
          const curFrame = Math.round(currentTick / tpf);
          const nextFrame = Math.max(0, curFrame + (e.key === 'ArrowRight' ? 1 : -1));
          setCurrentTick(
            Math.min(project.shot.durationTicks - 1, frameIndexToTick(0, nextFrame, fps)),
          );
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
          e.preventDefault();
          try {
            store.dispatch({ type: 'DELETE_NODE', nodeId: selectedNodeId });
            setSelectedNodeId(null);
          } catch (err) {
            setErrorMsg(isAppError(err) ? `${err.code}: ${err.message}` : String(err));
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    confirmState,
    currentTick,
    handleSaveArchive,
    pendingDrafts.length,
    project.shot.durationTicks,
    project.shot.fps,
    selectedNodeId,
    showExportModal,
    store,
    workspace,
  ]);

  const runCommand = (fn: () => void) => {
    try {
      setErrorMsg(null);
      fn();
    } catch (err) {
      setErrorMsg(isAppError(err) ? `${err.code}: ${err.message}` : String(err));
    }
  };

  const handleImportFiles = async (files: FileList) => {
    setErrorMsg(null);
    for (const file of Array.from(files)) {
      try {
        const bytes = await readFileAsUint8Array(file);
        const decoded = await decodeImageInBrowser(bytes);
        const res = await store.importSource({
          name: file.name,
          bytes,
          mimeType: decoded.mimeType,
          width: decoded.width,
          height: decoded.height,
          rgba: decoded.rgba,
          createInitialAsset: true,
        });
        if (res.assetId) {
          setActiveCutoutId(res.assetId);
        }
      } catch (err) {
        setErrorMsg(isAppError(err) ? `${err.code}: ${err.message}` : String(err));
      }
    }
  };

  const handleCreateMaterial = async () => {
    try {
      setErrorMsg(null);
      const count = Object.values(project.assets).filter((a) => a.kind === 'material').length + 1;
      const { assetId } = await store.createMaterialAsset({
        name: `Paper Shape ${count}`,
        recipe: createDefaultMaterialRecipe(),
      });
      setActiveMaterialId(assetId);
      setWorkspace('material');
    } catch (err) {
      setErrorMsg(isAppError(err) ? `${err.code}: ${err.message}` : String(err));
    }
  };

  const handleUpdateMaterial = async (assetId: string, recipe: MaterialRecipe) => {
    try {
      setErrorMsg(null);
      await store.updateMaterialAsset({
        assetId,
        recipe,
        coalesceKey: `mat-${assetId}`,
      });
    } catch (err) {
      setErrorMsg(isAppError(err) ? `${err.code}: ${err.message}` : String(err));
    }
  };

  const handleOpenArchiveFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const performLoad = async () => {
      try {
        setErrorMsg(null);
        const bytes = await readFileAsUint8Array(file);
        const unpacked = await unpackArchive(bytes, decodeImageInBrowser);
        renderer.clearTextures();
        store.replaceProjectTransactional(unpacked.project, unpacked.blobs);
        setSelectedNodeId(null);
        setViewport({ panX: 0, panY: 0, zoom: 1 });
      } catch (err) {
        setErrorMsg(isAppError(err) ? `${err.code}: ${err.message}` : String(err));
      }
    };

    if (store.isDirty()) {
      setConfirmState({
        message: 'You have unsaved changes. Open archive and discard current changes?',
        onConfirm: () => {
          setConfirmState(null);
          void performLoad();
        },
      });
    } else {
      await performLoad();
    }
  };

  const handleNewShot = () => {
    const reset = () => {
      renderer.clearTextures();
      store.dispatch({ type: 'NEW_SHOT' });
      setSelectedNodeId(null);
      setActiveCutoutId(null);
      setActiveMaterialId(null);
      setViewport({ panX: 0, panY: 0, zoom: 1 });
      setErrorMsg(null);
    };
    if (store.isDirty()) {
      setConfirmState({
        message: 'Discard unsaved changes and start a new blank shot?',
        onConfirm: () => {
          setConfirmState(null);
          reset();
        },
      });
    } else {
      reset();
    }
  };

  const handleImportPackageFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setErrorMsg(null);
      const bytes = await readFileAsUint8Array(file);
      const unpacked = await unpackAssetPackage(bytes, decodeImageInBrowser);
      const res = await store.importAssetPackage(unpacked);
      if (res.importedNodeIds[0]) {
        setSelectedNodeId(res.importedNodeIds[0]);
      }
    } catch (err) {
      setErrorMsg(isAppError(err) ? `${err.code}: ${err.message}` : String(err));
    }
  };

  const handleExportPackage = async (
    target: { kind: 'asset'; assetId: string } | { kind: 'rig'; rootNodeId: string },
    fallbackName: string,
  ) => {
    try {
      setErrorMsg(null);
      const bytes = await packAssetPackage(store.snapshot(), store.getBlobs(), target);
      const safeName = fallbackName.toLowerCase().replace(/[^a-z0-9-_]+/g, '-') || 'package';
      downloadBytes(bytes, `${safeName}.collageasset`, 'application/zip');
    } catch (err) {
      setErrorMsg(isAppError(err) ? `${err.code}: ${err.message}` : String(err));
    }
  };

  const handleRecover = async () => {
    try {
      setErrorMsg(null);
      const restored = await recovery.recover(decodeImageInBrowser);
      renderer.clearTextures();
      store.replaceProjectTransactional(restored.project, restored.blobs);
      setRecoveryInfo(null);
      setSelectedNodeId(null);
    } catch (err) {
      setErrorMsg(isAppError(err) ? `${err.code}: ${err.message}` : String(err));
    }
  };

  const handleDiscardRecovery = async () => {
    await recovery.discard().catch(() => {});
    setRecoveryInfo(null);
  };

  const blobs = store.getBlobs();
  const previewProject = useMemo(
    () => applyDraftsToPreviewProject(project, pendingDrafts),
    [pendingDrafts, project],
  );
  const evaluatedScene = useMemo(
    () => evaluateScene(previewProject, currentTick, { outputWidth: 680, outputHeight: 400 }),
    [currentTick, previewProject],
  );

  const guardNoPendingDrafts = (): boolean => {
    if (pendingDrafts.length > 0) {
      setErrorMsg('ERR_PENDING_DRAFT: Key or discard pending drafts before changing timeline time.');
      return false;
    }
    return true;
  };

  const routePropertyEdit = (
    targetKind: 'node' | 'camera',
    targetId: string,
    property: TrackProperty,
    value: number | boolean,
    fallbackCommand: Command,
    coalesceKey?: string,
  ) => {
    runCommand(() => {
      if (autoKey) {
        const existing = findTrack(project, targetKind, targetId, property);
        store.dispatch(
          {
            type: 'UPSERT_KEY',
            trackId: existing?.id ?? `trk-${targetId}-${property}`,
            targetKind,
            targetId,
            property,
            tick: currentTick,
            value,
            interpolation: 'linear',
          },
          { label: `Key ${property}`, ...(coalesceKey ? { coalesceKey } : {}) },
        );
      } else if (hasExistingTrack(project, targetKind, targetId, property)) {
        setPendingDrafts((prev) =>
          upsertPendingDraft(prev, {
            targetKind,
            targetId,
            property,
            tick: currentTick,
            value,
          }),
        );
      } else {
        store.dispatch(fallbackCommand, coalesceKey ? { coalesceKey } : {});
      }
    });
  };
  const selectedNode = selectedNodeId ? (project.nodes[selectedNodeId] ?? null) : null;
  const cutouts = useMemo(
    () => Object.values(project.assets).filter((a): a is CutoutAsset => a.kind === 'cutout'),
    [project.assets],
  );
  const materials = useMemo(
    () => Object.values(project.assets).filter((a): a is MaterialAsset => a.kind === 'material'),
    [project.assets],
  );

  return (
    <div className="studio-shell">
      <header className="studio-toolbar">
        <span className="studio-title">Terrymator · {project.name}</span>
        <span className={dirty ? 'dirty-badge' : 'clean-badge'} data-testid="dirty-indicator">
          {dirty ? 'Unsaved' : 'Saved'}
        </span>

        <div className="toolbar-sep" />
        <button
          type="button"
          className={`studio-btn${workspace === 'studio' ? ' primary' : ''}`}
          data-testid="tab-studio"
          onClick={() => setWorkspace('studio')}
        >
          Studio
        </button>
        <button
          type="button"
          className={`studio-btn${workspace === 'cutting' ? ' primary' : ''}`}
          data-testid="tab-cutting"
          onClick={() => setWorkspace('cutting')}
        >
          Cutting Room
        </button>
        <button
          type="button"
          className={`studio-btn${workspace === 'material' ? ' primary' : ''}`}
          data-testid="tab-material"
          onClick={() => setWorkspace('material')}
        >
          Material Workshop
        </button>

        <div className="toolbar-sep" />
        <button type="button" className="studio-btn" data-testid="new-shot-btn" onClick={handleNewShot}>
          New Shot
        </button>
        <button
          type="button"
          className="studio-btn"
          data-testid="open-archive-btn"
          onClick={() => openInputRef.current?.click()}
        >
          Open .collage
        </button>
        <input
          ref={openInputRef}
          data-testid="open-archive-input"
          type="file"
          accept=".collage,.zip,application/zip"
          style={{ display: 'none' }}
          onChange={(e) => void handleOpenArchiveFile(e)}
        />
        <button
          type="button"
          className="studio-btn primary"
          data-testid="save-archive-btn"
          onClick={() => void handleSaveArchive()}
        >
          Save .collage
        </button>
        <button
          type="button"
          className="studio-btn"
          data-testid="import-package-btn"
          onClick={() => pkgInputRef.current?.click()}
        >
          Import .collageasset
        </button>
        <input
          ref={pkgInputRef}
          data-testid="import-package-input"
          type="file"
          accept=".collageasset,.zip,application/zip"
          style={{ display: 'none' }}
          onChange={(e) => void handleImportPackageFile(e)}
        />

        <div className="toolbar-sep" />
        <button
          type="button"
          className="studio-btn"
          data-testid="undo-btn"
          disabled={!store.canUndo()}
          onClick={() => store.undo()}
        >
          Undo
        </button>
        <button
          type="button"
          className="studio-btn"
          data-testid="redo-btn"
          disabled={!store.canRedo()}
          onClick={() => store.redo()}
        >
          Redo
        </button>

        {workspace === 'studio' && (
          <>
            <div className="toolbar-sep" />
            <button
              type="button"
              className="studio-btn"
              onClick={() =>
                setViewport((v) => ({
                  ...v,
                  zoom: Math.max(0.25, Number((v.zoom / 1.25).toFixed(2))),
                }))
              }
            >
              Viewport -
            </button>
            <span data-testid="viewport-zoom-label" style={{ fontSize: 12, color: '#9aa6b8' }}>
              {Math.round(viewport.zoom * 100)}%
            </span>
            <button
              type="button"
              className="studio-btn"
              onClick={() =>
                setViewport((v) => ({
                  ...v,
                  zoom: Math.min(4, Number((v.zoom * 1.25).toFixed(2))),
                }))
              }
            >
              Viewport +
            </button>
            <button
              type="button"
              className="studio-btn"
              onClick={() => setViewport({ panX: 0, panY: 0, zoom: 1 })}
            >
              Reset View
            </button>
            <button
              type="button"
              className={`studio-btn${showWireframe ? ' primary' : ''}`}
              data-testid="toggle-wireframe-btn"
              onClick={() => setShowWireframe((w) => !w)}
            >
              {showWireframe ? 'Wireframe: On' : 'Wireframe: Off'}
            </button>
          </>
        )}
        <div className="toolbar-sep" />
        <button
          type="button"
          className="studio-btn primary"
          data-testid="open-export-btn"
          onClick={() => {
            if (!guardNoPendingDrafts()) return;
            setIsPlaying(false);
            setShowExportModal(true);
          }}
        >
          Export...
        </button>
      </header>

      {recoveryInfo && (
        <div className="banner recovery" data-testid="recovery-banner">
          <span>
            Unsaved recovery snapshot found for <strong>{recoveryInfo.projectName}</strong> (rev{' '}
            {recoveryInfo.projectRevision}).
          </span>
          <div className="row-wrap">
            <button
              type="button"
              className="studio-btn primary"
              data-testid="recover-btn"
              onClick={() => void handleRecover()}
            >
              Recover
            </button>
            <button
              type="button"
              className="studio-btn"
              data-testid="discard-recovery-btn"
              onClick={() => void handleDiscardRecovery()}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="banner error" data-testid="error-banner" role="alert">
          <span>{errorMsg}</span>
          <button type="button" className="studio-btn" onClick={() => setErrorMsg(null)}>
            Dismiss
          </button>
        </div>
      )}

      {workspace === 'studio' && (
        <>
          <div className="studio-workspace">
          <AssetLibraryPanel
            sources={Object.values(project.sources)}
            assets={Object.values(project.assets)}
            blobs={blobs}
            onImportFiles={(files) => void handleImportFiles(files)}
            onCreateCutoutFromSource={(sourceId) =>
              runCommand(() => {
                const src = project.sources[sourceId];
                if (!src) return;
                const assetId = createId('asset');
                store.dispatch({
                  type: 'CREATE_CUTOUT_ASSET',
                  assetId,
                  sourceId,
                  name: `${src.name} Cutout`,
                });
                setActiveCutoutId(assetId);
              })
            }
            onCreateMaterial={() => void handleCreateMaterial()}
            onEditAsset={(asset) => {
              if (asset.kind === 'cutout') {
                setActiveCutoutId(asset.id);
                setWorkspace('cutting');
              } else if (asset.kind === 'material') {
                setActiveMaterialId(asset.id);
                setWorkspace('material');
              }
            }}
            onUpdateSourceMeta={(sourceId, attribution, sourceUrl) =>
              runCommand(() => {
                store.dispatch(
                  { type: 'UPDATE_SOURCE_META', sourceId, attribution, sourceUrl },
                  { label: 'Update source metadata', coalesceKey: `meta-${sourceId}` },
                );
              })
            }
            onAddAssetToStage={(assetId) =>
              runCommand(() => {
                const asset = project.assets[assetId];
                if (!asset) return;
                const maxOrder = Object.values(project.nodes).reduce(
                  (max, n) => Math.max(max, n.drawOrder),
                  0,
                );
                const nodeId = createId('node');
                store.dispatch({
                  type: 'ADD_NODE',
                  node: createDefaultNode({
                    id: nodeId,
                    name: asset.name,
                    kind: 'sprite',
                    assetId,
                    x: project.shot.width / 2,
                    y: project.shot.height / 2,
                    drawOrder: maxOrder + 1,
                  }),
                });
                setSelectedNodeId(nodeId);
              })
            }
            onAddTileToStage={(assetId) =>
              runCommand(() => {
                const asset = project.assets[assetId];
                if (!asset) return;
                const minOrder = Object.values(project.nodes).reduce(
                  (min, n) => Math.min(min, n.drawOrder),
                  1,
                );
                const nodeId = createId('tile');
                store.dispatch({
                  type: 'ADD_NODE',
                  node: createDefaultNode({
                    id: nodeId,
                    name: `${asset.name} Tile`,
                    kind: 'tile',
                    assetId,
                    x: project.shot.width / 2,
                    y: project.shot.height / 2,
                    drawOrder: minOrder - 1,
                    tile: {
                      width: project.shot.width,
                      height: project.shot.height,
                      scaleX: 1,
                      scaleY: 1,
                      offsetX: 0,
                      offsetY: 0,
                      scrollRateX: 0,
                      scrollRateY: 0,
                      repeatX: true,
                      repeatY: true,
                      mirrorX: false,
                      mirrorY: false,
                    },
                  }),
                });
                setSelectedNodeId(nodeId);
              })
            }
            onExportAssetPackage={(assetId) => {
              const asset = project.assets[assetId];
              if (asset) {
                void handleExportPackage({ kind: 'asset', assetId }, asset.name);
              }
            }}
            onDeleteAsset={(assetId) =>
              runCommand(() => {
                store.dispatch({ type: 'DELETE_ASSET', assetId });
              })
            }
          />

          <StageViewport
            project={project}
            scene={evaluatedScene}
            blobs={blobs}
            renderer={renderer}
            viewport={viewport}
            showWireframe={showWireframe}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onDragMoveNode={(nodeId, x, y, coalesceKey) =>
              runCommand(() => {
                if (autoKey) {
                  const tx = findTrack(project, 'node', nodeId, 'transform.x');
                  const ty = findTrack(project, 'node', nodeId, 'transform.y');
                  store.dispatch(
                    {
                      type: 'UPSERT_KEY',
                      trackId: tx?.id ?? `trk-${nodeId}-transform.x`,
                      targetKind: 'node',
                      targetId: nodeId,
                      property: 'transform.x',
                      tick: currentTick,
                      value: x,
                      interpolation: 'linear',
                    },
                    { coalesceKey: `${coalesceKey}-x` },
                  );
                  store.dispatch(
                    {
                      type: 'UPSERT_KEY',
                      trackId: ty?.id ?? `trk-${nodeId}-transform.y`,
                      targetKind: 'node',
                      targetId: nodeId,
                      property: 'transform.y',
                      tick: currentTick,
                      value: y,
                      interpolation: 'linear',
                    },
                    { coalesceKey: `${coalesceKey}-y` },
                  );
                } else if (
                  hasExistingTrack(project, 'node', nodeId, 'transform.x') ||
                  hasExistingTrack(project, 'node', nodeId, 'transform.y')
                ) {
                  setPendingDrafts((prev) => {
                    let next = prev;
                    if (hasExistingTrack(project, 'node', nodeId, 'transform.x')) {
                      next = upsertPendingDraft(next, {
                        targetKind: 'node',
                        targetId: nodeId,
                        property: 'transform.x',
                        tick: currentTick,
                        value: x,
                      });
                    }
                    if (hasExistingTrack(project, 'node', nodeId, 'transform.y')) {
                      next = upsertPendingDraft(next, {
                        targetKind: 'node',
                        targetId: nodeId,
                        property: 'transform.y',
                        tick: currentTick,
                        value: y,
                      });
                    }
                    return next;
                  });
                } else {
                  store.dispatch(
                    { type: 'SET_NODE_TRANSFORM', nodeId, transform: { x, y } },
                    { label: 'Move layer', coalesceKey },
                  );
                }
              })
            }
            onViewportChange={setViewport}
          />

          <LayersInspectorPanel
            nodes={Object.values(project.nodes)}
            shot={project.shot}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNodeId}
            onAddGroup={() =>
              runCommand(() => {
                const groupId = createId('group');
                store.dispatch({
                  type: 'ADD_NODE',
                  node: createDefaultNode({
                    id: groupId,
                    name: 'Group',
                    kind: 'group',
                  }),
                });
                setSelectedNodeId(groupId);
              })
            }
            onDuplicateNode={(nodeId) =>
              runCommand(() => {
                const newId = createId('node');
                store.dispatch({
                  type: 'DUPLICATE_NODE',
                  sourceNodeId: nodeId,
                  newNodeId: newId,
                });
                setSelectedNodeId(newId);
              })
            }
            onDuplicateSubtree={(rootNodeId) =>
              runCommand(() => {
                const oldIds = collectSubtreeNodeIds(project, rootNodeId);
                const idMap: Record<string, string> = {};
                for (const id of oldIds) {
                  const n = project.nodes[id]!;
                  idMap[id] = createId(n.kind === 'group' ? 'group' : 'node');
                }
                store.dispatch({ type: 'DUPLICATE_SUBTREE', rootNodeId, idMap });
                setSelectedNodeId(idMap[rootNodeId] ?? null);
              })
            }
            onExportRigPackage={(rootNodeId) => {
              const node = project.nodes[rootNodeId];
              if (node) {
                void handleExportPackage({ kind: 'rig', rootNodeId }, node.name);
              }
            }}
            onMakeUnique={(nodeId) =>
              runCommand(() => {
                store.dispatch({
                  type: 'MAKE_ASSET_UNIQUE',
                  nodeId,
                  newAssetId: createId('asset'),
                });
              })
            }
            onDeleteNode={(nodeId) =>
              runCommand(() => {
                store.dispatch({ type: 'DELETE_NODE', nodeId });
                if (selectedNodeId === nodeId) setSelectedNodeId(null);
              })
            }
            onToggleVisible={(nodeId, visible) =>
              routePropertyEdit('node', nodeId, 'visible', visible, {
                type: 'SET_NODE_VISIBILITY',
                nodeId,
                visible,
              })
            }
            onToggleLocked={(nodeId, locked) =>
              runCommand(() => {
                store.dispatch({ type: 'SET_NODE_LOCKED', nodeId, locked });
              })
            }
            onChangeDrawOrder={(nodeId, drawOrder) =>
              routePropertyEdit('node', nodeId, 'drawOrder', drawOrder, {
                type: 'SET_NODE_DRAW_ORDER',
                nodeId,
                drawOrder,
              })
            }
            onChangeTransform={(nodeId, patch: Partial<TransformType>) => {
              const entries = Object.entries(patch) as Array<[keyof TransformType, number]>;
              if (entries.length === 1) {
                const [field, val] = entries[0]!;
                routePropertyEdit(
                  'node',
                  nodeId,
                  `transform.${field}` as TrackProperty,
                  val,
                  { type: 'SET_NODE_TRANSFORM', nodeId, transform: patch },
                );
              } else {
                runCommand(() => {
                  store.dispatch({ type: 'SET_NODE_TRANSFORM', nodeId, transform: patch });
                });
              }
            }}
            onChangePivot={(nodeId, pivotX, pivotY, preserveWorld) =>
              runCommand(() => {
                if (preserveWorld) {
                  store.dispatch({
                    type: 'SET_NODE_PIVOT_PRESERVE_WORLD',
                    nodeId,
                    pivotX,
                    pivotY,
                  });
                } else {
                  store.dispatch({
                    type: 'SET_NODE_TRANSFORM',
                    nodeId,
                    transform: { pivotX, pivotY },
                  });
                }
              })
            }
            onChangeOpacity={(nodeId, opacity) =>
              routePropertyEdit('node', nodeId, 'opacity', opacity, {
                type: 'SET_NODE_OPACITY',
                nodeId,
                opacity,
              })
            }
            onChangeParent={(nodeId, parentId, preserveWorld) =>
              runCommand(() => {
                if (preserveWorld) {
                  store.dispatch({
                    type: 'REPARENT_NODE_PRESERVE_WORLD',
                    nodeId,
                    parentId,
                  });
                } else {
                  store.dispatch({ type: 'SET_NODE_PARENT', nodeId, parentId });
                }
              })
            }
            onChangeSampling={(nodeId, samplingOverride) =>
              runCommand(() => {
                store.dispatch({ type: 'SET_NODE_SAMPLING', nodeId, samplingOverride });
              })
            }
            onChangeTileParams={(nodeId, patch: Partial<TileParams>) =>
              runCommand(() => {
                store.dispatch({ type: 'SET_NODE_TILE_PARAMS', nodeId, tile: patch });
              })
            }
            onChangeEffects={(nodeId, effects: NodeEffects) =>
              runCommand(() => {
                store.dispatch(
                  { type: 'SET_NODE_EFFECTS', nodeId, effects },
                  { label: 'Update effects', coalesceKey: `fx-${nodeId}` },
                );
              })
            }
            onBatchGroupEffects={(rootNodeId, effects: NodeEffects) =>
              runCommand(() => {
                store.dispatch({ type: 'BATCH_SET_GROUP_EFFECTS', rootNodeId, effects });
              })
            }
            onChangeGlobalShadowAngle={(angle) =>
              runCommand(() => {
                store.dispatch(
                  { type: 'SET_GLOBAL_SHADOW_ANGLE', angle },
                  { label: 'Global shadow angle', coalesceKey: 'global-shadow-angle' },
                );
              })
            }
            onChangeCamera={(patch) => {
              const entries = Object.entries(patch) as Array<['x' | 'y' | 'zoom', number]>;
              if (entries.length === 1) {
                const [field, val] = entries[0]!;
                routePropertyEdit(
                  'camera',
                  'camera',
                  `camera.${field}` as TrackProperty,
                  val,
                  { type: 'SET_CAMERA', ...patch },
                );
              } else {
                runCommand(() => {
                  store.dispatch({ type: 'SET_CAMERA', ...patch });
                });
              }
            }}
            onRenameNode={(nodeId, name) =>
              runCommand(() => {
                store.dispatch(
                  { type: 'RENAME_NODE', nodeId, name },
                  { label: 'Rename layer', coalesceKey: `rename-${nodeId}` },
                );
              })
            }
          />
          </div>
          <TimelinePanel
            project={previewProject}
            currentTick={currentTick}
            isPlaying={isPlaying}
            loopPlayback={loopPlayback}
            autoKey={autoKey}
            selectedNodeId={selectedNodeId}
            pendingDrafts={pendingDrafts}
            onTogglePlay={() => {
              if (!isPlaying && !guardNoPendingDrafts()) return;
              setIsPlaying((p) => !p);
            }}
            onSetTick={(tick) => {
              if (!guardNoPendingDrafts()) return;
              setIsPlaying(false);
              setCurrentTick(Math.max(0, Math.min(project.shot.durationTicks - 1, tick)));
            }}
            onStepFrames={(delta) => {
              if (!guardNoPendingDrafts()) return;
              setIsPlaying(false);
              const fps = project.shot.fps;
              const tpf = (TICKS_PER_SECOND * fps.den) / fps.num;
              const curFrame = Math.round(currentTick / tpf);
              const nextFrame = Math.max(0, curFrame + delta);
              const nextTick = Math.min(
                project.shot.durationTicks - 1,
                frameIndexToTick(0, nextFrame, fps),
              );
              setCurrentTick(nextTick);
            }}
            onToggleLoopPlayback={setLoopPlayback}
            onToggleAutoKey={setAutoKey}
            onSetWorkRange={(inTick, outTick) =>
              runCommand(() => {
                store.dispatch({
                  type: 'SET_SHOT_TIMING',
                  workRange: { inTick, outTick },
                });
              })
            }
            onKeySelectedNode={() => {
              if (!selectedNodeId) return;
              runCommand(() => {
                store.dispatch({
                  type: 'CAPTURE_POSE_KEYS',
                  rootNodeId: selectedNodeId,
                  tick: currentTick,
                  interpolation: 'linear',
                });
              });
            }}
            onCapturePose={() => {
              if (!selectedNodeId) return;
              runCommand(() => {
                store.dispatch({
                  type: 'CAPTURE_POSE_KEYS',
                  rootNodeId: selectedNodeId,
                  tick: currentTick,
                  interpolation: 'linear',
                });
              });
            }}
            onCommitDrafts={() =>
              runCommand(() => {
                for (const cmd of draftsToUpsertCommands(project, pendingDrafts, 'linear')) {
                  store.dispatch(cmd);
                }
                setPendingDrafts([]);
              })
            }
            onDiscardDrafts={() => {
              setPendingDrafts([]);
              setErrorMsg(null);
            }}
            onMoveKey={(trackId, fromTick, toTick) =>
              runCommand(() => {
                store.dispatch({ type: 'MOVE_KEY', trackId, fromTick, toTick });
              })
            }
            onDuplicateKey={(trackId, fromTick, toTick) =>
              runCommand(() => {
                store.dispatch({ type: 'DUPLICATE_KEY', trackId, fromTick, toTick });
              })
            }
            onDeleteKey={(trackId, tick) =>
              runCommand(() => {
                store.dispatch({ type: 'DELETE_KEY', trackId, tick });
              })
            }
            onSetKeyInterpolation={(trackId, tick, interpolation) =>
              runCommand(() => {
                store.dispatch({
                  type: 'SET_KEY_INTERPOLATION',
                  trackId,
                  tick,
                  interpolation,
                });
              })
            }
            onUpsertLoopScope={(loop) =>
              runCommand(() => {
                store.dispatch({ type: 'UPSERT_LOOP_SCOPE', loop });
              })
            }
            onDeleteLoopScope={(loopId) =>
              runCommand(() => {
                store.dispatch({ type: 'DELETE_LOOP_SCOPE', loopId });
              })
            }
          />
        </>
      )}

      {workspace === 'cutting' && (
        <CuttingRoomWorkspace
          cutouts={cutouts}
          sources={project.sources}
          blobs={blobs}
          activeAssetId={activeCutoutId}
          onSelectAsset={setActiveCutoutId}
          onCommitEdit={async (params) => {
            try {
              setErrorMsg(null);
              await store.commitCutoutEdit(params);
            } catch (err) {
              setErrorMsg(isAppError(err) ? `${err.code}: ${err.message}` : String(err));
            }
          }}
        />
      )}

      {workspace === 'material' && (
        <MaterialWorkshopWorkspace
          materials={materials}
          sources={Object.values(project.sources)}
          blobs={blobs}
          activeAssetId={activeMaterialId}
          onSelectAsset={setActiveMaterialId}
          onCreateMaterial={handleCreateMaterial}
          onUpdateMaterial={handleUpdateMaterial}
        />
      )}

      {showExportModal && (
        <ExportModal
          open={showExportModal}
          project={project}
          blobs={blobs}
          currentTick={currentTick}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {confirmState && (
        <div className="modal-backdrop" data-testid="confirm-dialog">
          <div className="modal-card">
            <div>{confirmState.message}</div>
            <div className="row-between">
              <button
                type="button"
                className="studio-btn"
                data-testid="confirm-cancel-btn"
                onClick={() => setConfirmState(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="studio-btn danger"
                data-testid="confirm-ok-btn"
                onClick={confirmState.onConfirm}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
