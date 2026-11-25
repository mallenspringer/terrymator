import { describe, expect, it } from 'vitest';
import { applyCommand, createDefaultNode } from '../../src/domain/commands';
import { AppError } from '../../src/domain/errors';
import { createBlankProject } from '../../src/domain/schema';

describe('domain/commands G1', () => {
  function setupWithAsset() {
    let p = createBlankProject({ id: 'p1', width: 640, height: 360 });
    p = applyCommand(p, {
      type: 'ADD_SOURCE',
      source: {
        id: 'src-1',
        name: 'sheet.png',
        blobId: 'blob-src-1',
        sha256: 'a'.repeat(64),
        mimeType: 'image/png',
        width: 100,
        height: 80,
      },
    });
    p = applyCommand(p, {
      type: 'CREATE_CUTOUT_ASSET',
      assetId: 'asset-1',
      sourceId: 'src-1',
      name: 'Head',
    });
    p = applyCommand(p, {
      type: 'ADD_NODE',
      node: createDefaultNode({
        id: 'node-1',
        name: 'Head 1',
        kind: 'sprite',
        assetId: 'asset-1',
        drawOrder: 1,
      }),
    });
    return p;
  }

  it('duplicates node sharing assetId, makes unique reusing sourceId, and blocks deleting referenced asset', () => {
    let p = setupWithAsset();
    p = applyCommand(p, {
      type: 'DUPLICATE_NODE',
      sourceNodeId: 'node-1',
      newNodeId: 'node-2',
    });
    expect(p.nodes['node-2']!.assetId).toBe('asset-1');

    // Cannot delete asset-1 while nodes reference it
    expect(() => applyCommand(p, { type: 'DELETE_ASSET', assetId: 'asset-1' })).toThrow(AppError);
    try {
      applyCommand(p, { type: 'DELETE_ASSET', assetId: 'asset-1' });
    } catch (e) {
      expect((e as AppError).code).toBe('ERR_ASSET_IN_USE');
    }

    // Make node-2 unique -> creates asset-2 sharing src-1
    p = applyCommand(p, {
      type: 'MAKE_ASSET_UNIQUE',
      nodeId: 'node-2',
      newAssetId: 'asset-2',
    });
    expect(p.nodes['node-2']!.assetId).toBe('asset-2');
    const a2 = p.assets['asset-2']!;
    expect(a2.kind).toBe('cutout');
    if (a2.kind === 'cutout') {
      expect(a2.sourceId).toBe('src-1');
    }

    // Delete node-2, then asset-2 can be deleted cleanly
    p = applyCommand(p, { type: 'DELETE_NODE', nodeId: 'node-2' });
    p = applyCommand(p, { type: 'DELETE_ASSET', assetId: 'asset-2' });
    expect(p.assets['asset-2']).toBeUndefined();
  });

  it('rejects parent cycles in SET_NODE_PARENT', () => {
    let p = setupWithAsset();
    p = applyCommand(p, {
      type: 'ADD_NODE',
      node: createDefaultNode({
        id: 'grp-1',
        name: 'Group',
        kind: 'group',
      }),
    });
    p = applyCommand(p, { type: 'SET_NODE_PARENT', nodeId: 'node-1', parentId: 'grp-1' });
    expect(() =>
      applyCommand(p, { type: 'SET_NODE_PARENT', nodeId: 'grp-1', parentId: 'node-1' }),
    ).toThrowError(/cycle/i);
  });
});
