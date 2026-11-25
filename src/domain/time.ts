import { AppError } from './errors';

export const TICKS_PER_SECOND = 120_000;

export const SUPPORTED_INTEGER_FPS = [8, 12, 15, 24, 25, 30, 60] as const;

export interface RationalFps {
  num: number;
  den: number;
}

export interface TickRange {
  inTick: number;
  outTick: number;
}

export interface PlannedFrame {
  index: number;
  shotTick: number;
  ptsSeconds: number;
  durationSeconds: number;
}

export function validateFps(fps: RationalFps): void {
  if (
    !Number.isInteger(fps.num) ||
    !Number.isInteger(fps.den) ||
    fps.num <= 0 ||
    fps.den <= 0
  ) {
    throw new AppError('ERR_INVALID_FPS', 'FPS numerator and denominator must be positive integers.', {
      num: fps.num,
      den: fps.den,
    });
  }
}

export function positiveMod(value: number, modulus: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(modulus) || modulus <= 0) {
    throw new AppError('ERR_INVALID_RANGE', 'positiveMod requires finite value and positive modulus.', {
      value,
      modulus,
    });
  }
  const rem = ((value % modulus) + modulus) % modulus;
  if (rem === 0 || rem >= modulus) {
    return 0;
  }
  return rem;
}

export function frameIndexToTick(startTick: number, frameIndex: number, fps: RationalFps): number {
  validateFps(fps);
  if (!Number.isInteger(startTick) || startTick < 0 || !Number.isInteger(frameIndex) || frameIndex < 0) {
    throw new AppError('ERR_INVALID_RANGE', 'startTick and frameIndex must be non-negative integers.', {
      startTick,
      frameIndex,
    });
  }
  return startTick + Math.round((frameIndex * TICKS_PER_SECOND * fps.den) / fps.num);
}

export function planFrames(range: TickRange, fps: RationalFps): PlannedFrame[] {
  validateFps(fps);
  if (
    !Number.isInteger(range.inTick) ||
    !Number.isInteger(range.outTick) ||
    range.inTick < 0 ||
    range.outTick <= range.inTick
  ) {
    throw new AppError(
      'ERR_INVALID_RANGE',
      'Export range requires non-negative integer ticks with outTick > inTick.',
      {
        inTick: range.inTick,
        outTick: range.outTick,
      },
    );
  }

  const frames: PlannedFrame[] = [];
  const durationSeconds = fps.den / fps.num;
  let index = 0;

  while (true) {
    const shotTick = frameIndexToTick(range.inTick, index, fps);
    if (shotTick >= range.outTick) {
      break;
    }
    frames.push({
      index,
      shotTick,
      ptsSeconds: (index * fps.den) / fps.num,
      durationSeconds,
    });
    index += 1;
  }

  if (frames.length === 0) {
    throw new AppError('ERR_INVALID_RANGE', 'Export range produced zero frames.', {
      inTick: range.inTick,
      outTick: range.outTick,
    });
  }

  return frames;
}
