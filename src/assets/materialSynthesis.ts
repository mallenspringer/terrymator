import type { MaterialRecipe } from '../domain/schema';
import { positiveMod } from '../domain/time';
import { featherMask } from './cutting';

function hash2D(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function valueNoise2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const v00 = hash2D(ix, iy, seed);
  const v10 = hash2D(ix + 1, iy, seed);
  const v01 = hash2D(ix, iy + 1, seed);
  const v11 = hash2D(ix + 1, iy + 1, seed);

  const nx0 = v00 + (v10 - v00) * ux;
  const nx1 = v01 + (v11 - v01) * ux;
  return nx0 + (nx1 - nx0) * uy;
}

function fbm2D(x: number, y: number, seed: number, octaves = 3): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * valueNoise2D(x * freq, y * freq, seed + i * 97);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function pointInPolygon(px: number, py: number, pts: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i]!.x;
    const yi = pts[i]!.y;
    const xj = pts[j]!.x;
    const yj = pts[j]!.y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInShape(
  px: number,
  py: number,
  shape: MaterialRecipe['shapes'][number],
): boolean {
  if (shape.kind === 'rect') {
    return (
      px >= shape.x &&
      px <= shape.x + shape.width &&
      py >= shape.y &&
      py <= shape.y + shape.height
    );
  }
  if (shape.kind === 'ellipse') {
    const rx = Math.max(0.5, shape.width / 2);
    const ry = Math.max(0.5, shape.height / 2);
    const cx = shape.x + rx;
    const cy = shape.y + ry;
    const dx = (px - cx) / rx;
    const dy = (py - cy) / ry;
    return dx * dx + dy * dy <= 1;
  }
  return shape.points.length >= 3 && pointInPolygon(px, py, shape.points);
}

export function evaluateShapesMask(recipe: MaterialRecipe): Uint8Array {
  const { width, height, shapes, seed, edgeIrregularity } = recipe;
  const mask = new Uint8Array(width * height);
  if (shapes.length === 0) {
    return mask;
  }

  const subOffsets = [0.25, 0.75];
  for (let sIdx = 0; sIdx < shapes.length; sIdx += 1) {
    const shape = shapes[sIdx]!;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let hits = 0;
        for (const oy of subOffsets) {
          for (const ox of subOffsets) {
            let sx = x + ox;
            let sy = y + oy;
            if (edgeIrregularity > 0) {
              const jitter = (valueNoise2D(sx * 0.18, sy * 0.18, seed + 503) - 0.5) * edgeIrregularity * 6;
              const jitterY =
                (valueNoise2D(sx * 0.18, sy * 0.18, seed + 907) - 0.5) * edgeIrregularity * 6;
              sx += jitter;
              sy += jitterY;
            }
            if (isPointInShape(sx, sy, shape)) {
              hits += 1;
            }
          }
        }
        const cov = Math.round((hits / 4) * 255);
        const idx = y * width + x;
        if (sIdx === 0) {
          mask[idx] = shape.op === 'subtract' ? 0 : cov;
        } else if (shape.op === 'union') {
          mask[idx] = Math.max(mask[idx]!, cov);
        } else if (shape.op === 'intersect') {
          mask[idx] = Math.min(mask[idx]!, cov);
        } else {
          mask[idx] = Math.max(0, mask[idx]! - cov);
        }
      }
    }
  }

  return mask;
}

function samplePresetDelta(
  preset: MaterialRecipe['preset'],
  tx: number,
  ty: number,
  seed: number,
  variation: number,
): number {
  const varScale = 0.5 + variation;
  switch (preset) {
    case 'construction-paper': {
      const fine = hash2D(Math.floor(tx), Math.floor(ty), seed) - 0.5;
      const coarse = fbm2D(tx * 0.06, ty * 0.06, seed + 17, 2) - 0.5;
      return (fine * 0.55 + coarse * 0.45) * varScale;
    }
    case 'kraft-cardboard': {
      const rib = Math.sin(ty * 0.35) * 0.25;
      const fiber = fbm2D(tx * 0.12, ty * 0.04, seed + 31, 3) - 0.5;
      return (rib * 0.4 + fiber * 0.7) * varScale;
    }
    case 'felt': {
      const mottle = fbm2D(tx * 0.08, ty * 0.08, seed + 53, 3) - 0.5;
      const fuzz = fbm2D(tx * 0.35, ty * 0.15, seed + 79, 2) - 0.5;
      return (mottle * 0.6 + fuzz * 0.5) * varScale;
    }
    case 'aged-paper': {
      const blotch = fbm2D(tx * 0.03, ty * 0.03, seed + 101, 3) - 0.5;
      const speck = hash2D(Math.floor(tx * 0.8), Math.floor(ty * 0.8), seed + 131) > 0.97 ? -0.4 : 0;
      return (blotch * 0.8 + speck) * varScale;
    }
    case 'fabric': {
      const warp = Math.sin(tx * 0.9) * 0.25;
      const weft = Math.sin(ty * 0.9) * 0.25;
      const noise = (hash2D(Math.floor(tx), Math.floor(ty), seed + 163) - 0.5) * 0.2;
      return (warp + weft + noise) * varScale;
    }
    case 'halftone': {
      const cell = 6;
      const gx = positiveMod(tx, cell) / cell - 0.5;
      const gy = positiveMod(ty, cell) / cell - 0.5;
      const dist = Math.hypot(gx, gy);
      const dot = dist < 0.28 ? -0.45 : 0.15;
      return dot * varScale;
    }
  }
}

