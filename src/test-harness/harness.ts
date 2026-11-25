import type { HistoryStats } from '../application/history';
import { ProjectStore, type ReplayLog, type ReplayReport } from '../application/store';
import type { EditRect } from '../assets/cutting';
import { decodeImageInBrowser } from '../assets/sourceImport';
import type { Command } from '../domain/commands';
import type { EvaluatedScene } from '../domain/evaluator';
import { sha256Hex } from '../domain/hash';
import { hitTestScene } from '../domain/hitTest';
import type { MaterialRecipe, Project, SourceRecord } from '../domain/schema';
import { probeExportCapabilities } from '../export/capabilities';
import { exportProjectRange } from '../export/pipeline';
import type { CapabilityReport, ExportOptions } from '../export/types';
import { packAssetPackage, unpackAssetPackage } from '../persistence/assetPackage';
import {
  IndexedDbRecoveryStorage,
  RecoveryManager,
  type RecoveryInfo,
} from '../persistence/recovery';
import { packArchive, unpackArchive } from '../persistence/zip';
import { probeWebGlCapabilities } from '../render/capabilities';
import { PixiStageRenderer, type RenderOptions, type ResourceCounters } from '../render/pixiAdapter';
import { loadFixtureById } from './fixtures';

export interface FrameArtifactDto {
  width: number;
  height: number;
  rgba: number[];
  pngBytes: number[];
}

export interface ExportArtifactDto {
  format: string;
  mimeType: string;
  extension: string;
  bytes: number[];
  frameCount: number;
  width: number;
  height: number;
  fps: { num: number; den: number };
  alpha: boolean;
  codec?: string;
  maxQueueDepth: number;
  durationMs: number;
}

export interface StudioHarness {
  loadFixture(id: string): Promise<void>;
  loadArchive(bytes: number[]): Promise<void>;
  packCurrentArchive(): Promise<number[]>;
  packAssetPackage(
    target: { kind: 'asset'; assetId: string } | { kind: 'rig'; rootNodeId: string },
  ): Promise<number[]>;
  importAssetPackage(bytes: number[]): Promise<{ importedNodeIds: string[]; importedAssetIds: string[] }>;
  importSource(
    name: string,
    bytes: number[],
    options?: { createInitialAsset?: boolean },
  ): Promise<{ source: SourceRecord; assetId?: string; deduplicated: boolean }>;
  commitCutoutEdit(params: {
    assetId: string;
    editRect: EditRect;
    mask: number[] | null;
    overlay: number[] | null;
    anchorX: number;
    anchorY: number;
  }): Promise<Project>;
  createMaterialAsset(params: {
    assetId?: string;
    name: string;
    recipe: MaterialRecipe;
  }): Promise<{ assetId: string; project: Project }>;
  updateMaterialAsset(params: { assetId: string; recipe: MaterialRecipe }): Promise<Project>;
  dispatch(command: Command): Promise<Project>;
  undo(): Promise<Project | null>;
  redo(): Promise<Project | null>;
  historyStats(): HistoryStats;
  isDirty(): boolean;
  markSaved(): void;
  snapshot(): Project;
  evaluate(tick: number): EvaluatedScene;
  hitTest(tick: number, x: number, y: number, includeLocked?: boolean): string | null;
  render(tick: number, options?: RenderOptions): Promise<FrameArtifactDto>;
  exportRange(
    options: Omit<ExportOptions, 'signal' | 'onProgress'> & { abortAfterFrames?: number },
  ): Promise<ExportArtifactDto>;
  replay(log: ReplayLog): Promise<ReplayReport>;
  resources(): ResourceCounters;
  clearTextures(): void;
  probeCapabilities(): Promise<CapabilityReport>;
  saveRecovery(): Promise<RecoveryInfo>;
  inspectRecovery(): Promise<RecoveryInfo | null>;
  recoverFromStorage(): Promise<Project>;
  discardRecovery(): Promise<void>;
  dispose(): void;
}

