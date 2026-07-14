import type { Pt } from '../types';
import type { EdgeMap } from './edges';

/**
 * Convert a binary edge mask into polylines by walking 8-connected chains.
 * Endpoints (pixels with one neighbor) are preferred chain starts so open
 * curves are traced end-to-end; leftover pixels (loops) start anywhere.
 */
export function traceEdges(edges: EdgeMap, minPoints = 8): Pt[][] {
  const { width, height, mask } = edges;
  const visited = new Uint8Array(mask.length);
  const chains: Pt[][] = [];

  const neighborCount = (x: number, y: number): number => {
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (mask[ny * width + nx]) c++;
      }
    }
    return c;
  };

  const walk = (sx: number, sy: number): Pt[] => {
    const chain: Pt[] = [];
    let x = sx;
    let y = sy;
    let px = -2; // previous position, to bias direction continuity
    let py = -2;
    for (;;) {
      chain.push({ x, y });
      visited[y * width + x] = 1;
      let bx = -1;
      let by = -1;
      let bestScore = -Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const k = ny * width + nx;
          if (!mask[k] || visited[k]) continue;
          // Prefer continuing in the same direction (smooth chains),
          // and prefer 4-connected steps over diagonals slightly.
          let score = dx === 0 || dy === 0 ? 0.5 : 0;
          if (px > -2) {
            const cdx = x - px;
            const cdy = y - py;
            score += cdx * dx + cdy * dy;
          }
          if (score > bestScore) {
            bestScore = score;
            bx = nx;
            by = ny;
          }
        }
      }
      if (bx < 0) break;
      px = x;
      py = y;
      x = bx;
      y = by;
    }
    return chain;
  };

  // Pass 1: start from endpoints for clean open curves.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] && !visited[i] && neighborCount(x, y) === 1) {
        const chain = walk(x, y);
        if (chain.length >= minPoints) chains.push(chain);
      }
    }
  }
  // Pass 2: whatever is left (closed loops, junction remnants).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] && !visited[i]) {
        const chain = walk(x, y);
        if (chain.length >= minPoints) chains.push(chain);
      }
    }
  }
  return chains;
}

/** Ramer–Douglas–Peucker polyline simplification. */
export function simplify(points: Pt[], epsilon: number): Pt[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = points[a];
    const pb = points[b];
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy) || 1e-9;
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = a + 1; i < b; i++) {
      const p = points[i];
      const dist = Math.abs(dy * p.x - dx * p.y + pb.x * pa.y - pb.y * pa.x) / len;
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon && maxIdx > 0) {
      keep[maxIdx] = 1;
      stack.push([a, maxIdx], [maxIdx, b]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** Total polyline arc length. */
export function arcLength(points: Pt[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return len;
}

/**
 * Resample a polyline to evenly spaced points (spacing in pixels) with
 * Catmull-Rom smoothing, so strokes render as fluid curves rather than
 * pixel staircases.
 */
export function smoothResample(points: Pt[], spacing: number): Pt[] {
  if (points.length < 2) return points.slice();
  const total = arcLength(points);
  const n = Math.max(2, Math.round(total / spacing) + 1);

  // Cumulative lengths for even arc-length sampling.
  const cum = new Float32Array(points.length);
  for (let i = 1; i < points.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }

  const out: Pt[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total;
    while (seg < points.length - 2 && cum[seg + 1] < target) seg++;
    const segLen = cum[seg + 1] - cum[seg] || 1e-9;
    const t = (target - cum[seg]) / segLen;
    // Catmull-Rom through p(seg-1..seg+2)
    const p0 = points[Math.max(0, seg - 1)];
    const p1 = points[seg];
    const p2 = points[seg + 1];
    const p3 = points[Math.min(points.length - 1, seg + 2)];
    out.push({
      x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
      y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
    });
  }
  return out;
}

function catmullRom(v0: number, v1: number, v2: number, v3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * v1 +
      (-v0 + v2) * t +
      (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 +
      (-v0 + 3 * v1 - 3 * v2 + v3) * t3)
  );
}
