import type { Pt, SketchPlan } from '../types';
import { strokeRand, strokeWobble } from './strokeGeometry';

export interface PencilTip {
  x: number;
  y: number;
  strokeIndex: number;
}

/**
 * Where the pencil tip is at timeline position `progress` — on the same
 * wobbled centerline the ribbon geometry uses, so a pencil sprite parked
 * here sits exactly on the ink front being revealed.
 */
export function pencilTipAt(plan: SketchPlan, progress: number): PencilTip | null {
  const strokes = plan.strokes;
  if (strokes.length === 0) return null;
  const p = Math.min(1, Math.max(0, progress));

  // Strokes tile [0,1] head-to-tail; binary-search the last t0 <= p.
  let lo = 0;
  let hi = strokes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (strokes[mid].t0 <= p) lo = mid;
    else hi = mid - 1;
  }
  const stroke = strokes[lo];
  const pts = stroke.points;
  if (pts.length === 0) return null;
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, strokeIndex: lo };

  const local =
    stroke.t1 > stroke.t0 ? Math.min(1, Math.max(0, (p - stroke.t0) / (stroke.t1 - stroke.t0))) : 1;

  const cum = new Float32Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  const total = cum[pts.length - 1] || 1e-9;
  const target = local * total;
  let seg = 0;
  while (seg < pts.length - 2 && cum[seg + 1] < target) seg++;
  const segLen = cum[seg + 1] - cum[seg] || 1e-9;
  const u = Math.min(1, Math.max(0, (target - cum[seg]) / segLen));

  const wobble = strokeWobble(strokeRand(lo));
  const c0 = wobbledCenter(pts, cum, seg, wobble);
  const c1 = wobbledCenter(pts, cum, seg + 1, wobble);
  return { x: c0.x + (c1.x - c0.x) * u, y: c0.y + (c1.y - c0.y) * u, strokeIndex: lo };
}

/** Stroke centerline point i with hand wobble — mirrors buildStrokeGeometry. */
function wobbledCenter(
  pts: Pt[],
  cum: Float32Array,
  i: number,
  wobble: { phase: number; freq: number; amp: number },
): Pt {
  const p = pts[i];
  const prev = pts[Math.max(0, i - 1)];
  const next = pts[Math.min(pts.length - 1, i + 1)];
  let tx = next.x - prev.x;
  let ty = next.y - prev.y;
  const tl = Math.hypot(tx, ty) || 1e-9;
  tx /= tl;
  ty /= tl;
  const w = Math.sin(cum[i] * wobble.freq * Math.PI * 2 + wobble.phase) * wobble.amp;
  return { x: p.x + -ty * w, y: p.y + tx * w };
}
