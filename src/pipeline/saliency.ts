import type { GrayImage, Pt } from '../types';
import type { EdgeMap } from './edges';
import { blur } from './edges';

/**
 * Cheap subject-saliency field, 0..1 — where edge detail concentrates,
 * weighted toward the image center. No ML: in photos and illustrations
 * alike, the subject is where the detail is, and it's rarely in a corner.
 */
export function buildSaliency(edges: EdgeMap): GrayImage {
  const { width, height } = edges;
  const density = new Float32Array(width * height);
  for (let i = 0; i < density.length; i++) density[i] = edges.mask[i];
  // A wide blur turns the sparse edge mask into a smooth detail field.
  const field = blur(
    { width, height, data: density },
    Math.max(4, Math.round(Math.max(width, height) / 14)),
  );
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const invR2 = 1 / (cx * cx + cy * cy || 1);
  const data = field.data;
  let max = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const dx = x - cx;
      const dy = y - cy;
      // Full weight at the center, ~35% in the far corners.
      data[i] *= 1 - 0.65 * (dx * dx + dy * dy) * invR2;
      if (data[i] > max) max = data[i];
    }
  }
  if (max > 0) for (let i = 0; i < data.length; i++) data[i] /= max;
  return { width, height, data };
}

/** Mean saliency along a stroke, sparsely sampled. */
export function strokeSaliency(points: Pt[], saliency: GrayImage): number {
  const { width, height, data } = saliency;
  let sum = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(points.length / 12));
  for (let i = 0; i < points.length; i += step) {
    const x = Math.min(width - 1, Math.max(0, Math.round(points[i].x)));
    const y = Math.min(height - 1, Math.max(0, Math.round(points[i].y)));
    sum += data[y * width + x];
    n++;
  }
  return n ? sum / n : 0;
}
