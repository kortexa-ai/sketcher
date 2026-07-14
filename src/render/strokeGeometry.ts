import * as THREE from 'three';
import type { SketchPlan, TimedStroke } from '../types';

/**
 * Build one merged BufferGeometry containing every stroke as a thin ribbon
 * (triangle strip pairs). A single draw call renders the whole sketch; the
 * per-vertex `aT` attribute (global timeline position) lets the shader
 * reveal strokes progressively from a single `uProgress` uniform.
 *
 * Attributes:
 *  - position: x,y in image pixel space (z=0)
 *  - aT:       global timeline position of this vertex (0..1)
 *  - aAlpha:   opacity (pencil pressure with human variation)
 *  - aSide:    0/1 across the ribbon width, for soft edges
 */
export function buildStrokeGeometry(plan: SketchPlan): THREE.BufferGeometry {
  let vertexCount = 0;
  let indexCount = 0;
  for (const s of plan.strokes) {
    if (s.points.length < 2) continue;
    vertexCount += s.points.length * 2;
    indexCount += (s.points.length - 1) * 6;
  }

  const positions = new Float32Array(vertexCount * 3);
  const aT = new Float32Array(vertexCount);
  const aAlpha = new Float32Array(vertexCount);
  const aSide = new Float32Array(vertexCount);
  const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

  let v = 0;
  let idx = 0;
  plan.strokes.forEach((stroke, strokeIndex) => {
    if (stroke.points.length < 2) return;
    const rand = mulberry32(strokeIndex * 2654435761 + 1);
    const base = v;
    const pts = stroke.points;
    const n = pts.length;

    // Cumulative arc length → fraction along stroke for aT interpolation.
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    const total = cum[n - 1] || 1e-9;

    const baseWidth = strokeWidth(stroke);
    const wobblePhase = rand() * Math.PI * 2;
    const wobbleFreq = 0.05 + rand() * 0.06; // cycles per pixel of arc length
    const wobbleAmp = 0.35 + rand() * 0.5;
    const alphaJitterPhase = rand() * Math.PI * 2;

    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(n - 1, i + 1)];
      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      const tl = Math.hypot(tx, ty) || 1e-9;
      tx /= tl;
      ty /= tl;
      const nx = -ty;
      const ny = tx;

      const frac = cum[i] / total;
      // Taper the stroke at both ends, like a pencil lifting off.
      const taper = Math.min(1, Math.min(cum[i], total - cum[i]) / 6 + 0.25);
      // Hand wobble: low-frequency perpendicular drift.
      const wobble = Math.sin(cum[i] * wobbleFreq * Math.PI * 2 + wobblePhase) * wobbleAmp;
      const halfW = (baseWidth * taper) / 2;
      const cxp = p.x + nx * wobble;
      const cyp = p.y + ny * wobble;

      const t = stroke.t0 + (stroke.t1 - stroke.t0) * frac;
      // Pressure varies along the stroke — nobody draws at constant darkness.
      const alpha =
        stroke.pressure *
        (0.75 + 0.25 * Math.sin(cum[i] * 0.11 + alphaJitterPhase)) *
        (0.85 + 0.15 * rand());

      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? 1 : -1;
        positions[v * 3] = cxp + nx * halfW * sign;
        positions[v * 3 + 1] = cyp + ny * halfW * sign;
        positions[v * 3 + 2] = 0;
        aT[v] = t;
        aAlpha[v] = alpha;
        aSide[v] = side;
        v++;
      }
    }

    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      indices[idx++] = a;
      indices[idx++] = a + 1;
      indices[idx++] = a + 2;
      indices[idx++] = a + 1;
      indices[idx++] = a + 3;
      indices[idx++] = a + 2;
    }
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(aAlpha, 1));
  geo.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

function strokeWidth(stroke: TimedStroke): number {
  switch (stroke.kind) {
    case 'contour':
      return 2.1;
    case 'hatch':
      return 1.5;
    case 'crosshatch':
      return 1.7;
  }
}

/** Deterministic PRNG so rebuilding the same plan renders identically. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
