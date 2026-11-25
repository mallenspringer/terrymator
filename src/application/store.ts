import { applyCommand, type Command } from '../domain/commands';
import { AppError } from '../domain/errors';
import { evaluateScene, type EvaluateOptions, type EvaluatedScene } from '../domain/evaluator';
import { canonicalStringify, validateProject, type Project } from '../domain/schema';
import type { BlobRecord } from '../persistence/zip';

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

export class ProjectStore {
  private project: Project | null = null;
  private blobs = new Map<string, BlobRecord>();

  public load(project: Project, blobs: Map<string, BlobRecord>): void {
    const validated = validateProject(project);
    for (const asset of Object.values(validated.assets)) {
      if (!blobs.has(asset.blobId)) {
        throw new AppError('ERR_MISSING_ASSET', `Missing blob "${asset.blobId}" for asset "${asset.id}".`);
      }
    }
    this.project = structuredClone(validated);
    this.blobs = new Map(blobs);
  }

  public snapshot(): Project {
    if (!this.project) {
      throw new AppError('ERR_RENDER_NOT_READY', 'No project loaded in store.');
    }
    return structuredClone(this.project);
  }

  public getBlobs(): Map<string, BlobRecord> {
    return this.blobs;
  }

  public dispatch(command: Command): Project {
    if (!this.project) {
      throw new AppError('ERR_RENDER_NOT_READY', 'No project loaded in store.');
    }
    const next = applyCommand(this.project, command);
    // Validate that the resulting scene still evaluates cleanly at tick 0 before committing
    evaluateScene(next, 0);
    this.project = next;
    return this.snapshot();
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
