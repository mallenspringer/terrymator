import { useState } from 'react';
import { createId } from '../domain/ids';
import type {
  Interpolation,
  LoopMode,
  LoopScope,
  Project,
  TrackProperty,
} from '../domain/schema';
import { TICKS_PER_SECOND, frameIndexToTick } from '../domain/time';
import type { PendingDraft } from './draftState';

interface TimelinePanelProps {
  project: Project;
  currentTick: number;
  isPlaying: boolean;
  loopPlayback: boolean;
  autoKey: boolean;
  selectedNodeId: string | null;
  pendingDrafts: PendingDraft[];
  onTogglePlay: () => void;
  onSetTick: (tick: number) => void;
  onStepFrames: (delta: number) => void;
  onToggleLoopPlayback: (loop: boolean) => void;
  onToggleAutoKey: (auto: boolean) => void;
  onSetWorkRange: (inTick: number, outTick: number) => void;
  onKeySelectedNode: () => void;
  onCapturePose: () => void;
  onCommitDrafts: () => void;
  onDiscardDrafts: () => void;
  onMoveKey: (trackId: string, fromTick: number, toTick: number) => void;
  onDuplicateKey: (trackId: string, fromTick: number, toTick: number) => void;
  onDeleteKey: (trackId: string, tick: number) => void;
  onSetKeyInterpolation: (trackId: string, tick: number, interpolation: Interpolation) => void;
  onUpsertLoopScope: (loop: LoopScope) => void;
  onDeleteLoopScope: (loopId: string) => void;
}

