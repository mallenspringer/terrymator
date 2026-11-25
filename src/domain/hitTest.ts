import type { EvaluatedScene } from './evaluator';
import { applyAffineToPoint, invertAffine, type Point2D } from './math';

export interface HitTestOptions {
  includeLocked?: boolean;
  getAlphaAt?: (blobId: string, px: number, py: number) => number;
}

export function hitTestScene(
  scene: EvaluatedScene,
  stagePt: Point2D,
  options: HitTestOptions = {},
): string | null {
  const includeLocked = options.includeLocked ?? false;

  for (let i = scene.drawList.length - 1; i >= 0; i -= 1) {
    const item = scene.drawList[i]!;
    if (item.locked && !includeLocked) {
      continue;
    }

    const inv = invertAffine(item.worldMatrix);
    const local = applyAffineToPoint(inv, stagePt);

    if (item.kind === 'tile' && item.tile) {
      const minX = -item.anchorX;
      const minY = -item.anchorY;
      const maxX = item.tile.width - item.anchorX;
      const maxY = item.tile.height - item.anchorY;
      if (local.x >= minX && local.x < maxX && local.y >= minY && local.y < maxY) {
        return item.nodeId;
      }
      continue;
    }

    const minX = -item.anchorX;
    const minY = -item.anchorY;
    const maxX = item.assetWidth - item.anchorX;
    const maxY = item.assetHeight - item.anchorY;
    if (local.x < minX || local.x >= maxX || local.y < minY || local.y >= maxY) {
      continue;
    }

    if (options.getAlphaAt) {
      const px = Math.floor(local.x + item.anchorX);
      const py = Math.floor(local.y + item.anchorY);
      if (options.getAlphaAt(item.blobId, px, py) <= 0) {
        continue;
      }
    }

    return item.nodeId;
  }

  return null;
}
