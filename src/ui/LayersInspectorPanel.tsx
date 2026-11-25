import { useState } from 'react';
import type {
  NodeEffects,
  SamplingOverride,
  SceneNode,
  Shot,
  TileParams,
  TransformType,
} from '../domain/schema';

interface LayersInspectorPanelProps {
  nodes: SceneNode[];
  shot: Shot;
  selectedNode: SceneNode | null;
  onSelectNode: (nodeId: string | null) => void;
  onAddGroup: () => void;
  onDuplicateNode: (nodeId: string) => void;
  onDuplicateSubtree: (nodeId: string) => void;
  onExportRigPackage: (nodeId: string) => void;
  onMakeUnique: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onToggleVisible: (nodeId: string, visible: boolean) => void;
  onToggleLocked: (nodeId: string, locked: boolean) => void;
  onChangeDrawOrder: (nodeId: string, drawOrder: number) => void;
  onChangeTransform: (nodeId: string, patch: Partial<TransformType>) => void;
  onChangePivot: (nodeId: string, pivotX: number, pivotY: number, preserveWorld: boolean) => void;
  onChangeOpacity: (nodeId: string, opacity: number) => void;
  onChangeParent: (nodeId: string, parentId: string | null, preserveWorld: boolean) => void;
  onChangeSampling: (nodeId: string, samplingOverride: SamplingOverride) => void;
  onChangeTileParams: (nodeId: string, patch: Partial<TileParams>) => void;
  onChangeEffects: (nodeId: string, effects: NodeEffects) => void;
  onBatchGroupEffects: (rootNodeId: string, effects: NodeEffects) => void;
  onChangeGlobalShadowAngle: (angle: number) => void;
  onChangeCamera: (patch: { x?: number; y?: number; zoom?: number }) => void;
  onRenameNode: (nodeId: string, name: string) => void;
}

function getDepth(node: SceneNode, nodeMap: Map<string, SceneNode>): number {
  let depth = 0;
  let cursor = node.parentId;
  const seen = new Set<string>([node.id]);
  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    depth += 1;
    cursor = nodeMap.get(cursor)?.parentId ?? null;
  }
  return depth;
}

