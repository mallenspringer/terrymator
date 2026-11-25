import { applyCommand, type Command } from '../domain/commands';
import { AppError } from '../domain/errors';
import { evaluateScene, type EvaluateOptions, type EvaluatedScene } from '../domain/evaluator';
import { createId } from '../domain/ids';
import {
  canonicalStringify,
  createBlankProject,
  validateProject,
  type Project,
  type SourceMimeType,
  type SourceRecord,
} from '../domain/schema';
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
  private readonly history = new UndoHistory();
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
    this.history.clear();
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
    return this.blobStore.toMap();
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

  public undo(): Project | null {
    const prev = this.history.undo();
    if (!prev) {
      return null;
    }
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
