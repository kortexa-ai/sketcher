import type { ColorImage, GrayImage, Pt } from '../types';

/**
 * Per-pixel saturation 0..1 (max − min channel). Used to decide colored-
 * pencil coverage: a vivid yellow is light in luminance but must still be
 * colored in.
 */
export function saturationMap(color: ColorImage): GrayImage {
  const { width, height, data } = color;
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    out[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  return { width, height, data: out };
}

/**
 * Fake tone for colored hatching: dark wherever the picture is either dark
 * OR saturated, so hatch passes cover every colored region, not just dim
 * ones. Returns 1 (paper) where nothing needs coloring.
 */
export function coverageTone(gray: GrayImage, color: ColorImage): GrayImage {
  const sat = saturationMap(color);
  const out = new Float32Array(gray.data.length);
  for (let i = 0; i < out.length; i++) {
    const cover = Math.max(1 - gray.data[i], sat.data[i] * 0.85);
    out[i] = 1 - cover;
  }
  return { width: gray.width, height: gray.height, data: out };
}

/**
 * Average image color along a stroke, punched up like a colored pencil:
 * saturation boosted and kept dark enough to read on paper.
 */
export function strokeColor(points: Pt[], color: ColorImage): [number, number, number] {
  const { width, height, data } = color;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(points.length / 16));
  for (let i = 0; i < points.length; i += step) {
    const x = Math.min(width - 1, Math.max(0, Math.round(points[i].x)));
    const y = Math.min(height - 1, Math.max(0, Math.round(points[i].y)));
    const j = (y * width + x) * 3;
    r += data[j];
    g += data[j + 1];
    b += data[j + 2];
    n++;
  }
  if (n === 0) return [0.16, 0.17, 0.2];
  r /= n;
  g /= n;
  b /= n;
  // Saturation boost around the channel mean.
  const m = (r + g + b) / 3;
  r = clamp01(m + (r - m) * 1.45);
  g = clamp01(m + (g - m) * 1.45);
  b = clamp01(m + (b - m) * 1.45);
  // A pencil can't draw white — keep the tint visible on paper.
  const peak = Math.max(r, g, b);
  if (peak > 0.85) {
    const s = 0.85 / peak;
    r *= s;
    g *= s;
    b *= s;
  }
  return [r, g, b];
}

/**
 * Split a polyline into runs of similar color, so one hatch line crossing a
 * red house and its blue door becomes a red stroke and a blue stroke instead
 * of one muddy average. Runs shorter than minPoints are dropped (a pencil
 * wouldn't bother with a 2px dab).
 */
export function splitByColor(
  points: Pt[],
  color: ColorImage,
  tolerance = 0.32,
  minPoints = 4,
): Pt[][] {
  const { width, height, data } = color;
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  let mr = 0;
  let mg = 0;
  let mb = 0;
  for (const p of points) {
    const x = Math.min(width - 1, Math.max(0, Math.round(p.x)));
    const y = Math.min(height - 1, Math.max(0, Math.round(p.y)));
    const j = (y * width + x) * 3;
    const r = data[j];
    const g = data[j + 1];
    const b = data[j + 2];
    if (run.length === 0) {
      run = [p];
      mr = r;
      mg = g;
      mb = b;
      continue;
    }
    if (Math.hypot(r - mr, g - mg, b - mb) > tolerance) {
      if (run.length >= minPoints) runs.push(run);
      run = [p];
      mr = r;
      mg = g;
      mb = b;
    } else {
      run.push(p);
      const n = run.length;
      mr += (r - mr) / n;
      mg += (g - mg) / n;
      mb += (b - mb) / n;
    }
  }
  if (run.length >= minPoints) runs.push(run);
  return runs;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