export function createStudioHarness(): StudioHarness {
  const store = new ProjectStore();
  const renderer = new PixiStageRenderer();
  const recovery = new RecoveryManager(new IndexedDbRecoveryStorage());

  return {
    async loadFixture(id: string): Promise<void> {
      const fixture = loadFixtureById(id);
      for (const blob of fixture.blobs.values()) {
        blob.sha256 = await sha256Hex(blob.bytes);
      }
      renderer.clearTextures();
      store.load(fixture.project, fixture.blobs);
    },

    async loadArchive(bytes: number[]): Promise<void> {
      const unpacked = await unpackArchive(new Uint8Array(bytes), decodeImageInBrowser);
      renderer.clearTextures();
      store.replaceProjectTransactional(unpacked.project, unpacked.blobs);
    },

    async packCurrentArchive(): Promise<number[]> {
      const packed = await packArchive(store.snapshot(), store.getBlobs());
      return Array.from(packed);
    },

    async packAssetPackage(target): Promise<number[]> {
      const packed = await packAssetPackage(store.snapshot(), store.getBlobs(), target);
      return Array.from(packed);
    },

    async importAssetPackage(bytes: number[]) {
      const unpacked = await unpackAssetPackage(new Uint8Array(bytes), decodeImageInBrowser);
      return store.importAssetPackage(unpacked);
    },

    async importSource(name: string, bytes: number[], options?: { createInitialAsset?: boolean }) {
      const raw = new Uint8Array(bytes);
      const decoded = await decodeImageInBrowser(raw);
      return store.importSource({
        name,
        bytes: raw,
        mimeType: decoded.mimeType,
        width: decoded.width,
        height: decoded.height,
        rgba: decoded.rgba,
        createInitialAsset: options?.createInitialAsset ?? true,
      });
    },

    async commitCutoutEdit(params) {
      return store.commitCutoutEdit({
        assetId: params.assetId,
        editRect: params.editRect,
        mask: params.mask ? new Uint8Array(params.mask) : null,
        overlay: params.overlay ? new Uint8Array(params.overlay) : null,
        anchorX: params.anchorX,
        anchorY: params.anchorY,
      });
    },

    async createMaterialAsset(params) {
      return store.createMaterialAsset(params);
    },

    async updateMaterialAsset(params) {
      return store.updateMaterialAsset(params);
    },

    async dispatch(command: Command): Promise<Project> {
      return store.dispatch(command);
    },

    async undo(): Promise<Project | null> {
      return store.undo();
    },

    async redo(): Promise<Project | null> {
      return store.redo();
    },

    historyStats(): HistoryStats {
      return store.historyStats();
    },

    isDirty(): boolean {
      return store.isDirty();
    },

    markSaved(): void {
      store.markSaved();
    },

    snapshot(): Project {
      return store.snapshot();
    },

    evaluate(tick: number): EvaluatedScene {
      return store.evaluate(tick);
    },

    hitTest(tick: number, x: number, y: number, includeLocked = false): string | null {
      const scene = store.evaluate(tick);
      const blobs = store.getBlobs();
      return hitTestScene(scene, { x, y }, {
        includeLocked,
        getAlphaAt(blobId, px, py) {
          const blob = blobs.get(blobId);
          if (!blob || px < 0 || py < 0 || px >= blob.width || py >= blob.height) {
            return 0;
          }
          return blob.rgba[(py * blob.width + px) * 4 + 3] ?? 0;
        },
      });
    },

    async render(tick: number, options?: RenderOptions): Promise<FrameArtifactDto> {
      const scene = store.evaluate(tick, {
        outputWidth: options?.outputWidth,
        outputHeight: options?.outputHeight,
      });
      const result = await renderer.renderToPng(scene, store.getBlobs(), options);
      return {
        width: result.width,
        height: result.height,
        rgba: Array.from(result.rgba),
        pngBytes: Array.from(result.pngBytes),
      };
    },

    async exportRange(options): Promise<ExportArtifactDto> {
      const controller = new AbortController();
      const { abortAfterFrames, ...exportOpts } = options;
      const artifact = await exportProjectRange(store.snapshot(), store.getBlobs(), renderer, {
        ...exportOpts,
        signal: controller.signal,
        onProgress(progress) {
          if (abortAfterFrames !== undefined && progress.completedFrames >= abortAfterFrames) {
            controller.abort();
          }
        },
      });
      return {
        format: artifact.format,
        mimeType: artifact.mimeType,
        extension: artifact.extension,
        bytes: Array.from(artifact.bytes),
        frameCount: artifact.frameCount,
        width: artifact.width,
        height: artifact.height,
        fps: artifact.fps,
        alpha: artifact.alpha,
        ...(artifact.codec ? { codec: artifact.codec } : {}),
        maxQueueDepth: artifact.maxQueueDepth,
        durationMs: artifact.durationMs,
      };
    },

    async replay(log: ReplayLog): Promise<ReplayReport> {
      return store.replay(log);
    },

    resources(): ResourceCounters {
      return renderer.getResourceCounters();
    },

    clearTextures(): void {
      renderer.clearTextures();
    },

    async probeCapabilities(): Promise<CapabilityReport> {
      return probeExportCapabilities(probeWebGlCapabilities());
    },

    async saveRecovery(): Promise<RecoveryInfo> {
      return recovery.saveSnapshot(store.snapshot(), store.getBlobs());
    },

    async inspectRecovery(): Promise<RecoveryInfo | null> {
      return recovery.inspect();
    },

    async recoverFromStorage(): Promise<Project> {
      const restored = await recovery.recover(decodeImageInBrowser);
      renderer.clearTextures();
      store.replaceProjectTransactional(restored.project, restored.blobs);
      return store.snapshot();
    },

    async discardRecovery(): Promise<void> {
      await recovery.discard();
    },

    dispose(): void {
      renderer.dispose();
    },
  };
}

declare global {
  interface Window {
    __TERRYMATOR_HARNESS__?: StudioHarness;
  }
}

export function mountHarness(): StudioHarness {
  const harness = createStudioHarness();
  window.__TERRYMATOR_HARNESS__ = harness;
  return harness;
}
