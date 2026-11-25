import type { Point2D } from '../domain/math';
import { encodePngRgba } from './pngCodec';

export type SelectionCombineMode = 'replace' | 'add' | 'subtract';
export type SelectionMaskAction = 'erase' | 'keep' | 'restore';

export interface EditRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function colorDistanceSq(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

export function matchesColor(
  rgba: Uint8Array,
  pixelIndex: number,
  seedR: number,
  seedG: number,
  seedB: number,
  seedA: number,
  tolerance: number,
): boolean {
  const base = pixelIndex * 4;
  const a = rgba[base + 3]!;
  if (seedA === 0) {
    return a <= tolerance;
  }
  if (Math.abs(a - seedA) > tolerance) {
    return false;
  }
  const distSq = colorDistanceSq(rgba[base]!, rgba[base + 1]!, rgba[base + 2]!, seedR, seedG, seedB);
  return distSq <= 3 * tolerance * tolerance;
}

/**
 * Iterative 4-connected flood fill (zero recursion, safe for large images).
 */
export function magicWandSelect(
  rgba: Uint8Array,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  tolerance: number,
): Uint8Array {
  const selection = new Uint8Array(width * height);
  const sx = Math.floor(seedX);
  const sy = Math.floor(seedY);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
    return selection;
  }

  const seedIdx = sy * width + sx;
  const base = seedIdx * 4;
  const seedR = rgba[base]!;
  const seedG = rgba[base + 1]!;
  const seedB = rgba[base + 2]!;
  const seedA = rgba[base + 3]!;

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  queue[tail++] = seedIdx;
  visited[seedIdx] = 1;

  while (head < tail) {
    const idx = queue[head++]!;
    if (!matchesColor(rgba, idx, seedR, seedG, seedB, seedA, tolerance)) {
      continue;
    }
    selection[idx] = 255;

    const x = idx % width;
    const y = (idx - x) / width;

    if (x > 0) {
      const left = idx - 1;
      if (!visited[left]) {
        visited[left] = 1;
        queue[tail++] = left;
      }
    }
    if (x + 1 < width) {
      const right = idx + 1;
      if (!visited[right]) {
        visited[right] = 1;
        queue[tail++] = right;
      }
    }
    if (y > 0) {
      const up = idx - width;
      if (!visited[up]) {
        visited[up] = 1;
        queue[tail++] = up;
      }
    }
    if (y + 1 < height) {
      const down = idx + width;
      if (!visited[down]) {
        visited[down] = 1;
        queue[tail++] = down;
      }
    }
  }

  return selection;
}

export function colorSelect(
  rgba: Uint8Array,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  tolerance: number,
): Uint8Array {
  const total = width * height;
  const selection = new Uint8Array(total);
  const sx = Math.floor(seedX);
  const sy = Math.floor(seedY);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
    return selection;
  }

  const seedIdx = sy * width + sx;
  const base = seedIdx * 4;
  const seedR = rgba[base]!;
  const seedG = rgba[base + 1]!;
  const seedB = rgba[base + 2]!;
  const seedA = rgba[base + 3]!;

  for (let i = 0; i < total; i += 1) {
    if (matchesColor(rgba, i, seedR, seedG, seedB, seedA, tolerance)) {
      selection[i] = 255;
    }
  }
  return selection;
}

/**
 * Deterministic even-odd fill rule polygon rasterization at pixel centers (x+0.5, y+0.5).
 */
export function rasterizeLasso(width: number, height: number, points: Point2D[]): Uint8Array {
  const selection = new Uint8Array(width * height);
  if (points.length < 3) {
    return selection;
  }

  let minY = height;
  let maxY = 0;
  for (const p of points) {
    minY = Math.min(minY, Math.max(0, Math.floor(p.y)));
    maxY = Math.max(maxY, Math.min(height - 1, Math.ceil(p.y)));
  }

  const n = points.length;
  for (let y = minY; y <= maxY; y += 1) {
    const py = y + 0.5;
    const intersections: number[] = [];

    for (let i = 0; i < n; i += 1) {
      const a = points[i]!;
      const b = points[(i + 1) % n]!;
      if ((a.y <= py && b.y > py) || (b.y <= py && a.y > py)) {
        const t = (py - a.y) / (b.y - a.y);
        intersections.push(a.x + t * (b.x - a.x));
      }
    }

    intersections.sort((x1, x2) => x1 - x2);
    for (let k = 0; k + 1 < intersections.length; k += 2) {
      const xStart = Math.max(0, Math.ceil(intersections[k]! - 0.5));
      const xEnd = Math.min(width - 1, Math.floor(intersections[k + 1]! - 0.5));
      for (let x = xStart; x <= xEnd; x += 1) {
        selection[y * width + x] = 255;
      }
    }
  }

  return selection;
}

