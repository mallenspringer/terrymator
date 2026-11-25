import { useState } from 'react';
import type { SceneNode, TransformType } from '../domain/schema';

interface LayersInspectorPanelProps {
  nodes: SceneNode[];
  selectedNode: SceneNode | null;
  onSelectNode: (nodeId: string | null) => void;
  onAddGroup: () => void;
  onDuplicateNode: (nodeId: string) => void;
  onMakeUnique: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onToggleVisible: (nodeId: string, visible: boolean) => void;
  onToggleLocked: (nodeId: string, locked: boolean) => void;
  onChangeDrawOrder: (nodeId: string, drawOrder: number) => void;
  onChangeTransform: (nodeId: string, patch: Partial<TransformType>) => void;
  onChangeOpacity: (nodeId: string, opacity: number) => void;
  onChangeParent: (nodeId: string, parentId: string | null) => void;
  onRenameNode: (nodeId: string, name: string) => void;
}

export function LayersInspectorPanel({
  nodes,
  selectedNode,
  onSelectNode,
  onAddGroup,
  onDuplicateNode,
  onMakeUnique,
  onDeleteNode,
  onToggleVisible,
  onToggleLocked,
  onChangeDrawOrder,
  onChangeTransform,
  onChangeOpacity,
  onChangeParent,
  onRenameNode,
}: LayersInspectorPanelProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

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
      cursor = nodes.find((n) => n.id === cursor)?.parentId ?? null;
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

            return (
              <div
                key={node.id}
                className={`card-item${isSelected ? ' selected' : ''}`}
                data-testid={`layer-row-${node.id}`}
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
                      {isGroup ? '[G] ' : ''}
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
        <div className="panel-section" style={{ borderBottom: 'none' }} data-testid="inspector-panel">
          <div className="panel-heading">
            <span>Inspector</span>
            <div className="row-wrap">
              <button
                type="button"
                className="studio-btn"
                data-testid="duplicate-node-btn"
                onClick={() => onDuplicateNode(selectedNode.id)}
              >
                Duplicate
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

          <label className="field-label">
            Parent
            <select
              className="studio-select"
              data-testid="inspector-parent-select"
              value={selectedNode.parentId ?? ''}
              onChange={(e) =>
                onChangeParent(selectedNode.id, e.target.value === '' ? null : e.target.value)
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
                value={selectedNode.transform.pivotX}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) onChangeTransform(selectedNode.id, { pivotX: val });
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
          </div>
        </div>
      )}
    </aside>
  );
}
