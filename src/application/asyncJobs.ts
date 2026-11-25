import type { Project } from '../domain/schema';

export interface AsyncJobToken {
  scopeKey: string;
  jobId: number;
  projectId: string;
  assetId: string;
  assetRevision: number;
}

/**
 * Guards asynchronous image/mask/material processing against stale results
 * after undo, redo, project close/switch, or a newer edit on the same asset.
 */
export class AsyncJobGuard {
  private seq = 0;
  private readonly latestByScope = new Map<string, number>();

  public begin(scopeKey: string, project: Project, assetId: string): AsyncJobToken {
    const asset = project.assets[assetId];
    this.seq += 1;
    this.latestByScope.set(scopeKey, this.seq);
    return {
      scopeKey,
      jobId: this.seq,
      projectId: project.id,
      assetId,
      assetRevision: asset ? asset.revision : -1,
    };
  }

  public isCurrent(token: AsyncJobToken, currentProject: Project | null): boolean {
    if (!currentProject) return false;
    if (this.latestByScope.get(token.scopeKey) !== token.jobId) return false;
    if (currentProject.id !== token.projectId) return false;
    const asset = currentProject.assets[token.assetId];
    if (!asset || asset.revision !== token.assetRevision) return false;
    return true;
  }

  public invalidateAll(): void {
    this.seq += 1;
    this.latestByScope.clear();
  }

  public async runGuarded<T>(
    scopeKey: string,
    getProject: () => Project | null,
    assetId: string,
    workFn: () => Promise<T>,
    onCommit: (result: T) => void,
  ): Promise<{ committed: boolean; stale: boolean }> {
    const project = getProject();
    if (!project) {
      return { committed: false, stale: true };
    }
    const token = this.begin(scopeKey, project, assetId);
    const result = await workFn();
    if (!this.isCurrent(token, getProject())) {
      return { committed: false, stale: true };
    }
    onCommit(result);
    return { committed: true, stale: false };
  }
}