export function combineSelection(
  current: Uint8Array,
  incoming: Uint8Array,
  mode: SelectionCombineMode,
): Uint8Array {
  if (mode === 'replace') {
    return new Uint8Array(incoming);
  }
  const out = new Uint8Array(current.length);
  if (mode === 'add') {
    for (let i = 0; i < out.length; i += 1) {
      out[i] = Math.max(current[i]!, incoming[i]!);
    }
  } else {
    for (let i = 0; i < out.length; i += 1) {
      out[i] = Math.max(0, current[i]! - incoming[i]!);
    }
  }
  return out;
}

export function applySelectionToMask(
  mask: Uint8Array,
  selection: Uint8Array,
  action: SelectionMaskAction,
): Uint8Array {
  const out = new Uint8Array(mask);
  for (let i = 0; i < out.length; i += 1) {
    const sel = selection[i]!;
    if (action === 'erase') {
      if (sel > 0) {
        out[i] = Math.round(out[i]! * (1 - sel / 255));
      }
    } else if (action === 'keep') {
      out[i] = Math.round(out[i]! * (sel / 255));
    } else if (sel > 0) {
      out[i] = Math.min(255, Math.max(out[i]!, sel));
    }
  }
  return out;
}

function buildBrushCoverageMap(
  width: number,
  height: number,
  points: Point2D[],
  radius: number,
  hardness: number,
): Float32Array {
  const cov = new Float32Array(width * height);
  if (points.length === 0 || radius <= 0) {
    return cov;
  }

  const r = Math.max(0.5, radius);
  const h = Math.max(0, Math.min(1, hardness));
  const inner = r * h;
  const rSq = r * r;
  const stepDist = Math.max(0.5, r * 0.25);

  const stampAt = (cx: number, cy: number) => {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(height - 1, Math.ceil(cy + r));

    for (let y = y0; y <= y1; y += 1) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x += 1) {
        const dx = x + 0.5 - cx;
        const dSq = dx * dx + dy * dy;
        if (dSq > rSq) continue;
        const d = Math.sqrt(dSq);
        let c = 1;
        if (d > inner && r > inner) {
          const t = (d - inner) / (r - inner);
          c = 1 - t * t * (3 - 2 * t);
        }
        const idx = y * width + x;
        if (c > cov[idx]!) {
          cov[idx] = c;
        }
      }
    }
  };

  stampAt(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i += 1) {
    const p0 = points[i - 1]!;
    const p1 = points[i]!;
    const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const steps = Math.max(1, Math.ceil(segLen / stepDist));
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      stampAt(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t);
    }
  }

  return cov;
}

export function applyAlphaBrushStroke(
  mask: Uint8Array,
  width: number,
  height: number,
  points: Point2D[],
  options: { mode: 'restore' | 'erase'; radius: number; hardness: number; opacity: number },
): Uint8Array {
  const out = new Uint8Array(mask);
  const cov = buildBrushCoverageMap(width, height, points, options.radius, options.hardness);
  const opacity = Math.max(0, Math.min(1, options.opacity));

  for (let i = 0; i < out.length; i += 1) {
    const c = cov[i]! * opacity;
    if (c <= 0) continue;
    const m = out[i]!;
    if (options.mode === 'restore') {
      out[i] = Math.min(255, Math.round(m + (255 - m) * c));
    } else {
      out[i] = Math.max(0, Math.round(m * (1 - c)));
    }
  }
  return out;
}

export function growMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return new Uint8Array(mask);
  const out = new Uint8Array(width * height);
  const rSq = r * r;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let maxVal = 0;
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(height - 1, y + r);
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width - 1, x + r);
      for (let ny = y0; ny <= y1; ny += 1) {
        const dy = ny - y;
        for (let nx = x0; nx <= x1; nx += 1) {
          const dx = nx - x;
          if (dx * dx + dy * dy <= rSq) {
            const v = mask[ny * width + nx]!;
            if (v > maxVal) maxVal = v;
          }
        }
      }
      out[y * width + x] = maxVal;
    }
  }
  return out;
}

