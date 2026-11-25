import { useEffect, useRef, type PointerEvent, type WheelEvent } from 'react';
import type { BlobRecord } from '../application/blobStore';
import type { EvaluatedScene } from '../domain/evaluator';
import { hitTestScene } from '../domain/hitTest';
import { applyAffineToPoint, invertAffine, IDENTITY_AFFINE } from '../domain/math';
import type { Project } from '../domain/schema';
import {
  PixiStageRenderer,
  canvasPointToStage,
  type EditorViewport,
} from '../render/pixiAdapter';

interface StageViewportProps {
  project: Project;
  scene: EvaluatedScene;
  blobs: Map<string, BlobRecord>;
  renderer: PixiStageRenderer;
  viewport: EditorViewport;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onDragMoveNode: (nodeId: string, x: number, y: number, coalesceKey: string) => void;
  onViewportChange: (next: EditorViewport) => void;
}

const VIEWPORT_WIDTH = 680;
const VIEWPORT_HEIGHT = 400;

export function StageViewport({
  project,
  scene,
  blobs,
  renderer,
  viewport,
  selectedNodeId,
  onSelectNode,
  onDragMoveNode,
  onViewportChange,
}: StageViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const dragSeqRef = useRef(0);
  const dragStateRef = useRef<
    | {
        mode: 'pan';
        startClientX: number;
        startClientY: number;
        origPanX: number;
        origPanY: number;
      }
    | {
        mode: 'node';
        nodeId: string;
        coalesceKey: string;
        startStageX: number;
        startStageY: number;
        origX: number;
        origY: number;
      }
    | null
  >(null);

  useEffect(() => {
    let active = true;
    const draw = async () => {
      await renderer.init(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
      await renderer.render(scene, blobs, {
        outputWidth: VIEWPORT_WIDTH,
        outputHeight: VIEWPORT_HEIGHT,
        transparentBackground: project.shot.background.alpha === 0,
        viewport,
        showGuides: true,
        selectedNodeId,
      });
      if (!active) return;
      const host = hostRef.current;
      const canvas = renderer.getCanvas();
      if (host && canvas.parentElement !== host) {
        host.replaceChildren(canvas);
      }
    };
    void draw();
    return () => {
      active = false;
    };
  }, [blobs, project.shot.background.alpha, renderer, scene, selectedNodeId, viewport]);

  const toCanvasCoords = (e: PointerEvent<HTMLDivElement>): { cx: number; cy: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      cx: e.clientX - rect.left,
      cy: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStateRef.current = {
        mode: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        origPanX: viewport.panX,
        origPanY: viewport.panY,
      };
      return;
    }

    if (e.button !== 0) return;

    const { cx, cy } = toCanvasCoords(e);
    const stagePt = canvasPointToStage(
      cx,
      cy,
      VIEWPORT_WIDTH,
      VIEWPORT_HEIGHT,
      viewport,
      scene.camera.stageToOutput,
    );

    const hitId = hitTestScene(scene, stagePt, {
      getAlphaAt(blobId, px, py) {
        const blob = blobs.get(blobId);
        if (!blob || px < 0 || py < 0 || px >= blob.width || py >= blob.height) return 0;
        return blob.rgba[(py * blob.width + px) * 4 + 3] ?? 0;
      },
    });

    onSelectNode(hitId);
    if (!hitId) return;

    const node = project.nodes[hitId];
    if (!node || node.locked) return;

    dragSeqRef.current += 1;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      mode: 'node',
      nodeId: hitId,
      coalesceKey: `drag-${hitId}-${dragSeqRef.current}`,
      startStageX: stagePt.x,
      startStageY: stagePt.y,
      origX: node.transform.x,
      origY: node.transform.y,
    };
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag) return;

    if (drag.mode === 'pan') {
      onViewportChange({
        ...viewport,
        panX: drag.origPanX + (e.clientX - drag.startClientX),
        panY: drag.origPanY + (e.clientY - drag.startClientY),
      });
      return;
    }

    const { cx, cy } = toCanvasCoords(e);
    const stagePt = canvasPointToStage(
      cx,
      cy,
      VIEWPORT_WIDTH,
      VIEWPORT_HEIGHT,
      viewport,
      scene.camera.stageToOutput,
    );

    const node = project.nodes[drag.nodeId];
    const parentItem = node?.parentId
      ? scene.drawList.find((d) => d.nodeId === node.parentId)
      : undefined;
    const parentInv = parentItem ? invertAffine(parentItem.worldMatrix) : IDENTITY_AFFINE;
    const p0 = applyAffineToPoint(parentInv, { x: drag.startStageX, y: drag.startStageY });
    const p1 = applyAffineToPoint(parentInv, stagePt);

    onDragMoveNode(
      drag.nodeId,
      Math.round((drag.origX + (p1.x - p0.x)) * 100) / 100,
      Math.round((drag.origY + (p1.y - p0.y)) * 100) / 100,
      drag.coalesceKey,
    );
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current) {
      dragStateRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const nextZoom = Math.max(0.25, Math.min(4, Number((viewport.zoom * factor).toFixed(3))));
    onViewportChange({ ...viewport, zoom: nextZoom });
  };

  return (
    <section className="stage-center" aria-label="Stage Viewport">
      <div
        ref={hostRef}
        className="stage-canvas-host"
        data-testid="stage-canvas"
        style={{ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      />
      <div className="stage-status" data-testid="stage-status">
        Shot: {project.shot.width}×{project.shot.height} @ {project.shot.fps.num}/
        {project.shot.fps.den} fps · Nodes: {Object.keys(project.nodes).length} · Drag to move ·
        Alt+Drag/Wheel for viewport
      </div>
    </section>
  );
}
