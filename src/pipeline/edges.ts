import type { GrayImage } from '../types';

/** Result of edge extraction: binary edge mask plus gradient info. */
export interface EdgeMap {
  width: number;
  height: number;
  /** 1 where an edge pixel survived hysteresis, else 0. */
  mask: Uint8Array;
  /** Gradient magnitude (unnormalized). */
  magnitude: Float32Array;
}

/** Separable box-ish gaussian blur (3 passes of box blur ≈ gaussian). */
export function blur(src: GrayImage, radius: number): GrayImage {
  if (radius <= 0) {
    return { width: src.width, height: src.height, data: Float32Array.from(src.data) };
  }
  const { width, height } = src;
  let data = Float32Array.from(src.data);
  const tmp = new Float32Array(data.length);
  const r = Math.max(1, Math.round(radius));
  const norm = 1 / (2 * r + 1);
  for (let pass = 0; pass < 3; pass++) {
    // horizontal
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += data[row + clampi(x, width)];
      for (let x = 0; x < width; x++) {
        tmp[row + x] = acc * norm;
        acc += data[row + clampi(x + r + 1, width)] - data[row + clampi(x - r, width)];
      }
    }
    // vertical
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[clampi(y, height) * width + x];
      for (let y = 0; y < height; y++) {
        data[y * width + x] = acc * norm;
        acc += tmp[clampi(y + r + 1, height) * width + x] - tmp[clampi(y - r, height) * width + x];
      }
    }
  }
  return { width, height, data };
}

function clampi(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/**
 * Canny-style edge detection: sobel → non-maximum suppression → hysteresis.
 * `detail` 0..1 scales the thresholds (higher detail = lower thresholds = more edges).
 */
export function detectEdges(gray: GrayImage, detail = 0.5): EdgeMap {
  const { width, height } = gray;
  const smoothed = blur(gray, 1);
  const d = smoothed.data;

  const mag = new Float32Array(width * height);
  const dir = new Float32Array(width * height); // gradient angle in radians

  const at = (x: number, y: number) => d[clampi(y, height) * width + clampi(x, width)];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx =
        -at(x - 1, y - 1) + at(x + 1, y - 1)
        - 2 * at(x - 1, y) + 2 * at(x + 1, y)
        - at(x - 1, y + 1) + at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)
        + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const i = y * width + x;
      mag[i] = Math.hypot(gx, gy);
      dir[i] = Math.atan2(gy, gx);
    }
  }

  // Non-maximum suppression: keep pixels that are local maxima along the gradient.
  const thin = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const m = mag[i];
      if (m === 0) continue;
      const a = dir[i];
      // Quantize direction to 4 sectors.
      const deg = ((a * 180) / Math.PI + 180) % 180;
      let n1: number, n2: number;
      if (deg < 22.5 || deg >= 157.5) {
        n1 = mag[i - 1]; n2 = mag[i + 1];
      } else if (deg < 67.5) {
        n1 = mag[i - width - 1]; n2 = mag[i + width + 1];
      } else if (deg < 112.5) {
        n1 = mag[i - width]; n2 = mag[i + width];
      } else {
        n1 = mag[i - width + 1]; n2 = mag[i + width - 1];
      }
      if (m >= n1 && m >= n2) thin[i] = m;
    }
  }

  // Hysteresis thresholding. Thresholds scale with detail and image statistics.
  let max = 0;
  for (let i = 0; i < thin.length; i++) if (thin[i] > max) max = thin[i];
  if (max === 0) {
    return { width, height, mask: new Uint8Array(width * height), magnitude: mag };
  }
  const detailClamped = Math.min(1, Math.max(0, detail));
  const high = max * (0.28 - 0.22 * detailClamped); // detail 0 → 0.28, detail 1 → 0.06
  const low = high * 0.4;

  const mask = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let i = 0; i < thin.length; i++) {
    if (thin[i] >= high && !mask[i]) {
      mask[i] = 1;
      stack.push(i);
      while (stack.length) {
        const j = stack.pop()!;
        const jx = j % width;
        const jy = (j - jx) / width;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = jx + dx;
            const ny = jy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const k = ny * width + nx;
            if (!mask[k] && thin[k] >= low) {
              mask[k] = 1;
              stack.push(k);
            }
          }
        }
      }
    }
  }
  return { width, height, mask, magnitude: mag };
}
