import {
  compositeCutoutAsset,
  extractMaskFromRgba,
  maskToPngBytes,
  type EditRect,
} from '../assets/cutting';
import { synthesizeMaterial } from '../assets/materialSynthesis';
import { encodePngRgba } from '../assets/pngCodec';
import { applyCommand, type Command } from '../domain/commands';
import { AppError } from '../domain/errors';
import {
  cutoutDerivedBlobKey,
  evaluateScene,
  type EvaluateOptions,
  type EvaluatedScene,
} from '../domain/evaluator';
import { createId } from '../domain/ids';
import {
  canonicalStringify,
  createBlankProject,
  validateProject,
  type MaterialRecipe,
  type Project,
  type SourceMimeType,
  type SourceRecord,
} from '../domain/schema';
import { AsyncJobGuard } from './asyncJobs';
import { BlobStore, collectProjectBlobIds, type BlobRecord } from './blobStore';
import { UndoHistory, type HistoryStats } from './history';

export interface ReplayCheckpoint {
  tick: number;
  expectedDrawOrderNodeIds?: string[];
  expectedSnapshotHash?: string;
}

export interface ReplayLog {
  schemaVersion: 1;
  fixtureId: string;
  commands: Command[];
  checkpoints: ReplayCheckpoint[];
}

export interface ReplayReport {
  ok: boolean;
  commandsApplied: number;
  finalRevision: number;
  finalSnapshotHash: string;
  checkpointsChecked: number;
}

export interface DispatchOptions {
  label?: string;
  coalesceKey?: string;
  recordHistory?: boolean;
}

export class ProjectStore {
  private project: Project | null = null;
  private readonly blobStore = new BlobStore();
  private readonly derivedCutouts = new Map<string, BlobRecord>();
  private readonly history = new UndoHistory();
  public readonly asyncGuard = new AsyncJobGuard();
  private savedRevision = 1;
  private listeners = new Set<() => void>();

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public load(project: Project, blobs: Map<string, BlobRecord>): void {
    const validated = validateProject(project);
    for (const blobId of collectProjectBlobIds(validated)) {
      if (!blobs.has(blobId)) {
        throw new AppError('ERR_MISSING_ASSET', `Missing blob "${blobId}".`, { blobId });
      }
    }
    evaluateScene(validated, 0);

    this.project = structuredClone(validated);
    this.blobStore.load(blobs);
    this.derivedCutouts.clear();
    this.history.clear();
    this.asyncGuard.invalidateAll();
    this.savedRevision = validated.revision;
    this.pruneOrphanedBlobs();
    this.notify();
  }

  public replaceProjectTransactional(project: Project, blobs: Map<string, BlobRecord>): void {
    this.load(project, blobs);
  }

  public snapshot(): Project {
    if (!this.project) {
      throw new AppError('ERR_RENDER_NOT_READY', 'No project loaded in store.');
    }
    return structuredClone(this.project);
  }

  public getBlobs(): Map<string, BlobRecord> {
    const map = this.blobStore.toMap();
    if (!this.project) {
      return map;
    }

    const activeKeys = new Set<string>();
    for (const asset of Object.values(this.project.assets)) {
      if (asset.kind !== 'cutout') continue;
      const source = this.project.sources[asset.sourceId];
      if (!source) continue;
      const needsComposite =
        asset.maskBlobId !== null ||
        asset.overlayBlobId !== null ||
        asset.editRect.x !== 0 ||
        asset.editRect.y !== 0 ||
        asset.editRect.width !== source.width ||
        asset.editRect.height !== source.height;
      if (!needsComposite) continue;

      const key = cutoutDerivedBlobKey(asset.id, asset.revision);
      activeKeys.add(key);

      let derived = this.derivedCutouts.get(key);
      if (!derived) {
        const srcBlob = this.blobStore.get(source.blobId);
        if (!srcBlob) continue;
        const maskBlob = asset.maskBlobId ? this.blobStore.get(asset.maskBlobId) : undefined;
        const overlayBlob = asset.overlayBlobId ? this.blobStore.get(asset.overlayBlobId) : undefined;
        const mask = maskBlob ? extractMaskFromRgba(maskBlob.rgba) : null;
        const overlay = overlayBlob ? overlayBlob.rgba : null;
        const rgba = compositeCutoutAsset(
          srcBlob.rgba,
          srcBlob.width,
          srcBlob.height,
          asset.editRect,
          mask,
          overlay,
          true,
        );
        derived = {
          id: key,
          role: 'asset',
          mimeType: 'image/png',
          bytes: new Uint8Array(0),
          sha256: '0'.repeat(64),
          width: asset.editRect.width,
          height: asset.editRect.height,
          rgba,
        };
        this.derivedCutouts.set(key, derived);
      }
      map.set(key, derived);
    }

    for (const key of Array.from(this.derivedCutouts.keys())) {
      if (!activeKeys.has(key)) {
        this.derivedCutouts.delete(key);
      }
    }
    return map;
  }

  public getBlobCount(): number {
    return this.blobStore.size();
  }

