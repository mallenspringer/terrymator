import { describe, expect, it } from 'vitest';
import { encodePngRgba } from '../../src/assets/pngCodec';
import { detectImageMime, mimeToExtension } from '../../src/assets/sourceImport';
import { createSolidSquare } from '../../src/assets/synthetic';

describe('assets/sourceImport magic bytes', () => {
  it('detects PNG, JPEG, and WebP signatures', () => {
    const img = createSolidSquare(4, 4, [255, 0, 0, 255]);
    const png = encodePngRgba(img.rgba, 4, 4);
    expect(detectImageMime(png)).toBe('image/png');
    expect(mimeToExtension('image/png')).toBe('png');

    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectImageMime(jpeg)).toBe('image/jpeg');
    expect(mimeToExtension('image/jpeg')).toBe('jpg');

    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectImageMime(webp)).toBe('image/webp');
    expect(mimeToExtension('image/webp')).toBe('webp');
  });

  it('rejects SVG, HTML, empty, and truncated buffers', () => {
    expect(detectImageMime(new Uint8Array())).toBeNull();
    expect(detectImageMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectImageMime(new TextEncoder().encode('<html><body>nope</body></html>'))).toBeNull();
    expect(detectImageMime(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
  });
});
