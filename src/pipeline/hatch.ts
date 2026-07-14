import type { GrayImage, Pt, Stroke } from '../types';
import { blur } from './edges';

export interface HatchPass {
  /** Hatch lines cover pixels darker than this tone (0 black .. 1 white). */
  threshold: number;
  /** Line direction in radians. */
  angle: number;
  /** Distance between parallel hatch lines, px. */
  spacing: number;
  /** Pencil pressure for this pass. */
  pressure: number;
  kind: 'hatch' | 'crosshatch';
}

/** Classic three-pass tonal hatching: light wash, midtones, dark cross-hatch. */
export const DEFAULT_PASSES: HatchPass[] = [
  { threshold: 0.72, angle: (-35 * Math.PI) / 180, spacing: 7, pressure: 0.32, kind: 'hatch' },
  { threshold: 0.45, angle: (-35 * Math.PI) / 180, spacing: 4.5, pressure: 0.5, kind: 'hatch' },
  { threshold: 0.24, angle: (52 * Math.PI) / 180, spacing: 5, pressure: 0.65, kind: 'crosshatch' },
];

/**
 * Generate hatching strokes for regions of the image darker than each pass
 * threshold. Lines run parallel at the pass angle; segments where the local
 * tone is lighter than the threshold are skipped, splitting lines naturally
 * around bright areas.
 */
export function generateHatching(
  gray: GrayImage,
  passes: HatchPass[] = DEFAULT_PASSES,
  minSegmentLen = 6,
): Stroke[] {
  const tone = blur(gray, 2); // hatch against smoothed tone, not pixel noise
  const { width, height } = tone;
  const strokes: Stroke[] = [];
  const sample = (x: number, y: number): number => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= width || yi >= height) return 1;
    return tone.data[yi * width + xi];
  };

  const diag = Math.hypot(width, height);
  const step = 1.5; // sampling step along each hatch line, px

  for (const pass of passes) {
    const dirX = Math.cos(pass.angle);
    const dirY = Math.sin(pass.angle);
    // Perpendicular used to enumerate the family of parallel lines.
    const perpX = -dirY;
    const perpY = dirX;
    const cx = width / 2;
    const cy = height / 2;
    const nLines = Math.ceil(diag / pass.spacing);

    for (let li = -nLines; li <= nLines; li++) {
      const ox = cx + perpX * li * pass.spacing;
      const oy = cy + perpY * li * pass.spacing;
      let segment: Pt[] = [];
      const flush = () => {
        if (segment.length >= 2) {
          let len = 0;
          for (let i = 1; i < segment.length; i++) {
            len += Math.hypot(
              segment[i].x - segment[i - 1].x,
              segment[i].y - segment[i - 1].y,
            );
          }
          if (len >= minSegmentLen) {
            strokes.push({ points: segment, kind: pass.kind, pressure: pass.pressure });
          }
        }
        segment = [];
      };
      for (let s = -diag / 2; s <= diag / 2; s += step) {
        const x = ox + dirX * s;
        const y = oy + dirY * s;
        const inside = x >= 0 && y >= 0 && x < width && y < height;
        if (inside && sample(x, y) < pass.threshold) {
          segment.push({ x, y });
        } else {
          flush();
        }
      }
      flush();
    }
  }
  return strokes;
}