export function TimelinePanel({
  project,
  currentTick,
  isPlaying,
  loopPlayback,
  autoKey,
  selectedNodeId,
  pendingDrafts,
  onTogglePlay,
  onSetTick,
  onStepFrames,
  onToggleLoopPlayback,
  onToggleAutoKey,
  onSetWorkRange,
  onKeySelectedNode,
  onCapturePose,
  onCommitDrafts,
  onDiscardDrafts,
  onMoveKey,
  onDuplicateKey,
  onDeleteKey,
  onSetKeyInterpolation,
  onUpsertLoopScope,
  onDeleteLoopScope,
}: TimelinePanelProps) {
  const [timelineZoom, setTimelineZoom] = useState<number>(1);
  const [selectedKey, setSelectedKey] = useState<{ trackId: string; tick: number } | null>(null);
  const [targetFrame, setTargetFrame] = useState<number>(0);

  // Loop creation form state
  const [loopSelector, setLoopSelector] = useState<'group' | 'object' | 'property'>('group');
  const [loopProp, setLoopProp] = useState<TrackProperty>('transform.angle');
  const [loopMode, setLoopMode] = useState<LoopMode>('repeat');
  const [loopStartFrame, setLoopStartFrame] = useState<number>(0);
  const [loopEndFrame, setLoopEndFrame] = useState<number>(12);
  const [loopActFrame, setLoopActFrame] = useState<number>(0);
  const [loopSpeed, setLoopSpeed] = useState<number>(1);
  const [loopOffsetFrames, setLoopOffsetFrames] = useState<number>(0);

  const fps = project.shot.fps;
  const ticksPerFrame = (TICKS_PER_SECOND * fps.den) / fps.num;
  const totalFrames = Math.max(1, Math.round(project.shot.durationTicks / ticksPerFrame));
  const currentFrame = Math.round(currentTick / ticksPerFrame);

  const workRange = project.shot.workRange ?? { inTick: 0, outTick: project.shot.durationTicks };
  const inFrame = Math.round(workRange.inTick / ticksPerFrame);
  const outFrame = Math.round(workRange.outTick / ticksPerFrame);

  const tracks = Object.values(project.tracks);
  const loops = Object.values(project.loopScopes);

  const activeKeyObj = selectedKey
    ? project.tracks[selectedKey.trackId]?.keys.find((k) => k.tick === selectedKey.tick)
    : undefined;

  const handleAddLoop = () => {
    if (!selectedNodeId) return;
    const startTick = frameIndexToTick(0, Math.max(0, loopStartFrame), fps);
    const endTick = frameIndexToTick(0, Math.max(loopStartFrame + 1, loopEndFrame), fps);
    const activationStartTick = frameIndexToTick(0, Math.max(0, loopActFrame), fps);
    const offsetTicks = Math.round(loopOffsetFrames * ticksPerFrame);

    onUpsertLoopScope({
      id: createId('loop'),
      selectorKind: loopSelector,
      targetKind: 'node',
      targetId: selectedNodeId,
      ...(loopSelector === 'property' ? { property: loopProp } : {}),
      startTick,
      endTick,
      activationStartTick,
      speed: Math.max(0.05, loopSpeed),
      offsetTicks,
      mode: loopMode,
    });
  };

  return (
    <section className="studio-timeline" aria-label="Timeline">
      <div className="timeline-transport">
        <button
          type="button"
          className="studio-btn primary"
          data-testid="timeline-play-btn"
          onClick={onTogglePlay}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          className="studio-btn"
          data-testid="timeline-step-back"
          onClick={() => onStepFrames(-1)}
        >
          ◀
        </button>
        <button
          type="button"
          className="studio-btn"
          data-testid="timeline-step-fwd"
          onClick={() => onStepFrames(1)}
        >
          ▶
        </button>
        <span data-testid="timeline-frame-readout" style={{ fontSize: 12, minWidth: 110 }}>
          F {currentFrame} / {totalFrames} ({currentTick}t)
        </span>

        <input
          type="range"
          min={0}
          max={Math.max(1, project.shot.durationTicks - 1)}
          step={Math.max(1, Math.round(ticksPerFrame))}
          value={Math.min(currentTick, Math.max(0, project.shot.durationTicks - 1))}
          data-testid="timeline-scrubber"
          style={{ flex: 1, minWidth: 120 }}
          onChange={(e) => onSetTick(Number(e.target.value))}
        />

        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          In
          <input
            type="number"
            min={0}
            max={outFrame - 1}
            className="studio-input"
            style={{ width: 52 }}
            data-testid="timeline-range-in"
            value={inFrame}
            onChange={(e) => {
              const f = Math.max(0, Math.min(outFrame - 1, Math.round(Number(e.target.value) || 0)));
              onSetWorkRange(frameIndexToTick(0, f, fps), workRange.outTick);
            }}
          />
        </label>
        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          Out
          <input
            type="number"
            min={inFrame + 1}
            max={totalFrames}
            className="studio-input"
            style={{ width: 52 }}
            data-testid="timeline-range-out"
            value={outFrame}
            onChange={(e) => {
              const f = Math.max(
                inFrame + 1,
                Math.min(totalFrames, Math.round(Number(e.target.value) || 1)),
              );
              onSetWorkRange(workRange.inTick, frameIndexToTick(0, f, fps));
            }}
          />
        </label>
        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            data-testid="timeline-loop-range"
            checked={loopPlayback}
            onChange={(e) => onToggleLoopPlayback(e.target.checked)}
          />
          Loop
        </label>

        <div className="toolbar-sep" />
        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            data-testid="autokey-toggle"
            checked={autoKey}
            onChange={(e) => onToggleAutoKey(e.target.checked)}
          />
          Auto-Key
        </label>
        <button
          type="button"
          className="studio-btn"
          data-testid="insert-key-btn"
          disabled={!selectedNodeId}
          onClick={onKeySelectedNode}
        >
          + Key
        </button>
        <button
          type="button"
          className="studio-btn"
          data-testid="capture-pose-btn"
          disabled={!selectedNodeId}
          onClick={onCapturePose}
        >
          Pose Key
        </button>
        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          Zoom
          <input
            type="range"
            min={0.5}
            max={3}
            step={0.25}
            value={timelineZoom}
            data-testid="timeline-zoom"
            style={{ width: 60 }}
            onChange={(e) => setTimelineZoom(Number(e.target.value))}
          />
        </label>
      </div>

      {pendingDrafts.length > 0 && (
        <div className="banner recovery" data-testid="pending-draft-bar" style={{ padding: '4px 10px' }}>
          <span>
            {pendingDrafts.length} pending draft change(s) at frame {currentFrame} (Auto-Key is OFF).
          </span>
          <div className="row-wrap">
            <button
              type="button"
              className="studio-btn primary"
              data-testid="commit-drafts-btn"
              onClick={onCommitDrafts}
            >
              Key Drafts
            </button>
            <button
              type="button"
              className="studio-btn danger"
              data-testid="discard-drafts-btn"
              onClick={onDiscardDrafts}
            >
              Discard Drafts
            </button>
          </div>
        </div>
      )}

      <div className="timeline-body">
        <div className="timeline-tracks">
          {selectedKey && activeKeyObj && (
            <div className="row-wrap" style={{ paddingBottom: 4, borderBottom: '1px solid #222938' }}>
              <span style={{ fontSize: 11, color: '#22d3ee' }}>
                Key @ F{Math.round(selectedKey.tick / ticksPerFrame)}
              </span>
              <select
                className="studio-select"
                style={{ width: 90 }}
                data-testid="key-interp-select"
                value={activeKeyObj.interpolation}
                onChange={(e) =>
                  onSetKeyInterpolation(
                    selectedKey.trackId,
                    selectedKey.tick,
                    e.target.value as Interpolation,
                  )
                }
              >
                <option value="hold">Hold</option>
                <option value="linear">Linear</option>
                <option value="smooth">Smooth</option>
              </select>
              <input
                type="number"
                min={0}
                className="studio-input"
                style={{ width: 55 }}
                data-testid="key-target-frame"
                value={targetFrame}
                onChange={(e) => setTargetFrame(Math.max(0, Math.round(Number(e.target.value) || 0)))}
              />
              <button
                type="button"
                className="studio-btn"
                data-testid="move-key-btn"
                onClick={() => {
                  const toTick = frameIndexToTick(0, targetFrame, fps);
                  onMoveKey(selectedKey.trackId, selectedKey.tick, toTick);
                  setSelectedKey({ trackId: selectedKey.trackId, tick: toTick });
                }}
              >
                Move
              </button>
              <button
                type="button"
                className="studio-btn"
                data-testid="dup-key-btn"
                onClick={() => {
                  const toTick = frameIndexToTick(0, targetFrame, fps);
                  onDuplicateKey(selectedKey.trackId, selectedKey.tick, toTick);
                }}
              >
                Dup
              </button>
              <button
                type="button"
                className="studio-btn danger"
                data-testid="delete-key-btn"
                onClick={() => {
                  onDeleteKey(selectedKey.trackId, selectedKey.tick);
                  setSelectedKey(null);
                }}
              >
                Del
              </button>
            </div>
          )}

          {tracks.length === 0 ? (
            <div style={{ color: '#6b778c', fontSize: 11 }}>
              No keyframes yet. Select a layer and click + Key, Pose Key, or enable Auto-Key.
            </div>
          ) : (
            tracks.map((trk) => {
              const targetLabel =
                trk.targetKind === 'camera'
                  ? 'Camera'
                  : (project.nodes[trk.targetId]?.name ?? trk.targetId);
              return (
                <div
                  key={trk.id}
                  className="timeline-track-row"
                  style={{ minWidth: `${Math.round(100 * timelineZoom)}%` }}
                >
                  <span className="timeline-track-label">
                    {targetLabel}.{trk.property}
                  </span>
                  <div className="timeline-track-lane">
                    {trk.keys.map((k) => {
                      const pct = (k.tick / Math.max(1, project.shot.durationTicks)) * 100;
                      const isSel =
                        selectedKey?.trackId === trk.id && selectedKey?.tick === k.tick;
                      return (
                        <button
                          key={k.tick}
                          type="button"
                          title={`F${Math.round(k.tick / ticksPerFrame)} (${k.interpolation})`}
                          className={`key-diamond${isSel ? ' selected' : ''}`}
                          style={{ left: `${pct}%` }}
                          onClick={() => {
                            setSelectedKey({ trackId: trk.id, tick: k.tick });
                            setTargetFrame(Math.round(k.tick / ticksPerFrame));
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="timeline-loops">
          <div className="panel-heading" style={{ marginBottom: 4 }}>
            <span>Loop Clocks ({loops.length})</span>
          </div>
          <div className="row-wrap" style={{ marginBottom: 4 }}>
            <select
              className="studio-select"
              style={{ width: 78 }}
              data-testid="loop-selector-kind"
              value={loopSelector}
              onChange={(e) => setLoopSelector(e.target.value as 'group' | 'object' | 'property')}
            >
              <option value="group">Group</option>
              <option value="object">Object</option>
              <option value="property">Prop</option>
            </select>
            {loopSelector === 'property' && (
              <select
                className="studio-select"
                style={{ width: 105 }}
                value={loopProp}
                onChange={(e) => setLoopProp(e.target.value as TrackProperty)}
              >
                <option value="transform.x">x</option>
                <option value="transform.y">y</option>
                <option value="transform.angle">angle</option>
                <option value="opacity">opacity</option>
              </select>
            )}
            <select
              className="studio-select"
              style={{ width: 92 }}
              data-testid="loop-mode-select"
              value={loopMode}
              onChange={(e) => setLoopMode(e.target.value as LoopMode)}
            >
              <option value="repeat">Repeat</option>
              <option value="ping-pong">Ping-Pong</option>
              <option value="once-and-hold">Once+Hold</option>
            </select>
            <input
              type="number"
              min={0}
              className="studio-input"
              style={{ width: 44 }}
              title="Start Frame"
              data-testid="loop-start-frame"
              value={loopStartFrame}
              onChange={(e) => setLoopStartFrame(Math.max(0, Math.round(Number(e.target.value) || 0)))}
            />
            <input
              type="number"
              min={1}
              className="studio-input"
              style={{ width: 44 }}
              title="End Frame"
              data-testid="loop-end-frame"
              value={loopEndFrame}
              onChange={(e) => setLoopEndFrame(Math.max(1, Math.round(Number(e.target.value) || 1)))}
            />
            <input
              type="number"
              min={0}
              className="studio-input"
              style={{ width: 44 }}
              title="Activation Frame"
              data-testid="loop-activation-frame"
              value={loopActFrame}
              onChange={(e) => setLoopActFrame(Math.max(0, Math.round(Number(e.target.value) || 0)))}
            />
            <input
              type="number"
              min={0.1}
              step={0.25}
              className="studio-input"
              style={{ width: 46 }}
              title="Speed"
              data-testid="loop-speed"
              value={loopSpeed}
              onChange={(e) => setLoopSpeed(Math.max(0.1, Number(e.target.value) || 1))}
            />
            <input
              type="number"
              className="studio-input"
              style={{ width: 46 }}
              title="Offset Frames"
              data-testid="loop-offset-frames"
              value={loopOffsetFrames}
              onChange={(e) => setLoopOffsetFrames(Number(e.target.value) || 0)}
            />
            <button
              type="button"
              className="studio-btn primary"
              data-testid="add-loop-btn"
              disabled={!selectedNodeId}
              onClick={handleAddLoop}
            >
              + Loop
            </button>
          </div>
          {loops.map((l) => (
            <div key={l.id} className="row-between" style={{ fontSize: 11, padding: '2px 0' }}>
              <span>
                {l.selectorKind}({project.nodes[l.targetId]?.name ?? l.targetId}) · {l.mode} [F
                {Math.round(l.startTick / ticksPerFrame)}..F{Math.round(l.endTick / ticksPerFrame)}]
              </span>
              <button
                type="button"
                className="studio-btn danger"
                onClick={() => onDeleteLoopScope(l.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