export function shrinkMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return new Uint8Array(mask);
  const out = new Uint8Array(width * height);
  const rSq = r * r;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let minVal = 255;
      for (let dy = -r; dy <= r; dy += 1) {
        const ny = y + dy;
        for (let dx = -r; dx <= r; dx += 1) {
          if (dx * dx + dy * dy > rSq) continue;
          const nx = x + dx;
          const v =
            nx < 0 || ny < 0 || nx >= width || ny >= height ? 0 : mask[ny * width + nx]!;
          if (v < minVal) minVal = v;
          if (minVal === 0) break;
        }
        if (minVal === 0) break;
      }
      out[y * width + x] = minVal;
    }
  }
  return out;
}

export function featherMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return new Uint8Array(mask);

  const sigma = Math.max(0.5, r / 2);
  const kernel = new Float32Array(r * 2 + 1);
  let kSum = 0;
  for (let i = -r; i <= r; i += 1) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + r] = w;
    kSum += w;
  }
  for (let i = 0; i < kernel.length; i += 1) {
    kernel[i] = kernel[i]! / kSum;
  }

  const tmp = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let acc = 0;
      for (let k = -r; k <= r; k += 1) {
        const nx = x + k;
        if (nx >= 0 && nx < width) {
          acc += mask[y * width + nx]! * kernel[k + r]!;
        }
      }
      tmp[y * width + x] = acc;
    }
  }

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let acc = 0;
      for (let k = -r; k <= r; k += 1) {
        const ny = y + k;
        if (ny >= 0 && ny < height) {
          acc += tmp[ny * width + x]! * kernel[k + r]!;
        }
      }
      out[y * width + x] = Math.max(0, Math.min(255, Math.round(acc)));
    }
  }
  return out;
}

export function blendPixelOver(
  dst: Uint8Array,
  dstByteIdx: number,
  sr: number,
  sg: number,
  sb: number,
  saByte: number,
): void {
  if (saByte <= 0) return;
  const sa = saByte / 255;
  const da = dst[dstByteIdx + 3]! / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) {
    dst[dstByteIdx] = 0;
    dst[dstByteIdx + 1] = 0;
    dst[dstByteIdx + 2] = 0;
    dst[dstByteIdx + 3] = 0;
    return;
  }
  const inv = 1 - sa;
  const pr = sr * sa + dst[dstByteIdx]! * da * inv;
  const pg = sg * sa + dst[dstByteIdx + 1]! * da * inv;
  const pb = sb * sa + dst[dstByteIdx + 2]! * da * inv;

  dst[dstByteIdx] = Math.min(255, Math.max(0, Math.round(pr / outA)));
  dst[dstByteIdx + 1] = Math.min(255, Math.max(0, Math.round(pg / outA)));
  dst[dstByteIdx + 2] = Math.min(255, Math.max(0, Math.round(pb / outA)));
  dst[dstByteIdx + 3] = Math.min(255, Math.max(0, Math.round(outA * 255)));
}

/**
 * Samples from an immutable pre-stroke snapshot (`preStrokeRgba`) so strokes
 * never recursively smear their own newly painted pixels.
 */
export function applyCloneStampStroke(
  preStrokeRgba: Uint8Array,
  overlayRgba: Uint8Array,
  width: number,
  height: number,
  points: Point2D[],
  options: {
    offsetX: number;
    offsetY: number;
    radius: number;
    hardness: number;
    opacity: number;
  },
): Uint8Array {
  const out = new Uint8Array(overlayRgba);
  const cov = buildBrushCoverageMap(width, height, points, options.radius, options.hardness);
  const opacity = Math.max(0, Math.min(1, options.opacity));
  const ox = Math.round(options.offsetX);
  const oy = Math.round(options.offsetY);

  for (let y = 0; y < height; y += 1) {
    const sy = y + oy;
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const c = cov[idx]! * opacity;
      if (c <= 0) continue;
      const sx = x + ox;
      if (sx < 0 || sx >= width) continue;

      const sByte = (sy * width + sx) * 4;
      const srcA = preStrokeRgba[sByte + 3]!;
      if (srcA === 0) continue;

      const effA = Math.round(srcA * c);
      blendPixelOver(
        out,
        idx * 4,
        preStrokeRgba[sByte]!,
        preStrokeRgba[sByte + 1]!,
        preStrokeRgba[sByte + 2]!,
        effA,
      );
    }
  }
  return out;
}