  public isDirty(): boolean {
    if (!this.project) {
      return false;
    }
    return this.project.revision !== this.savedRevision;
  }

  public markSaved(): void {
    if (this.project) {
      this.savedRevision = this.project.revision;
      this.notify();
    }
  }

  public dispatch(command: Command, options: DispatchOptions = {}): Project {
    if (command.type === 'NEW_SHOT') {
      const next = createBlankProject({
        id: command.projectId,
        name: command.name,
        width: command.width,
        height: command.height,
        fps: command.fps,
        durationTicks: command.durationTicks,
        background: command.background,
      });
      this.load(next, new Map());
      return this.snapshot();
    }

    if (!this.project) {
      throw new AppError('ERR_RENDER_NOT_READY', 'No project loaded in store.');
    }
    const before = this.project;
    const next = applyCommand(before, command);
    evaluateScene(next, 0);

    this.project = next;

    if (options.recordHistory !== false) {
      this.history.record(options.label ?? command.type, before, next, options.coalesceKey);
      this.pruneOrphanedBlobs();
    }

    this.notify();
    return this.snapshot();
  }

  public async importSource(params: {
    name: string;
    bytes: Uint8Array;
    mimeType: SourceMimeType;
    width: number;
    height: number;
    rgba: Uint8Array;
    sourceId?: string;
    createInitialAsset?: boolean;
    assetId?: string;
  }): Promise<{ source: SourceRecord; assetId?: string; deduplicated: boolean }> {
    if (!this.project) {
      throw new AppError('ERR_RENDER_NOT_READY', 'No project loaded in store.');
    }

    const { record, deduplicated } = await this.blobStore.putSource(params.bytes, params.mimeType, {
      width: params.width,
      height: params.height,
      rgba: params.rgba,
    });

    const source: SourceRecord = {
      id: params.sourceId ?? createId('source'),
      name: params.name,
      blobId: record.id,
      sha256: record.sha256,
      mimeType: params.mimeType,
      width: params.width,
      height: params.height,
    };

    this.dispatch({ type: 'ADD_SOURCE', source }, { label: `Import ${params.name}` });

    let assetId: string | undefined;
    if (params.createInitialAsset) {
      assetId = params.assetId ?? createId('asset');
      this.dispatch(
        {
          type: 'CREATE_CUTOUT_ASSET',
          assetId,
          sourceId: source.id,
          name: params.name.replace(/\.[^.]+$/, '') || params.name,
        },
        { label: `Create asset ${params.name}` },
      );
    }

    return { source, ...(assetId ? { assetId } : {}), deduplicated };
  }

  public canUndo(): boolean {
    return this.history.canUndo();
  }

  public canRedo(): boolean {
    return this.history.canRedo();
  }

  public historyStats(): HistoryStats {
    return this.history.stats();
  }

  public async commitCutoutEdit(params: {
    assetId: string;
    editRect: EditRect;
    mask: Uint8Array | null;
    overlay: Uint8Array | null;
    anchorX: number;
    anchorY: number;
    label?: string;
  }): Promise<Project> {
    if (!this.project) {
      throw new AppError('ERR_RENDER_NOT_READY', 'No project loaded in store.');
    }

    let maskBlobId: string | null = null;
    if (params.mask) {
      const pngBytes = maskToPngBytes(params.mask, params.editRect.width, params.editRect.height);
      const rgba = new Uint8Array(params.editRect.width * params.editRect.height * 4);
      for (let i = 0; i < params.mask.length; i += 1) {
        const b = i * 4;
        rgba[b] = 255;
        rgba[b + 1] = 255;
        rgba[b + 2] = 255;
        rgba[b + 3] = params.mask[i]!;
      }
      const rec = await this.blobStore.putImmutableBlob('mask', 'image/png', pngBytes, {
        width: params.editRect.width,
        height: params.editRect.height,
        rgba,
      });
      maskBlobId = rec.id;
    }

    let overlayBlobId: string | null = null;
    if (params.overlay) {
      const pngBytes = encodePngRgba(params.overlay, params.editRect.width, params.editRect.height);
      const rec = await this.blobStore.putImmutableBlob('overlay', 'image/png', pngBytes, {
        width: params.editRect.width,
        height: params.editRect.height,
        rgba: params.overlay,
      });
      overlayBlobId = rec.id;
    }

    return this.dispatch(
      {
        type: 'COMMIT_CUTOUT_EDIT',
        assetId: params.assetId,
        editRect: params.editRect,
        maskBlobId,
        overlayBlobId,
        anchorX: params.anchorX,
        anchorY: params.anchorY,
      },
      { label: params.label ?? 'Edit Cutout' },
    );
  }

