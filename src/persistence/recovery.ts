import { collectProjectBlobIds, type BlobRecord, type BlobRole } from '../application/blobStore';
import { detectImageMime } from '../assets/sourceImport';
import { AppError } from '../domain/errors';
import { evaluateScene } from '../domain/evaluator';
import { sha256Hex } from '../domain/hash';
import { canonicalStringify, validateProject, type Project, type SourceMimeType } from '../domain/schema';

export interface RecoveryGeneration {
  genId: string;
  schemaVersion: 1;
  savedAtIso: string;
  projectName: string;
  projectRevision: number;
  projectJson: string;
  blobIds: string[];
}

export interface StoredRecoveryBlob {
  id: string;
  role: BlobRole;
  mimeType: string;
  bytes: Uint8Array;
  sha256: string;
  width: number;
  height: number;
}

export interface RecoveryInfo {
  genId: string;
  savedAtIso: string;
  projectName: string;
  projectRevision: number;
}

export interface RecoveryStorage {
  getActiveGenId(): Promise<string | null>;
  setActiveGenId(genId: string | null): Promise<void>;
  getGeneration(genId: string): Promise<RecoveryGeneration | null>;
  putGeneration(gen: RecoveryGeneration): Promise<void>;
  listGenerationIds(): Promise<string[]>;
  deleteGeneration(genId: string): Promise<void>;
  getBlob(id: string): Promise<StoredRecoveryBlob | null>;
  putBlob(blob: StoredRecoveryBlob): Promise<void>;
  listBlobIds(): Promise<string[]>;
  deleteBlob(id: string): Promise<void>;
}

export interface MemoryRecoveryFaults {
  failOnPutBlob?: boolean;
  failOnPutGeneration?: boolean;
  failOnSetPointer?: boolean;
}

export class MemoryRecoveryStorage implements RecoveryStorage {
  private activeGenId: string | null = null;
  private generations = new Map<string, RecoveryGeneration>();
  private blobs = new Map<string, StoredRecoveryBlob>();
  public faults: MemoryRecoveryFaults = {};

  public async getActiveGenId(): Promise<string | null> {
    return this.activeGenId;
  }

  public async setActiveGenId(genId: string | null): Promise<void> {
    if (this.faults.failOnSetPointer) {
      throw new AppError('ERR_RECOVERY_FAILED', 'Simulated recovery pointer write failure.');
    }
    this.activeGenId = genId;
  }

  public async getGeneration(genId: string): Promise<RecoveryGeneration | null> {
    return this.generations.get(genId) ?? null;
  }

  public async putGeneration(gen: RecoveryGeneration): Promise<void> {
    if (this.faults.failOnPutGeneration) {
      throw new AppError('ERR_RECOVERY_FAILED', 'Simulated recovery generation write failure.');
    }
    this.generations.set(gen.genId, structuredClone(gen));
  }

  public async listGenerationIds(): Promise<string[]> {
    return Array.from(this.generations.keys());
  }

  public async deleteGeneration(genId: string): Promise<void> {
    this.generations.delete(genId);
  }

  public async getBlob(id: string): Promise<StoredRecoveryBlob | null> {
    return this.blobs.get(id) ?? null;
  }

  public async putBlob(blob: StoredRecoveryBlob): Promise<void> {
    if (this.faults.failOnPutBlob) {
      throw new AppError('ERR_RECOVERY_FAILED', 'Simulated recovery quota/blob write failure.');
    }
    this.blobs.set(blob.id, {
      ...blob,
      bytes: new Uint8Array(blob.bytes),
    });
  }

  public async listBlobIds(): Promise<string[]> {
    return Array.from(this.blobs.keys());
  }

  public async deleteBlob(id: string): Promise<void> {
    this.blobs.delete(id);
  }
}

const DB_NAME = 'terrymator-recovery-v1';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_GENERATIONS = 'generations';
const STORE_BLOBS = 'blobs';

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(new AppError('ERR_RECOVERY_FAILED', req.error?.message ?? 'IndexedDB request failed.'));
  });
}

function idbTxDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(new AppError('ERR_RECOVERY_FAILED', tx.error?.message ?? 'IndexedDB transaction failed.'));
    tx.onabort = () =>
      reject(
        new AppError('ERR_RECOVERY_FAILED', tx.error?.message ?? 'IndexedDB transaction aborted.'),
      );
  });
}

