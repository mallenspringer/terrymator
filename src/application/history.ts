import type { Project } from '../domain/schema';
import { collectProjectBlobIds } from './blobStore';

export interface HistoryEntry {
  label: string;
  before: Project;
  after: Project;
  estimatedBytes: number;
  coalesceKey?: string;
}

export interface HistoryStats {
  undoCount: number;
  redoCount: number;
  totalBytes: number;
  evictedCount: number;
  maxEntries: number;
  maxBytes: number;
}

export const DEFAULT_MAX_HISTORY_ENTRIES = 100;
export const DEFAULT_MAX_HISTORY_BYTES = 128 * 1024 * 1024;

function estimateProjectBytes(project: Project): number {
  return JSON.stringify(project).length * 2;
}

export class UndoHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private totalBytes = 0;
  private evictedCount = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(options?: { maxEntries?: number; maxBytes?: number }) {
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_HISTORY_ENTRIES;
    this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_HISTORY_BYTES;
  }

  public record(
    label: string,
    before: Project,
    after: Project,
    coalesceKey?: string,
  ): void {
    this.redoStack = [];
    const top = this.undoStack[this.undoStack.length - 1];
    const nextBytes = estimateProjectBytes(after);

    if (coalesceKey && top && top.coalesceKey === coalesceKey) {
      this.totalBytes -= top.estimatedBytes;
      top.after = structuredClone(after);
      top.estimatedBytes = nextBytes;
      top.label = label;
      this.totalBytes += nextBytes;
    } else {
      const entry: HistoryEntry = {
        label,
        before: structuredClone(before),
        after: structuredClone(after),
        estimatedBytes: nextBytes,
        ...(coalesceKey ? { coalesceKey } : {}),
      };
      this.undoStack.push(entry);
      this.totalBytes += nextBytes;
    }

    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    while (
      this.undoStack.length > 1 &&
      (this.undoStack.length > this.maxEntries || this.totalBytes > this.maxBytes)
    ) {
      const oldest = this.undoStack.shift();
      if (oldest) {
        this.totalBytes = Math.max(0, this.totalBytes - oldest.estimatedBytes);
        this.evictedCount += 1;
      }
    }
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public undo(): Project | null {
    const entry = this.undoStack.pop();
    if (!entry) {
      return null;
    }
    this.totalBytes = Math.max(0, this.totalBytes - entry.estimatedBytes);
    this.redoStack.push(entry);
    return structuredClone(entry.before);
  }

  public redo(): Project | null {
    const entry = this.redoStack.pop();
    if (!entry) {
      return null;
    }
    this.undoStack.push(entry);
    this.totalBytes += entry.estimatedBytes;
    this.evictIfNeeded();
    return structuredClone(entry.after);
  }

  public collectReferencedBlobIds(): Set<string> {
    const ids = new Set<string>();
    for (const entry of this.undoStack) {
      for (const id of collectProjectBlobIds(entry.before)) ids.add(id);
      for (const id of collectProjectBlobIds(entry.after)) ids.add(id);
    }
    for (const entry of this.redoStack) {
      for (const id of collectProjectBlobIds(entry.before)) ids.add(id);
      for (const id of collectProjectBlobIds(entry.after)) ids.add(id);
    }
    return ids;
  }

  public stats(): HistoryStats {
    return {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      totalBytes: this.totalBytes,
      evictedCount: this.evictedCount,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
    };
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.totalBytes = 0;
  }
}