export function LayersInspectorPanel({
  nodes,
  shot,
  selectedNode,
  onSelectNode,
  onAddGroup,
  onDuplicateNode,
  onDuplicateSubtree,
  onExportRigPackage,
  onMakeUnique,
  onDeleteNode,
  onToggleVisible,
  onToggleLocked,
  onChangeDrawOrder,
  onChangeTransform,
  onChangePivot,
  onChangeOpacity,
  onChangeParent,
  onChangeSampling,
  onChangeTileParams,
  onChangeEffects,
  onBatchGroupEffects,
  onChangeGlobalShadowAngle,
  onChangeCamera,
  onRenameNode,
}: LayersInspectorPanelProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [preserveWorld, setPreserveWorld] = useState<boolean>(true);

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const sortedLayers = [...nodes].sort((a, b) => {
    if (a.drawOrder !== b.drawOrder) return b.drawOrder - a.drawOrder;
    return a.id.localeCompare(b.id);
  });

  const isHiddenByCollapsedAncestor = (node: SceneNode): boolean => {
    let cursor = node.parentId;
    const seen = new Set<string>();
    while (cursor) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      if (collapsedGroups[cursor]) return true;
      cursor = nodeMap.get(cursor)?.parentId ?? null;
    }
    return false;
  };

  return (
    <aside className="dock-panel right" aria-label="Layers and Inspector">
      <div className="panel-section">
        <div className="panel-heading">
          <span>Layers ({nodes.length})</span>
          <button
            type="button"
            className="studio-btn"
            data-testid="add-group-btn"
            onClick={onAddGroup}
          >
            + Group
          </button>
        </div>

        {sortedLayers.length === 0 ? (
          <div style={{ color: '#6b778c', fontSize: 12 }}>No layers on stage yet.</div>
        ) : (
          sortedLayers.map((node) => {
            if (isHiddenByCollapsedAncestor(node)) return null;
            const isSelected = selectedNode?.id === node.id;
            const isGroup = node.kind === 'group';
            const isCollapsed = Boolean(collapsedGroups[node.id]);
            const depth = getDepth(node, nodeMap);

            return (
              <div
                key={node.id}
                className={`card-item${isSelected ? ' selected' : ''}`}
                data-testid={`layer-row-${node.id}`}
                style={{ marginLeft: `${Math.min(depth, 5) * 10}px` }}
                onClick={() => onSelectNode(node.id)}
              >
                <div className="row-between">
                  <div className="row-wrap" style={{ minWidth: 0 }}>
                    {isGroup && (
                      <button
                        type="button"
                        className="studio-btn"
                        aria-label={`Toggle ${node.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCollapsedGroups((prev) => ({
                            ...prev,
                            [node.id]: !isCollapsed,
                          }));
                        }}
                      >
                        {isCollapsed ? '▸' : '▾'}
                      </button>
                    )}
                    <span style={{ fontWeight: 600 }}>
                      {isGroup ? '[G] ' : node.kind === 'tile' ? '[T] ' : ''}
                      {node.name}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: '#8f9bb3' }}>z:{node.drawOrder}</span>
                </div>

                <div className="row-wrap">
                  <button
                    type="button"
                    className="studio-btn"
                    data-testid={`toggle-vis-${node.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleVisible(node.id, !node.visible);
                    }}
                  >
                    {node.visible ? 'Hide' : 'Show'}
                  </button>
                  <button
                    type="button"
                    className="studio-btn"
                    data-testid={`toggle-lock-${node.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleLocked(node.id, !node.locked);
                    }}
                  >
                    {node.locked ? 'Unlock' : 'Lock'}
                  </button>
                  <button
                    type="button"
                    className="studio-btn"
                    data-testid={`order-up-${node.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChangeDrawOrder(node.id, node.drawOrder + 1);
                    }}
                  >
                    Z+
                  </button>
                  <button
                    type="button"
                    className="studio-btn"
                    data-testid={`order-down-${node.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChangeDrawOrder(node.id, node.drawOrder - 1);
                    }}
                  >
                    Z-
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {selectedNode && (
        <div className="panel-section" data-testid="inspector-panel">
          <div className="panel-heading">
            <span>Inspector</span>
            <div className="row-wrap">
              <button
                type="button"
                className="studio-btn"
                data-testid="duplicate-node-btn"
                onClick={() => onDuplicateNode(selectedNode.id)}
              >
                Dup
              </button>
              <button
                type="button"
                className="studio-btn"
                data-testid="duplicate-subtree-btn"
                onClick={() => onDuplicateSubtree(selectedNode.id)}
              >
                Dup Subtree
              </button>
              <button
                type="button"
                className="studio-btn"
                data-testid="export-rig-btn"
                onClick={() => onExportRigPackage(selectedNode.id)}
              >
                Export Rig
              </button>
              {selectedNode.assetId && (
                <button
                  type="button"
                  className="studio-btn"
                  data-testid="make-unique-btn"
                  onClick={() => onMakeUnique(selectedNode.id)}
                >
                  Make Unique
                </button>
              )}
              <button
                type="button"
                className="studio-btn danger"
                data-testid="delete-node-btn"
                onClick={() => onDeleteNode(selectedNode.id)}
              >
                Delete
              </button>
            </div>
          </div>

          <label className="field-label">
            Name
            <input
              type="text"
              className="studio-input"
              data-testid="inspector-name-input"
              value={selectedNode.name}
              onChange={(e) => onRenameNode(selectedNode.id, e.target.value)}
            />
          </label>

          <div className="row-between">
            <label className="field-label" style={{ flex: 1 }}>
              Parent
              <select
                className="studio-select"
                data-testid="inspector-parent-select"
                value={selectedNode.parentId ?? ''}
                onChange={(e) =>
                  onChangeParent(
                    selectedNode.id,
                    e.target.value === '' ? null : e.target.value,
                    preserveWorld,
                  )
                }
              >
                <option value="">(Stage Root)</option>
                {nodes
                  .filter((n) => n.id !== selectedNode.id)
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
              </select>
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                color: '#9aa6b8',
                paddingTop: 14,
              }}
            >
              <input
                type="checkbox"
                data-testid="preserve-world-toggle"
                checked={preserveWorld}
                onChange={(e) => setPreserveWorld(e.target.checked)}
              />
              Preserve World
            </label>
          </div>

          <div className="grid-2">
            <label className="field-label">
              X
              <input
                type="number"
                step="1"
                className="studio-input"
                data-testid="inspector-x-input"
                value={selectedNode.transform.x}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) onChangeTransform(selectedNode.id, { x: val });
                }}
              />
            </label>
            <label className="field-label">
              Y
              <input
                type="number"
                step="1"
                className="studio-input"
                data-testid="inspector-y-input"
                value={selectedNode.transform.y}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) onChangeTransform(selectedNode.id, { y: val });
                }}
              />
            </label>
            <label className="field-label">
              Angle (deg)
              <input
                type="number"
                step="1"
                className="studio-input"
                data-testid="inspector-angle-input"
                value={selectedNode.transform.angle}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) onChangeTransform(selectedNode.id, { angle: val });
                }}
              />
            </label>
            <label className="field-label">
              Draw Order
              <input
                type="number"
                step="1"
                className="studio-input"
                data-testid="inspector-draworder-input"
                value={selectedNode.drawOrder}
                onChange={(e) => {
                  const val = Math.round(Number(e.target.value));
                  if (Number.isFinite(val)) onChangeDrawOrder(selectedNode.id, val);
                }}
              />
            </label>
            <label className="field-label">
              Scale X
              <input
                type="number"
                step="0.1"
                className="studio-input"
                data-testid="inspector-sx-input"
                value={selectedNode.transform.sx}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val) && Math.abs(val) >= 0.01) {
                    onChangeTransform(selectedNode.id, { sx: val });
                  }
                }}
              />
            </label>
            <label className="field-label">
              Scale Y
              <input
                type="number"
                step="0.1"
                className="studio-input"
                data-testid="inspector-sy-input"
                value={selectedNode.transform.sy}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val) && Math.abs(val) >= 0.01) {
                    onChangeTransform(selectedNode.id, { sy: val });
                  }
                }}
              />
            </label>
            <label className="field-label">
              Pivot X
              <input
                type="number"
                step="1"
                className="studio-input"
                data-testid="inspector-pivotx-input"
                value={selectedNode.transform.pivotX}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) {
                    onChangePivot(selectedNode.id, val, selectedNode.transform.pivotY, preserveWorld);
                  }
                }}
              />
            </label>
            <label className="field-label">
              Pivot Y
              <input
                type="number"
                step="1"
                className="studio-input"
                data-testid="inspector-pivoty-input"
                value={selectedNode.transform.pivotY}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) {
                    onChangePivot(selectedNode.id, selectedNode.transform.pivotX, val, preserveWorld);
                  }
                }}
              />
            </label>
            <label className="field-label">
              Opacity
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                className="studio-input"
                value={selectedNode.opacity}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val) && val >= 0 && val <= 1) {
                    onChangeOpacity(selectedNode.id, val);
                  }
                }}
              />
            </label>
            <label className="field-label">
              Motion Rate
              <select
                className="studio-select"
                data-testid="node-sampling-mode"
                value={selectedNode.samplingOverride?.mode ?? 'inherit'}
                onChange={(e) => {
                  const mode = e.target.value;
                  if (mode === 'inherit') {
                    onChangeSampling(selectedNode.id, { mode: 'inherit' });
                  } else if (mode === 'full-rate') {
                    onChangeSampling(selectedNode.id, { mode: 'full-rate' });
                  } else {
                    onChangeSampling(selectedNode.id, {
                      mode: 'fixed',
                      fps: { num: 12, den: 1 },
                    });
                  }
                }}
              >
                <option value="inherit">Inherit</option>
                <option value="full-rate">Full Rate</option>
                <option value="fixed">Fixed FPS</option>
              </select>
            </label>
          </div>
          {selectedNode.samplingOverride?.mode === 'fixed' && (
            <label className="field-label" style={{ marginTop: 4 }}>
              Fixed Sampling FPS
              <input
                type="number"
                min="1"
                max="60"
                className="studio-input"
                data-testid="node-sampling-fps"
                value={selectedNode.samplingOverride.fps.num}
                onChange={(e) => {
                  const num = Math.max(1, Math.min(60, Math.round(Number(e.target.value) || 12)));
                  onChangeSampling(selectedNode.id, {
                    mode: 'fixed',
                    fps: { num, den: 1 },
                  });
                }}
              />
            </label>
          )}

          {selectedNode.kind === 'tile' && selectedNode.tile && (
            <div style={{ marginTop: 8 }}>
              <div className="panel-heading" style={{ marginBottom: 6 }}>
                <span>Tile Layer</span>
              </div>
              <div className="grid-2">
                <label className="field-label">
                  Tile Width
                  <input
                    type="number"
                    min="1"
                    className="studio-input"
                    data-testid="tile-width-input"
                    value={selectedNode.tile.width}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val > 0) onChangeTileParams(selectedNode.id, { width: val });
                    }}
                  />
                </label>
                <label className="field-label">
                  Tile Height
                  <input
                    type="number"
                    min="1"
                    className="studio-input"
                    data-testid="tile-height-input"
                    value={selectedNode.tile.height}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val > 0) onChangeTileParams(selectedNode.id, { height: val });
                    }}
                  />
                </label>
                <label className="field-label">
                  Offset X
                  <input
                    type="number"
                    className="studio-input"
                    data-testid="tile-offset-x-input"
                    value={selectedNode.tile.offsetX}
                    onChange={(e) =>
                      onChangeTileParams(selectedNode.id, { offsetX: Number(e.target.value) || 0 })
                    }
                  />
                </label>
                <label className="field-label">
                  Offset Y
                  <input
                    type="number"
                    className="studio-input"
                    data-testid="tile-offset-y-input"
                    value={selectedNode.tile.offsetY}
                    onChange={(e) =>
                      onChangeTileParams(selectedNode.id, { offsetY: Number(e.target.value) || 0 })
                    }
                  />
                </label>
              </div>
              <div className="row-wrap" style={{ marginTop: 6 }}>
                <label style={{ fontSize: 11 }}>
                  <input
                    type="checkbox"
                    data-testid="tile-repeat-x"
                    checked={selectedNode.tile.repeatX}
                    onChange={(e) =>
                      onChangeTileParams(selectedNode.id, { repeatX: e.target.checked })
                    }
                  />{' '}
                  Repeat X
                </label>
                <label style={{ fontSize: 11 }}>
                  <input
                    type="checkbox"
                    data-testid="tile-repeat-y"
                    checked={selectedNode.tile.repeatY}
                    onChange={(e) =>
                      onChangeTileParams(selectedNode.id, { repeatY: e.target.checked })
                    }
                  />{' '}
                  Repeat Y
                </label>
                <label style={{ fontSize: 11 }}>
                  <input
                    type="checkbox"
                    data-testid="tile-mirror-x"
                    checked={selectedNode.tile.mirrorX}
                    onChange={(e) =>
                      onChangeTileParams(selectedNode.id, { mirrorX: e.target.checked })
                    }
                  />{' '}
                  Mirror X
                </label>
                <label style={{ fontSize: 11 }}>
                  <input
                    type="checkbox"
                    data-testid="tile-mirror-y"
                    checked={selectedNode.tile.mirrorY}
                    onChange={(e) =>
                      onChangeTileParams(selectedNode.id, { mirrorY: e.target.checked })
                    }
                  />{' '}
                  Mirror Y
                </label>
              </div>
            </div>
          )}

          <div
            data-testid="inspector-effects-panel"
            style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #242b38', display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            <div className="row-between">
              <span style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1' }}>Visual Effects</span>
              {selectedNode.kind === 'group' && (
                <button
                  type="button"
                  className="studio-btn"
                  data-testid="fx-batch-group-btn"
                  onClick={() => onBatchGroupEffects(selectedNode.id, selectedNode.effects)}
                >
                  Apply FX to Descendants
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <input
                  type="checkbox"
                  data-testid="fx-shadow-enabled"
                  checked={selectedNode.effects.dropShadow.enabled}
                  onChange={(e) =>
                    onChangeEffects(selectedNode.id, {
                      ...selectedNode.effects,
                      dropShadow: { ...selectedNode.effects.dropShadow, enabled: e.target.checked },
                    })
                  }
                />
                Drop Shadow
              </label>
              {selectedNode.effects.dropShadow.enabled && (
                <div className="grid-2">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, gridColumn: 'span 2' }}>
                    <input
                      type="checkbox"
                      data-testid="fx-shadow-use-global"
                      checked={selectedNode.effects.dropShadow.useGlobalAngle}
                      onChange={(e) =>
                        onChangeEffects(selectedNode.id, {
                          ...selectedNode.effects,
                          dropShadow: {
                            ...selectedNode.effects.dropShadow,
                            useGlobalAngle: e.target.checked,
                          },
                        })
                      }
                    />
                    Use Global Angle ({shot.globalShadowAngle}°)
                  </label>
                  <label className="field-label">
                    Angle
                    <input
                      type="number"
                      className="studio-input"
                      data-testid="fx-shadow-angle"
                      disabled={selectedNode.effects.dropShadow.useGlobalAngle}
                      value={selectedNode.effects.dropShadow.angle}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val)) {
                          onChangeEffects(selectedNode.id, {
                            ...selectedNode.effects,
                            dropShadow: { ...selectedNode.effects.dropShadow, angle: val },
                          });
                        }
                      }}
                    />
                  </label>
                  <label className="field-label">
                    Distance
                    <input
                      type="number"
                      min="0"
                      max="100"
                      className="studio-input"
                      data-testid="fx-shadow-distance"
                      value={selectedNode.effects.dropShadow.distance}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val)) {
                          onChangeEffects(selectedNode.id, {
                            ...selectedNode.effects,
                            dropShadow: {
                              ...selectedNode.effects.dropShadow,
                              distance: Math.max(0, Math.min(100, val)),
                            },
                          });
                        }
                      }}
                    />
                  </label>
                  <label className="field-label">
                    Softness
                    <input
                      type="number"
                      min="0"
                      max="50"
                      className="studio-input"
                      data-testid="fx-shadow-softness"
                      value={selectedNode.effects.dropShadow.softness}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val)) {
                          onChangeEffects(selectedNode.id, {
                            ...selectedNode.effects,
                            dropShadow: {
                              ...selectedNode.effects.dropShadow,
                              softness: Math.max(0, Math.min(50, val)),
                            },
                          });
                        }
                      }}
                    />
                  </label>
                  <label className="field-label">
                    Opacity
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      className="studio-input"
                      data-testid="fx-shadow-opacity"
                      value={selectedNode.effects.dropShadow.opacity}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val)) {
                          onChangeEffects(selectedNode.id, {
                            ...selectedNode.effects,
                            dropShadow: {
                              ...selectedNode.effects.dropShadow,
                              opacity: Math.max(0, Math.min(1, val)),
                            },
                          });
                        }
                      }}
                    />
                  </label>
                  <label className="field-label">
                    Shadow Color
                    <input
                      type="color"
                      className="studio-input"
                      data-testid="fx-shadow-color"
                      value={selectedNode.effects.dropShadow.color}
                      onChange={(e) =>
                        onChangeEffects(selectedNode.id, {
                          ...selectedNode.effects,
                          dropShadow: { ...selectedNode.effects.dropShadow, color: e.target.value },
                        })
                      }
                    />
                  </label>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <input
                  type="checkbox"
                  data-testid="fx-glow-enabled"
                  checked={selectedNode.effects.outerGlow.enabled}
                  onChange={(e) =>
                    onChangeEffects(selectedNode.id, {
                      ...selectedNode.effects,
                      outerGlow: { ...selectedNode.effects.outerGlow, enabled: e.target.checked },
                    })
                  }
                />
                Outer Glow
              </label>
              {selectedNode.effects.outerGlow.enabled && (
                <div className="grid-2">
                  <label className="field-label">
                    Glow Color
                    <input
                      type="color"
                      className="studio-input"
                      data-testid="fx-glow-color"
                      value={selectedNode.effects.outerGlow.color}
                      onChange={(e) =>
                        onChangeEffects(selectedNode.id, {
                          ...selectedNode.effects,
                          outerGlow: { ...selectedNode.effects.outerGlow, color: e.target.value },
                        })
                      }
                    />
                  </label>
                  <label className="field-label">
                    Radius
                    <input
                      type="number"
                      min="0"
                      max="100"
                      className="studio-input"
                      data-testid="fx-glow-radius"
                      value={selectedNode.effects.outerGlow.radius}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val)) {
                          onChangeEffects(selectedNode.id, {
                            ...selectedNode.effects,
                            outerGlow: {
                              ...selectedNode.effects.outerGlow,
                              radius: Math.max(0, Math.min(100, val)),
                            },
                          });
                        }
                      }}
                    />
                  </label>
                  <label className="field-label">
                    Intensity
                    <input
                      type="number"
                      min="0"
                      max="5"
                      step="0.1"
                      className="studio-input"
                      data-testid="fx-glow-intensity"
                      value={selectedNode.effects.outerGlow.intensity}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val)) {
                          onChangeEffects(selectedNode.id, {
                            ...selectedNode.effects,
                            outerGlow: {
                              ...selectedNode.effects.outerGlow,
                              intensity: Math.max(0, Math.min(5, val)),
                            },
                          });
                        }
                      }}
                    />
                  </label>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <input
                  type="checkbox"
                  data-testid="fx-color-enabled"
                  checked={selectedNode.effects.colorAdjust.enabled}
                  onChange={(e) =>
                    onChangeEffects(selectedNode.id, {
                      ...selectedNode.effects,
                      colorAdjust: {
                        ...selectedNode.effects.colorAdjust,
                        enabled: e.target.checked,
                      },
                    })
                  }
                />
                Color Adjust
              </label>
              {selectedNode.effects.colorAdjust.enabled && (
                <div className="grid-2">
                  <label className="field-label">
                    Tint
                    <input
                      type="color"
                      className="studio-input"
                      data-testid="fx-color-tint"
                      value={selectedNode.effects.colorAdjust.tint}
                      onChange={(e) =>
                        onChangeEffects(selectedNode.id, {
                          ...selectedNode.effects,
                          colorAdjust: {
                            ...selectedNode.effects.colorAdjust,
                            tint: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field-label">
                    Tint Amount
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      className="studio-input"
                      data-testid="fx-color-tint-amount"
                      value={selectedNode.effects.colorAdjust.tintAmount}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val)) {
                          onChangeEffects(selectedNode.id, {
                            ...selectedNode.effects,
                            colorAdjust: {
                              ...selectedNode.effects.colorAdjust,
                              tintAmount: Math.max(0, Math.min(1, val)),
                            },
                          });
                        }
                      }}
                    />
                  </label>
                  <label className="field-label">
                    Brightness
                    <input
                      type="number"
                      min="-1"
                      max="1"
                      step="0.05"
                      className="studio-input"
                      data-testid="fx-color-brightness"
                      value={selectedNode.effects.colorAdjust.brightness}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val)) {
                          onChangeEffects(selectedNode.id, {
                            ...selectedNode.effects,
                            colorAdjust: {
                              ...selectedNode.effects.colorAdjust,
                              brightness: Math.max(-1, Math.min(1, val)),
                            },
                          });
                        }
                      }}
                    />
                  </label>
                  <label className="field-label">
                    Contrast
                    <input
                      type="number"
                      min="-1"
                      max="1"
                      step="0.05"
                      className="studio-input"
                      data-testid="fx-color-contrast"
                      value={selectedNode.effects.colorAdjust.contrast}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val)) {
                          onChangeEffects(selectedNode.id, {
                            ...selectedNode.effects,
                            colorAdjust: {
                              ...selectedNode.effects.colorAdjust,
                              contrast: Math.max(-1, Math.min(1, val)),
                            },
                          });
                        }
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="panel-section" style={{ borderBottom: 'none' }} data-testid="camera-panel">
        <div className="panel-heading">
          <span>Shot Camera</span>
          <button
            type="button"
            className="studio-btn"
            data-testid="camera-reset-btn"
            onClick={() =>
              onChangeCamera({
                x: shot.width / 2,
                y: shot.height / 2,
                zoom: 1,
              })
            }
          >
            Reset
          </button>
        </div>
        <div className="grid-2">
          <label className="field-label">
            Cam X
            <input
              type="number"
              className="studio-input"
              data-testid="camera-x-input"
              value={shot.camera.x}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (Number.isFinite(val)) onChangeCamera({ x: val });
              }}
            />
          </label>
          <label className="field-label">
            Cam Y
            <input
              type="number"
              className="studio-input"
              data-testid="camera-y-input"
              value={shot.camera.y}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (Number.isFinite(val)) onChangeCamera({ y: val });
              }}
            />
          </label>
          <label className="field-label">
            Cam Zoom
            <input
              type="number"
              min="0.1"
              step="0.1"
              className="studio-input"
              data-testid="camera-zoom-input"
              value={shot.camera.zoom}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (Number.isFinite(val) && val > 0) onChangeCamera({ zoom: val });
              }}
            />
          </label>
          <label className="field-label">
            Global Shadow °
            <input
              type="number"
              className="studio-input"
              data-testid="global-shadow-angle-input"
              value={shot.globalShadowAngle}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (Number.isFinite(val)) onChangeGlobalShadowAngle(val);
              }}
            />
          </label>
        </div>
      </div>
    </aside>
  );
}