export class IndexedDbRecoveryStorage implements RecoveryStorage {
  private openDb(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(
        new AppError('ERR_RECOVERY_FAILED', 'IndexedDB is unavailable in this environment.'),
      );
    }
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
        if (!db.objectStoreNames.contains(STORE_GENERATIONS)) {
          db.createObjectStore(STORE_GENERATIONS, { keyPath: 'genId' });
        }
        if (!db.objectStoreNames.contains(STORE_BLOBS)) {
          db.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(new AppError('ERR_RECOVERY_FAILED', req.error?.message ?? 'Failed to open IndexedDB.'));
    });
  }

  public async getActiveGenId(): Promise<string | null> {
    const db = await this.openDb();
    try {
      const tx = db.transaction(STORE_META, 'readonly');
      const val = await idbRequest<string | undefined>(tx.objectStore(STORE_META).get('activeGenId'));
      await idbTxDone(tx);
      return val ?? null;
    } finally {
      db.close();
    }
  }

  public async setActiveGenId(genId: string | null): Promise<void> {
    const db = await this.openDb();
    try {
      const tx = db.transaction(STORE_META, 'readwrite');
      if (genId === null) {
        tx.objectStore(STORE_META).delete('activeGenId');
      } else {
        tx.objectStore(STORE_META).put(genId, 'activeGenId');
      }
      await idbTxDone(tx);
    } finally {
      db.close();
    }
  }

  public async getGeneration(genId: string): Promise<RecoveryGeneration | null> {
    const db = await this.openDb();
    try {
      const tx = db.transaction(STORE_GENERATIONS, 'readonly');
      const val = await idbRequest<RecoveryGeneration | undefined>(
        tx.objectStore(STORE_GENERATIONS).get(genId),
      );
      await idbTxDone(tx);
      return val ?? null;
    } finally {
      db.close();
    }
  }

  public async putGeneration(gen: RecoveryGeneration): Promise<void> {
    const db = await this.openDb();
    try {
      const tx = db.transaction(STORE_GENERATIONS, 'readwrite');
      tx.objectStore(STORE_GENERATIONS).put(gen);
      await idbTxDone(tx);
    } finally {
      db.close();
    }
  }

  public async listGenerationIds(): Promise<string[]> {
    const db = await this.openDb();
    try {
      const tx = db.transaction(STORE_GENERATIONS, 'readonly');
      const keys = await idbRequest<IDBValidKey[]>(tx.objectStore(STORE_GENERATIONS).getAllKeys());
      await idbTxDone(tx);
      return keys.map(String);
    } finally {
      db.close();
    }
  }

  public async deleteGeneration(genId: string): Promise<void> {
    const db = await this.openDb();
    try {
      const tx = db.transaction(STORE_GENERATIONS, 'readwrite');
      tx.objectStore(STORE_GENERATIONS).delete(genId);
      await idbTxDone(tx);
    } finally {
      db.close();
    }
  }

  public async getBlob(id: string): Promise<StoredRecoveryBlob | null> {
    const db = await this.openDb();
    try {
      const tx = db.transaction(STORE_BLOBS, 'readonly');
      const val = await idbRequest<StoredRecoveryBlob | undefined>(tx.objectStore(STORE_BLOBS).get(id));
      await idbTxDone(tx);
      return val ?? null;
    } finally {
      db.close();
    }
  }

  public async putBlob(blob: StoredRecoveryBlob): Promise<void> {
    const db = await this.openDb();
    try {
      const tx = db.transaction(STORE_BLOBS, 'readwrite');
      tx.objectStore(STORE_BLOBS).put(blob);
      await idbTxDone(tx);
    } finally {
      db.close();
    }
  }

  public async listBlobIds(): Promise<string[]> {
    const db = await this.openDb();
    try {
      const tx = db.transaction(STORE_BLOBS, 'readonly');
      const keys = await idbRequest<IDBValidKey[]>(tx.objectStore(STORE_BLOBS).getAllKeys());
      await idbTxDone(tx);
      return keys.map(String);
    } finally {
      db.close();
    }
  }

  public async deleteBlob(id: string): Promise<void> {
    const db = await this.openDb();
    try {
      const tx = db.transaction(STORE_BLOBS, 'readwrite');
      tx.objectStore(STORE_BLOBS).delete(id);
      await idbTxDone(tx);
    } finally {
      db.close();
    }
  }
}

export class RecoveryManager {
  private readonly storage: RecoveryStorage;
  private seq = 0;

  constructor(storage: RecoveryStorage) {
    this.storage = storage;
  }

