import { useEffect, useRef, useState } from 'react';
import { ProjectStore } from '../application/store';
import { TICKS_PER_SECOND } from '../domain/time';
import { probeExportCapabilities } from '../export/capabilities';
import { exportProjectRange } from '../export/pipeline';
import type { CapabilityReport } from '../export/types';
import { probeWebGlCapabilities } from '../render/capabilities';
import { PixiStageRenderer } from '../render/pixiAdapter';
import { loadFixtureById, type FixtureId } from '../test-harness/fixtures';

export function App() {
  const stageHostRef = useRef<HTMLDivElement | null>(null);
  const storeRef = useRef<ProjectStore>(new ProjectStore());
  const rendererRef = useRef<PixiStageRenderer>(new PixiStageRenderer());

  const [fixtureId, setFixtureId] = useState<FixtureId>('G0_DEMO');
  const [frameIndex, setFrameIndex] = useState<number>(0);
  const [status, setStatus] = useState<string>('Initializing...');
  const [caps, setCaps] = useState<CapabilityReport | null>(null);

  useEffect(() => {
    let active = true;
    const renderCurrent = async () => {
      try {
        const fixture = loadFixtureById(fixtureId);
        storeRef.current.load(fixture.project, fixture.blobs);
        const snap = storeRef.current.snapshot();
        const fps = snap.shot.fps;
        const tick = Math.round((frameIndex * TICKS_PER_SECOND * fps.den) / fps.num);
        const scene = storeRef.current.evaluate(tick);

        await rendererRef.current.init(snap.shot.width, snap.shot.height);
        await rendererRef.current.render(scene, storeRef.current.getBlobs());

        const host = stageHostRef.current;
        const canvas = rendererRef.current.getCanvas();
        if (host && canvas.parentElement !== host) {
          host.replaceChildren(canvas);
        }
        if (active) {
          setStatus(`Rendered ${fixtureId} frame ${frameIndex} (tick ${tick})`);
        }
      } catch (err) {
        if (active) {
          setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    };
    void renderCurrent();
    return () => {
      active = false;
    };
  }, [fixtureId, frameIndex]);

  useEffect(() => {
    const renderer = rendererRef.current;
    return () => {
      renderer.dispose();
    };
  }, []);

  const handleProbe = async () => {
    const report = await probeExportCapabilities(probeWebGlCapabilities());
    setCaps(report);
  };

  const handleExportPngSequence = async () => {
    try {
      const snap = storeRef.current.snapshot();
      setStatus('Exporting PNG sequence...');
      const artifact = await exportProjectRange(
        snap,
        storeRef.current.getBlobs(),
        rendererRef.current,
        {
          format: 'png-sequence',
          range: { inTick: 0, outTick: snap.shot.durationTicks },
          fps: snap.shot.fps,
          alpha: true,
        },
      );
      const copy = new Uint8Array(artifact.bytes.byteLength);
      copy.set(artifact.bytes);
      const blob = new Blob([copy.buffer], { type: artifact.mimeType });
      const url = URL.createObjectURL(blob);
      rendererRef.current.trackObjectUrl(1);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fixtureId.toLowerCase()}-png-seq.${artifact.extension}`;
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        rendererRef.current.trackObjectUrl(-1);
      }, 1000);
      setStatus(`Exported ${artifact.frameCount} frames (${artifact.bytes.byteLength} bytes)`);
    } catch (err) {
      setStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '16px',
        background: '#12151c',
        color: '#e6eaf2',
        minHeight: '100vh',
      }}
    >
      <h1 style={{ margin: '0 0 12px', fontSize: '18px' }}>Terrymator — Gate G0 Feasibility Shell</h1>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
        <label>
          Fixture:{' '}
          <select
            aria-label="Fixture"
            data-testid="fixture-select"
            value={fixtureId}
            onChange={(e) => {
              setFixtureId(e.target.value as FixtureId);
              setFrameIndex(0);
            }}
          >
            <option value="G0_DEMO">G0_DEMO</option>
            <option value="F09_EXPORT_CLOCK">F09_EXPORT_CLOCK</option>
          </select>
        </label>
        <button
          type="button"
          data-testid="step-frame-btn"
          onClick={() => setFrameIndex((f) => (f + 1) % 12)}
        >
          Next Frame ({frameIndex})
        </button>
        <button type="button" data-testid="probe-caps-btn" onClick={() => void handleProbe()}>
          Probe Capabilities
        </button>
        <button
          type="button"
          data-testid="export-png-btn"
          onClick={() => void handleExportPngSequence()}
        >
          Export PNG Sequence
        </button>
      </div>
      <p data-testid="status-text" style={{ fontSize: '13px', color: '#9aa6b8' }}>
        {status}
      </p>
      <div
        ref={stageHostRef}
        data-testid="stage-canvas"
        style={{
          width: 320,
          height: 180,
          border: '1px solid #2c3445',
          background:
            'repeating-conic-gradient(#1f2430 0% 25%, #272d3b 0% 50%) 50% / 16px 16px',
        }}
      />
      {caps && (
        <pre
          data-testid="caps-output"
          style={{
            marginTop: '12px',
            padding: '10px',
            background: '#0b0d12',
            fontSize: '12px',
            overflow: 'auto',
          }}
        >
          {JSON.stringify(caps, null, 2)}
        </pre>
      )}
    </main>
  );
}
