import { AppError } from './errors';

export interface Affine2D {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export interface Transform {
  x: number;
  y: number;
  angle: number;
  sx: number;
  sy: number;
  pivotX: number;
  pivotY: number;
}

export interface Point2D {
  x: number;
  y: number;
}

const MIN_SCALE = 1e-6;
const MIN_DET = 1e-9;

export const IDENTITY_AFFINE: Affine2D = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
};

export function validateTransform(t: Transform): void {
  const nums = [t.x, t.y, t.angle, t.sx, t.sy, t.pivotX, t.pivotY];
  for (const n of nums) {
    if (!Number.isFinite(n)) {
      throw new AppError('ERR_SINGULAR_TRANSFORM', 'Transform contains non-finite values.');
    }
  }
  if (Math.abs(t.sx) < MIN_SCALE || Math.abs(t.sy) < MIN_SCALE) {
    throw new AppError('ERR_SINGULAR_TRANSFORM', 'Transform scale cannot be zero or near-zero.', {
      sx: t.sx,
      sy: t.sy,
    });
  }
}

/**
 * Coordinates: +x right, +y down, angle positive clockwise (degrees).
 * M = T(x, y) * R(angle) * S(sx, sy) * T(-pivotX, -pivotY)
 */
export function composeLocalMatrix(t: Transform): Affine2D {
  validateTransform(t);
  const rad = (t.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const a = cos * t.sx;
  const b = sin * t.sx;
  const c = -sin * t.sy;
  const d = cos * t.sy;

  const tx = t.x - (a * t.pivotX + c * t.pivotY);
  const ty = t.y - (b * t.pivotX + d * t.pivotY);

  return { a, b, c, d, tx, ty };
}

export function multiplyAffine(parent: Affine2D, child: Affine2D): Affine2D {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    tx: parent.a * child.tx + parent.c * child.ty + parent.tx,
    ty: parent.b * child.tx + parent.d * child.ty + parent.ty,
  };
}

export function applyAffineToPoint(m: Affine2D, pt: Point2D): Point2D {
  return {
    x: m.a * pt.x + m.c * pt.y + m.tx,
    y: m.b * pt.x + m.d * pt.y + m.ty,
  };
}

export function determinantAffine(m: Affine2D): number {
  return m.a * m.d - m.b * m.c;
}

export function invertAffine(m: Affine2D): Affine2D {
  const det = determinantAffine(m);
  if (!Number.isFinite(det) || Math.abs(det) < MIN_DET) {
    throw new AppError('ERR_SINGULAR_TRANSFORM', 'Cannot invert singular affine matrix.', {
      det,
    });
  }
  const invDet = 1 / det;
  return {
    a: m.d * invDet,
    b: -m.b * invDet,
    c: -m.c * invDet,
    d: m.a * invDet,
    tx: (m.c * m.ty - m.d * m.tx) * invDet,
    ty: (m.b * m.tx - m.a * m.ty) * invDet,
  };
}

export function decomposeAffineToTRS(
  m: Affine2D,
  pivotX: number,
  pivotY: number,
  preferredSxSign = 1,
): Transform {
  const det = determinantAffine(m);
  if (!Number.isFinite(det) || Math.abs(det) < MIN_DET) {
    throw new AppError('ERR_SINGULAR_TRANSFORM', 'Cannot decompose singular affine matrix.', {
      det,
    });
  }

  const lenU = Math.hypot(m.a, m.b);
  const lenV = Math.hypot(m.c, m.d);
  if (lenU < MIN_SCALE || lenV < MIN_SCALE) {
    throw new AppError('ERR_SINGULAR_TRANSFORM', 'Transform scale is near zero.');
  }

  const orthoError = Math.abs(m.a * m.c + m.b * m.d) / (lenU * lenV);
  if (orthoError > 1e-4) {
    throw new AppError(
      'ERR_SHEAR_NOT_REPRESENTABLE',
      'Reparenting would introduce shear that cannot be represented losslessly by TRS.',
      { orthoError },
    );
  }

  const sx = preferredSxSign < 0 ? -lenU : lenU;
  const angleRad = Math.atan2(m.b / sx, m.a / sx);
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const sy = m.d * cos - m.c * sin;
  const x = m.tx + m.a * pivotX + m.c * pivotY;
  const y = m.ty + m.b * pivotX + m.d * pivotY;
  const angle = (angleRad * 180) / Math.PI;

  const result: Transform = { x, y, angle, sx, sy, pivotX, pivotY };
  const recomposed = composeLocalMatrix(result);
  const maxDiff = Math.max(
    Math.abs(recomposed.a - m.a),
    Math.abs(recomposed.b - m.b),
    Math.abs(recomposed.c - m.c),
    Math.abs(recomposed.d - m.d),
    Math.abs(recomposed.tx - m.tx),
    Math.abs(recomposed.ty - m.ty),
  );
  if (maxDiff > 1e-3) {
    throw new AppError(
      'ERR_SHEAR_NOT_REPRESENTABLE',
      'Affine matrix cannot be losslessly decomposed into TRS.',
      { maxDiff },
    );
  }

  return result;
}

export function compensatePivotChange(t: Transform, newPivotX: number, newPivotY: number): Transform {
  const m = composeLocalMatrix(t);
  return {
    ...t,
    pivotX: newPivotX,
    pivotY: newPivotY,
    x: m.tx + m.a * newPivotX + m.c * newPivotY,
    y: m.ty + m.b * newPivotX + m.d * newPivotY,
  };
}
