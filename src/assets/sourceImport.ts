import { AppError } from '../domain/errors';
import type { SourceMimeType } from '../domain/schema';

export const MAX_IMAGE_DIMENSION = 8192;
export const MAX_IMAGE_PIXELS = 64_000_000;

export function detectImageMime(bytes: Uint8Array): SourceMimeType | null {
  if (bytes.length < 12) {
    return null;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

export function mimeToExtension(mimeType: SourceMimeType): string {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
  }
}

export function assertValidImageDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new AppError(
      'ERR_INVALID_IMAGE',
      `Image dimensions ${width}x${height} exceed supported safety limits.`,
      { width, height },
    );
  }
}

export async function decodeImageInBrowser(
  bytes: Uint8Array,
): Promise<{ mimeType: SourceMimeType; width: number; height: number; rgba: Uint8Array }> {
  const mimeType = detectImageMime(bytes);
  if (!mimeType) {
    throw new AppError(
      'ERR_INVALID_IMAGE',
      'Unsupported or corrupted image file. Only PNG, JPEG, and WebP are supported.',
    );
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mimeType });

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new AppError('ERR_INVALID_IMAGE', `Failed to decode ${mimeType} image.`);
  }

  try {
    assertValidImageDimensions(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new AppError('ERR_INVALID_IMAGE', 'Failed to allocate 2D decode canvas.');
    }
    ctx.drawImage(bitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      mimeType,
      width: imgData.width,
      height: imgData.height,
      rgba: new Uint8Array(imgData.data.buffer),
    };
  } finally {
    bitmap.close();
  }
}
