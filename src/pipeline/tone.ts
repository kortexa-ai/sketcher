import type { GrayImage } from '../types';

/**
 * Contrast-normalize a grayscale image: stretch the 2nd..98th percentile
 * tone range to 0..1. Washed-out photos and low-contrast genAI renders get
 * meaningful edges and hatch tones; already-full-range images barely change.
 */
export function normalizeTone(gray: GrayImage): GrayImage {
  const { width, height, data } = gray;
  const bins = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) {
    bins[Math.min(255, Math.max(0, Math.round(data[i] * 255)))]++;
  }
  const pick = (fraction: number): number => {
    const target = fraction * data.length;
    let acc = 0;
    for (let b = 0; b < 256; b++) {
      acc += bins[b];
      if (acc >= target) return b / 255;
    }
    return 1;
  };
  const lo = pick(0.02);
  const hi = pick(0.98);
  if (hi - lo < 0.05) {
    // Effectively flat — stretching would just amplify noise.
    return { width, height, data: Float32Array.from(data) };
  }
  const scale = 1 / (hi - lo);
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = Math.min(1, Math.max(0, (data[i] - lo) * scale));
  }
  return { width, height, data: out };
}