  public async createMaterialAsset(params: {
    assetId?: string;
    name: string;
    recipe: MaterialRecipe;
  }): Promise<{ assetId: string; project: Project }> {
    if (!this.project) {
      throw new AppError('ERR_RENDER_NOT_READY', 'No project loaded in store.');
    }
    const sourceImage = this.resolveMaterialSourceImage(params.recipe.imageSourceId);
    const synthesized = synthesizeMaterial(params.recipe, sourceImage);
    const pngBytes = encodePngRgba(synthesized.rgba, synthesized.width, synthesized.height);
    const rec = await this.blobStore.putImmutableBlob('asset', 'image/png', pngBytes, synthesized);
    const assetId = params.assetId ?? createId('mat');

    const project = this.dispatch(
      {
        type: 'CREATE_MATERIAL_ASSET',
        assetId,
        name: params.name,
        recipe: params.recipe,
        rasterBlobId: rec.id,
      },
      { label: `Create material ${params.name}` },
    );
    return { assetId, project };
  }

  public async updateMaterialAsset(params: {
    assetId: string;
    recipe: MaterialRecipe;
    name?: string;
    coalesceKey?: string;
  }): Promise<Project> {
    if (!this.project) {
      throw new AppError('ERR_RENDER_NOT_READY', 'No project loaded in store.');
    }
    const sourceImage = this.resolveMaterialSourceImage(params.recipe.imageSourceId);
    const synthesized = synthesizeMaterial(params.recipe, sourceImage);
    const pngBytes = encodePngRgba(synthesized.rgba, synthesized.width, synthesized.height);
    const rec = await this.blobStore.putImmutableBlob('asset', 'image/png', pngBytes, synthesized);

    return this.dispatch(
      {
        type: 'UPDATE_MATERIAL_ASSET',
        assetId: params.assetId,
        recipe: params.recipe,
        rasterBlobId: rec.id,
        ...(params.name !== undefined ? { name: params.name } : {}),
      },
      {
        label: 'Update Material',
        ...(params.coalesceKey ? { coalesceKey: params.coalesceKey } : {}),
      },
    );
  }

  private resolveMaterialSourceImage(
    imageSourceId: string | null,
  ): { width: number; height: number; rgba: Uint8Array } | undefined {
    if (!imageSourceId || !this.project) return undefined;
    const src = this.project.sources[imageSourceId];
    if (!src) {
      throw new AppError('ERR_MISSING_ASSET', `Material source "${imageSourceId}" not found.`);
    }
    const blob = this.blobStore.get(src.blobId);
    if (!blob) {
      throw new AppError('ERR_MISSING_ASSET', `Source blob "${src.blobId}" not found.`);
    }
    return { width: blob.width, height: blob.height, rgba: blob.rgba };
  }

  public undo(): Project | null {
    const prev = this.history.undo();
    if (!prev) {
      return null;
    }
    this.asyncGuard.invalidateAll();
    this.project = prev;
    this.pruneOrphanedBlobs();
    this.notify();
    return this.snapshot();
  }

  public redo(): Project | null {
    const next = this.history.redo();
    if (!next) {
      return null;
    }
    this.asyncGuard.invalidateAll();
    this.project = next;
    this.pruneOrphanedBlobs();
    this.notify();
    return this.snapshot();
  }

  private pruneOrphanedBlobs(): void {
    if (!this.project) {
      return;
    }
    const keep = collectProjectBlobIds(this.project);
    for (const id of this.history.collectReferencedBlobIds()) {
      keep.add(id);
    }
    this.blobStore.pruneUnreferenced(keep);
  }

  public evaluate(tick: number, options?: EvaluateOptions): EvaluatedScene {
    if (!this.project) {
      throw new AppError('ERR_RENDER_NOT_READY', 'No project loaded in store.');
    }
    return evaluateScene(this.project, tick, options);
  }

  public async canonicalHash(): Promise<string> {
    const snap = this.snapshot();
    const bytes = new TextEncoder().encode(canonicalStringify(snap));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  public async replay(log: ReplayLog): Promise<ReplayReport> {
    let commandsApplied = 0;
    for (const cmd of log.commands) {
      this.dispatch(cmd);
      commandsApplied += 1;
    }

    let checkpointsChecked = 0;
    const currentHash = await this.canonicalHash();
    for (const cp of log.checkpoints) {
      const evaluated = this.evaluate(cp.tick);
      if (cp.expectedDrawOrderNodeIds) {
        const actualIds = evaluated.drawList.map((d) => d.nodeId);
        if (JSON.stringify(actualIds) !== JSON.stringify(cp.expectedDrawOrderNodeIds)) {
          throw new AppError(
            'ERR_INVALID_COMMAND',
            `Replay checkpoint mismatch at tick ${cp.tick}: expected [${cp.expectedDrawOrderNodeIds.join(',')}], got [${actualIds.join(',')}].`,
          );
        }
      }
      if (cp.expectedSnapshotHash && cp.expectedSnapshotHash !== currentHash) {
        throw new AppError(
          'ERR_INVALID_COMMAND',
          `Replay snapshot hash mismatch at tick ${cp.tick}: expected ${cp.expectedSnapshotHash}, got ${currentHash}.`,
        );
      }
      checkpointsChecked += 1;
    }

    return {
      ok: true,
      commandsApplied,
      finalRevision: this.snapshot().revision,
      finalSnapshotHash: currentHash,
      checkpointsChecked,
    };
  }
}
