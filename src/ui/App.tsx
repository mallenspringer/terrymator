import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ProjectStore } from '../application/store';
import { decodeImageInBrowser } from '../assets/sourceImport';
import { createDefaultNode } from '../domain/commands';
import { isAppError } from '../domain/errors';
import { createId } from '../domain/ids';
import { createBlankProject, type Project, type TransformType } from '../domain/schema';
import { downloadBytes, readFileAsUint8Array } from '../persistence/fileIO';
import {
  IndexedDbRecoveryStorage,
  RecoveryManager,
  type RecoveryInfo,
} from '../persistence/recovery';
import { packArchive, unpackArchive } from '../persistence/zip';
import { PixiStageRenderer, type EditorViewport } from '../render/pixiAdapter';
import { AssetLibraryPanel } from './AssetLibraryPanel';
import { LayersInspectorPanel } from './LayersInspectorPanel';
import { StageViewport } from './StageViewport';
import './styles.css';

export function App() {
  const [store] = useState(() => {
    const s = new ProjectStore();
    s.load(createBlankProject(), new Map());
    return s;
  });
  const [renderer] = useState(() => new PixiStageRenderer());
  const [recovery] = useState(() => new RecoveryManager(new IndexedDbRecoveryStorage()));

  const openInputRef = useRef<HTMLInputElement | null>(null);

  const [project, setProject] = useState<Project>(() => store.snapshot());
  const [dirty, setDirty] = useState<boolean>(() => store.isDirty());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<EditorViewport>({ panX: 0, panY: 0, zoom: 1 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recoveryInfo, setRecoveryInfo] = useState<RecoveryInfo | null>(null);
  const [confirmState, setConfirmState] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

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
      .catch(() => {
        // IndexedDB unavailable; proceed without recovery banner
      });
    return () => {
      active = false;
    };
  }, [recovery]);

  // Debounced crash-recovery snapshot after committed dirty edits
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
  }, [store]);

  // Keyboard shortcuts: Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z, Ctrl+S
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSaveArchive, store]);

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
        await store.importSource({
          name: file.name,
          bytes,
          mimeType: decoded.mimeType,
          width: decoded.width,
          height: decoded.height,
          rgba: decoded.rgba,
          createInitialAsset: true,
        });
      } catch (err) {
        setErrorMsg(isAppError(err) ? `${err.code}: ${err.message}` : String(err));
      }
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
  const evaluatedScene = useMemo(
    () => store.evaluate(0, { outputWidth: 680, outputHeight: 400 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, store],
  );
  const selectedNode = selectedNodeId ? (project.nodes[selectedNodeId] ?? null) : null;

  return (
    <div className="studio-shell">
      <header className="studio-toolbar">
        <span className="studio-title">Terrymator · {project.name}</span>
        <span
          className={dirty ? 'dirty-badge' : 'clean-badge'}
          data-testid="dirty-indicator"
        >
          {dirty ? 'Unsaved' : 'Saved'}
        </span>

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

        <div className="toolbar-sep" />
        <button
          type="button"
          className="studio-btn"
          onClick={() =>
            setViewport((v) => ({ ...v, zoom: Math.max(0.25, Number((v.zoom / 1.25).toFixed(2))) }))
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
            setViewport((v) => ({ ...v, zoom: Math.min(4, Number((v.zoom * 1.25).toFixed(2))) }))
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
              store.dispatch({
                type: 'CREATE_CUTOUT_ASSET',
                assetId: createId('asset'),
                sourceId,
                name: `${src.name} Cutout`,
              });
            })
          }
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
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          onDragMoveNode={(nodeId, x, y, coalesceKey) =>
            runCommand(() => {
              store.dispatch(
                { type: 'SET_NODE_TRANSFORM', nodeId, transform: { x, y } },
                { label: 'Move layer', coalesceKey },
              );
            })
          }
          onViewportChange={setViewport}
        />

        <LayersInspectorPanel
          nodes={Object.values(project.nodes)}
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
            runCommand(() => {
              store.dispatch({ type: 'SET_NODE_VISIBILITY', nodeId, visible });
            })
          }
          onToggleLocked={(nodeId, locked) =>
            runCommand(() => {
              store.dispatch({ type: 'SET_NODE_LOCKED', nodeId, locked });
            })
          }
          onChangeDrawOrder={(nodeId, drawOrder) =>
            runCommand(() => {
              store.dispatch({ type: 'SET_NODE_DRAW_ORDER', nodeId, drawOrder });
            })
          }
          onChangeTransform={(nodeId, patch: Partial<TransformType>) =>
            runCommand(() => {
              store.dispatch({ type: 'SET_NODE_TRANSFORM', nodeId, transform: patch });
            })
          }
          onChangeOpacity={(nodeId, opacity) =>
            runCommand(() => {
              store.dispatch({ type: 'SET_NODE_OPACITY', nodeId, opacity });
            })
          }
          onChangeParent={(nodeId, parentId) =>
            runCommand(() => {
              store.dispatch({ type: 'SET_NODE_PARENT', nodeId, parentId });
            })
          }
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