  public async saveSnapshot(project: Project, blobs: Map<string, BlobRecord>): Promise<RecoveryInfo> {
    const referencedIds = Array.from(collectProjectBlobIds(project)).sort();
    for (const blobId of referencedIds) {
      const rec = blobs.get(blobId);
      if (!rec) {
        throw new AppError('ERR_MISSING_ASSET', `Cannot save recovery: missing blob "${blobId}".`);
      }
      const existing = await this.storage.getBlob(blobId);
      if (!existing || existing.sha256 !== rec.sha256) {
        await this.storage.putBlob({
          id: rec.id,
          role: rec.role,
          mimeType: rec.mimeType,
          bytes: new Uint8Array(rec.bytes),
          sha256: rec.sha256,
          width: rec.width,
          height: rec.height,
        });
      }
    }

    this.seq += 1;
    const genId = `gen-${Date.now()}-${this.seq}`;
    const savedAtIso = new Date().toISOString();
    const gen: RecoveryGeneration = {
      genId,
      schemaVersion: 1,
      savedAtIso,
      projectName: project.name,
      projectRevision: project.revision,
      projectJson: canonicalStringify(project),
      blobIds: referencedIds,
    };

    await this.storage.putGeneration(gen);
    await this.storage.setActiveGenId(genId);

    // Best-effort cleanup of superseded generations and orphaned blobs
    try {
      const allGens = await this.storage.listGenerationIds();
      for (const oldId of allGens) {
        if (oldId !== genId) {
          await this.storage.deleteGeneration(oldId);
        }
      }
      const keepBlobs = new Set(referencedIds);
      const allBlobs = await this.storage.listBlobIds();
      for (const oldBlobId of allBlobs) {
        if (!keepBlobs.has(oldBlobId)) {
          await this.storage.deleteBlob(oldBlobId);
        }
      }
    } catch {
      // Best-effort cleanup should never fail a committed recovery save
    }

    return {
      genId,
      savedAtIso,
      projectName: project.name,
      projectRevision: project.revision,
    };
  }

  public async inspect(): Promise<RecoveryInfo | null> {
    const activeId = await this.storage.getActiveGenId();
    if (!activeId) {
      return null;
    }
    const gen = await this.storage.getGeneration(activeId);
    if (!gen) {
      return null;
    }
    return {
      genId: gen.genId,
      savedAtIso: gen.savedAtIso,
      projectName: gen.projectName,
      projectRevision: gen.projectRevision,
    };
  }

  public async recover(
    decodeImage: (
      bytes: Uint8Array,
      mimeType: SourceMimeType,
    ) => Promise<{ width: number; height: number; rgba: Uint8Array }>,
  ): Promise<{ project: Project; blobs: Map<string, BlobRecord> }> {
    const activeId = await this.storage.getActiveGenId();
    if (!activeId) {
      throw new AppError('ERR_RECOVERY_FAILED', 'No recovery snapshot is available.');
    }
    const gen = await this.storage.getGeneration(activeId);
    if (!gen) {
      throw new AppError('ERR_RECOVERY_FAILED', 'Active recovery generation is missing.');
    }

    const project = validateProject(JSON.parse(gen.projectJson));
    const blobs = new Map<string, BlobRecord>();

    for (const blobId of gen.blobIds) {
      const stored = await this.storage.getBlob(blobId);
      if (!stored) {
        throw new AppError('ERR_RECOVERY_FAILED', `Recovery blob "${blobId}" is missing.`);
      }
      const actualHash = await sha256Hex(stored.bytes);
      if (actualHash !== stored.sha256) {
        throw new AppError('ERR_RECOVERY_FAILED', `Recovery blob "${blobId}" failed hash check.`);
      }
      const mimeType = detectImageMime(stored.bytes);
      if (!mimeType) {
        throw new AppError('ERR_INVALID_IMAGE', `Recovery blob "${blobId}" is not a valid image.`);
      }
      const decoded = await decodeImage(stored.bytes, mimeType);
      blobs.set(blobId, {
        id: stored.id,
        role: stored.role,
        mimeType,
        bytes: new Uint8Array(stored.bytes),
        sha256: actualHash,
        width: decoded.width,
        height: decoded.height,
        rgba: decoded.rgba,
      });
    }

    evaluateScene(project, 0);
    return { project, blobs };
  }

  public async discard(): Promise<void> {
    await this.storage.setActiveGenId(null);
    for (const genId of await this.storage.listGenerationIds()) {
      await this.storage.deleteGeneration(genId);
    }
    for (const blobId of await this.storage.listBlobIds()) {
      await this.storage.deleteBlob(blobId);
    }
  }
}
