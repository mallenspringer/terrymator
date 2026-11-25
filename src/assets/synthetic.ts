export interface RgbaImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

function setPixel(
  buf: Uint8Array,
  width: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const idx = (y * width + x) * 4;
  buf[idx] = r;
  buf[idx + 1] = g;
  buf[idx + 2] = b;
  buf[idx + 3] = a;
}

/**
 * Generates a deterministic cutout sprite with transparent margin,
 * semitransparent (alpha=128) border band, and solid opaque quadrant interior.
 */
export function createCutoutSprite(
  width: number,
  height: number,
  colors: {
    tl: [number, number, number];
    tr: [number, number, number];
    bl: [number, number, number];
    br: [number, number, number];
    border: [number, number, number];
  },
): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  const margin = 4;
  const band = 4;
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < margin || y < margin || x >= width - margin || y >= height - margin) {
        setPixel(rgba, width, x, y, 0, 0, 0, 0);
        continue;
      }
      if (
        x < margin + band ||
        y < margin + band ||
        x >= width - margin - band ||
        y >= height - margin - band
      ) {
        setPixel(rgba, width, x, y, colors.border[0], colors.border[1], colors.border[2], 128);
        continue;
      }
      const c =
        y < midY
          ? x < midX
            ? colors.tl
            : colors.tr
          : x < midX
            ? colors.bl
            : colors.br;
      setPixel(rgba, width, x, y, c[0], c[1], c[2], 255);
    }
  }
  return { width, height, rgba };
}

/**
 * Generates an asymmetric non-square tile pattern so X/Y tiling,
 * negative offsets, and mirrored repeat are unambiguously verifiable.
 */
export function createTilePattern(width = 48, height = 32): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < 8 && y < 8) {
        setPixel(rgba, width, x, y, 240, 200, 40, 255);
      } else if (x < width / 2 && y < height / 2) {
        setPixel(rgba, width, x, y, 50, 80, 140, 255);
      } else if (x >= width / 2 && y >= height / 2) {
        setPixel(rgba, width, x, y, 70, 110, 175, 255);
      } else {
        setPixel(rgba, width, x, y, 36, 56, 100, 255);
      }
    }
  }
  return { width, height, rgba };
}

export function createSolidSquare(
  width: number,
  height: number,
  color: [number, number, number, number],
): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(rgba, width, x, y, color[0], color[1], color[2], color[3]);
    }
  }
  return { width, height, rgba };
}