export function applyColorBrushStroke(
  overlayRgba: Uint8Array,
  width: number,
  height: number,
  points: Point2D[],
  options: {
    color: [number, number, number];
    radius: number;
    hardness: number;
    opacity: number;
  },
): Uint8Array {
  const out = new Uint8Array(overlayRgba);
  const cov = buildBrushCoverageMap(width, height, points, options.radius, options.hardness);
  const opacity = Math.max(0, Math.min(1, options.opacity));

  for (let i = 0; i < width * height; i += 1) {
    const c = cov[i]! * opacity;
    if (c <= 0) continue;
    const effA = Math.round(255 * c);
    blendPixelOver(out, i * 4, options.color[0], options.color[1], options.color[2], effA);
  }
  return out;
}

export function extendCutoutBuffers(
  editRect: EditRect,
  mask: Uint8Array | null,
  overlay: Uint8Array | null,
  pad: { left: number; top: number; right: number; bottom: number },
): {
  editRect: EditRect;
  mask: Uint8Array;
  overlay: Uint8Array;
  deltaAnchorX: number;
  deltaAnchorY: number;
} {
  const newW = editRect.width + pad.left + pad.right;
  const newH = editRect.height + pad.top + pad.bottom;
  const newMask = new Uint8Array(newW * newH);
  const newOverlay = new Uint8Array(newW * newH * 4);

  for (let y = 0; y < editRect.height; y += 1) {
    const dstY = y + pad.top;
    for (let x = 0; x < editRect.width; x += 1) {
      const dstX = x + pad.left;
      const sIdx = y * editRect.width + x;
      const dIdx = dstY * newW + dstX;
      newMask[dIdx] = mask ? mask[sIdx]! : 255;
      if (overlay) {
        const sb = sIdx * 4;
        const db = dIdx * 4;
        newOverlay[db] = overlay[sb]!;
        newOverlay[db + 1] = overlay[sb + 1]!;
        newOverlay[db + 2] = overlay[sb + 2]!;
        newOverlay[db + 3] = overlay[sb + 3]!;
      }
    }
  }

  return {
    editRect: {
      x: editRect.x - pad.left,
      y: editRect.y - pad.top,
      width: newW,
      height: newH,
    },
    mask: newMask,
    overlay: newOverlay,
    deltaAnchorX: pad.left,
    deltaAnchorY: pad.top,
  };
}

/**
 * Composites source + reconstruction overlay, then multiplies by 8-bit mask alpha.
 */
export function compositeCutoutAsset(
  sourceRgba: Uint8Array,
  srcW: number,
  srcH: number,
  editRect: EditRect,
  mask: Uint8Array | null,
  overlay: Uint8Array | null,
  applyMask = true,
): Uint8Array {
  const out = new Uint8Array(editRect.width * editRect.height * 4);
  for (let ey = 0; ey < editRect.height; ey += 1) {
    const sy = editRect.y + ey;
    for (let ex = 0; ex < editRect.width; ex += 1) {
      const sx = editRect.x + ex;
      const idx = ey * editRect.width + ex;
      const outByte = idx * 4;

      if (sx >= 0 && sy >= 0 && sx < srcW && sy < srcH) {
        const sByte = (sy * srcW + sx) * 4;
        out[outByte] = sourceRgba[sByte]!;
        out[outByte + 1] = sourceRgba[sByte + 1]!;
        out[outByte + 2] = sourceRgba[sByte + 2]!;
        out[outByte + 3] = sourceRgba[sByte + 3]!;
      }

      if (overlay) {
        const oa = overlay[outByte + 3]!;
        if (oa > 0) {
          blendPixelOver(
            out,
            outByte,
            overlay[outByte]!,
            overlay[outByte + 1]!,
            overlay[outByte + 2]!,
            oa,
          );
        }
      }

      if (applyMask && mask) {
        const m = mask[idx]!;
        const finalA = Math.round((out[outByte + 3]! * m) / 255);
        if (finalA === 0) {
          out[outByte] = 0;
          out[outByte + 1] = 0;
          out[outByte + 2] = 0;
          out[outByte + 3] = 0;
        } else {
          out[outByte + 3] = finalA;
        }
      }
    }
  }
  return out;
}

export function maskToPngBytes(mask: Uint8Array, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const b = i * 4;
    rgba[b] = 255;
    rgba[b + 1] = 255;
    rgba[b + 2] = 255;
    rgba[b + 3] = mask[i]!;
  }
  return encodePngRgba(rgba, width, height);
}

export function extractMaskFromRgba(rgba: Uint8Array): Uint8Array {
  const mask = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = rgba[i * 4 + 3]!;
  }
  return mask;
}