function samplePatternCoverage(
  pattern: MaterialRecipe['pattern'],
  tx: number,
  ty: number,
): number {
  if (pattern.kind === 'none' || pattern.opacity <= 0) {
    return 0;
  }
  const s = Math.max(2, pattern.scale);
  const mx = positiveMod(tx, s) / s;
  const my = positiveMod(ty, s) / s;

  let hit = false;
  switch (pattern.kind) {
    case 'stripes':
      hit = mx < 0.45;
      break;
    case 'dots':
      hit = Math.hypot(mx - 0.5, my - 0.5) < 0.26;
      break;
    case 'grid':
      hit = mx < 0.18 || my < 0.18;
      break;
    case 'checkerboard':
      hit = (mx < 0.5) !== (my < 0.5);
      break;
    case 'crosshatch': {
      const d1 = positiveMod(tx + ty, s) / s;
      const d2 = positiveMod(tx - ty, s) / s;
      hit = d1 < 0.16 || d2 < 0.16;
      break;
    }
  }
  return hit ? pattern.opacity : 0;
}

export function synthesizeMaterial(
  recipe: MaterialRecipe,
  sourceImage?: { width: number; height: number; rgba: Uint8Array },
): { width: number; height: number; rgba: Uint8Array } {
  const { width, height } = recipe;
  const mask = evaluateShapesMask(recipe);
  const feathered = recipe.edgeDarkening > 0 ? featherMask(mask, width, height, 3) : null;

  const [baseR, baseG, baseB] = hexToRgb(recipe.baseColor);
  const [patR, patG, patB] = hexToRgb(recipe.pattern.color);
  const rad = (recipe.textureRotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const texScale = Math.max(0.1, recipe.textureScale);

  const rgba = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const a = mask[idx]!;
      const bIdx = idx * 4;
      if (a === 0) {
        rgba[bIdx] = 0;
        rgba[bIdx + 1] = 0;
        rgba[bIdx + 2] = 0;
        rgba[bIdx + 3] = 0;
        continue;
      }

      let r = baseR;
      let g = baseG;
      let b = baseB;

      if (sourceImage && sourceImage.width > 0 && sourceImage.height > 0) {
        const sx = Math.floor(positiveMod(x, sourceImage.width));
        const sy = Math.floor(positiveMod(y, sourceImage.height));
        const sb = (sy * sourceImage.width + sx) * 4;
        const sa = sourceImage.rgba[sb + 3]! / 255;
        r = Math.round(sourceImage.rgba[sb]! * sa + baseR * (1 - sa));
        g = Math.round(sourceImage.rgba[sb + 1]! * sa + baseG * (1 - sa));
        b = Math.round(sourceImage.rgba[sb + 2]! * sa + baseB * (1 - sa));
      }

      const tx = (x * cos - y * sin) / texScale;
      const ty = (x * sin + y * cos) / texScale;

      const patCov = samplePatternCoverage(recipe.pattern, tx, ty);
      if (patCov > 0) {
        r = Math.round(r * (1 - patCov) + patR * patCov);
        g = Math.round(g * (1 - patCov) + patG * patCov);
        b = Math.round(b * (1 - patCov) + patB * patCov);
      }

      const grainDelta =
        samplePresetDelta(recipe.preset, tx, ty, recipe.seed, recipe.variation) *
        recipe.grainIntensity *
        90;

      r += grainDelta;
      g += grainDelta;
      b += grainDelta;

      if (feathered && recipe.edgeDarkening > 0) {
        const edgeFactor = Math.max(0, Math.min(1, (255 - feathered[idx]!) / 140));
        const darkMul = 1 - edgeFactor * recipe.edgeDarkening * 0.45;
        r *= darkMul;
        g *= darkMul;
        b *= darkMul;
      }

      rgba[bIdx] = Math.max(0, Math.min(255, Math.round(r)));
      rgba[bIdx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      rgba[bIdx + 2] = Math.max(0, Math.min(255, Math.round(b)));
      rgba[bIdx + 3] = a;
    }
  }

  return { width, height, rgba };
}
