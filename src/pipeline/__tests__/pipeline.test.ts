import { describe, expect, it } from 'vitest';
import type { GrayImage } from '../../types';
import { blur, detectEdges } from '../edges';
import { simplify, smoothResample, traceEdges } from '../trace';
import { generateHatching } from '../hatch';
import { buildSketchPlan, schedule } from '../plan';
import { buildStrokeGeometry } from '../../render/strokeGeometry';

/** White image with a centered dark square — crisp edges, dark region. */
function squareImage(size = 64, lo = 0.1): GrayImage {
  const data = new Float32Array(size * size).fill(1);
  const a = Math.floor(size / 4);
  const b = Math.floor((3 * size) / 4);
  for (let y = a; y < b; y++) {
    for (let x = a; x < b; x++) data[y * size + x] = lo;
  }
  return { width: size, height: size, data };
}

describe('blur', () => {
  it('preserves a constant image', () => {
    const img: GrayImage = { width: 8, height: 8, data: new Float32Array(64).fill(0.5) };
    const out = blur(img, 2);
    for (const v of out.data) expect(v).toBeCloseTo(0.5, 5);
  });

  it('smooths a step edge', () => {
    const img = squareImage(32);
    const out = blur(img, 2);
    const mid = 16 * 32 + 8; // on the vertical edge of the square
    expect(out.data[mid]).toBeGreaterThan(0.1);
    expect(out.data[mid]).toBeLessThan(1);
  });
});

describe('detectEdges', () => {
  it('finds the outline of a square and nothing in flat areas', () => {
    const edges = detectEdges(squareImage(), 0.5);
    let count = 0;
    for (const v of edges.mask) count += v;
    // The square outline is ~4 * size/2 = 128 px; allow generous slack.
    expect(count).toBeGreaterThan(60);
    expect(count).toBeLessThan(600);
    // Flat corner far from the square has no edges.
    expect(edges.mask[2 * 64 + 2]).toBe(0);
  });

  it('returns an empty mask for a constant image', () => {
    const img: GrayImage = { width: 16, height: 16, data: new Float32Array(256).fill(0.7) };
    const edges = detectEdges(img, 0.9);
    expect(edges.mask.every((v) => v === 0)).toBe(true);
  });
});

describe('traceEdges', () => {
  it('links the square outline into few long chains', () => {
    const edges = detectEdges(squareImage(), 0.5);
    const chains = traceEdges(edges);
    expect(chains.length).toBeGreaterThan(0);
    expect(chains.length).toBeLessThan(12);
    const totalPts = chains.reduce((a, c) => a + c.length, 0);
    expect(totalPts).toBeGreaterThan(50);
    // Chains are connected: consecutive points at most √2 apart.
    for (const chain of chains) {
      for (let i = 1; i < chain.length; i++) {
        const d = Math.hypot(chain[i].x - chain[i - 1].x, chain[i].y - chain[i - 1].y);
        expect(d).toBeLessThanOrEqual(Math.SQRT2 + 1e-9);
      }
    }
  });
});

describe('simplify', () => {
  it('collapses collinear points and keeps corners', () => {
    const pts = [];
    for (let i = 0; i <= 10; i++) pts.push({ x: i, y: 0 });
    for (let i = 1; i <= 10; i++) pts.push({ x: 10, y: i });
    const out = simplify(pts, 0.5);
    expect(out.length).toBe(3);
    expect(out[1]).toEqual({ x: 10, y: 0 });
  });
});

describe('smoothResample', () => {
  it('produces evenly spaced points along a straight line', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ];
    const out = smoothResample(pts, 3);
    expect(out.length).toBe(11);
    expect(out[0].x).toBeCloseTo(0, 1);
    expect(out[out.length - 1].x).toBeCloseTo(30, 1);
    for (let i = 1; i < out.length; i++) {
      const d = Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
      expect(d).toBeGreaterThan(1.5);
      expect(d).toBeLessThan(4.5);
    }
  });
});

describe('generateHatching', () => {
  it('hatches dark regions only', () => {
    const strokes = generateHatching(squareImage(96, 0.05));
    expect(strokes.length).toBeGreaterThan(10);
    // All hatch points fall inside (or near, after blur) the dark square.
    for (const s of strokes) {
      for (const p of s.points) {
        expect(p.x).toBeGreaterThan(96 / 4 - 8);
        expect(p.x).toBeLessThan((3 * 96) / 4 + 8);
        expect(p.y).toBeGreaterThan(96 / 4 - 8);
        expect(p.y).toBeLessThan((3 * 96) / 4 + 8);
      }
    }
  });

  it('produces no hatching for a white image', () => {
    const img: GrayImage = { width: 64, height: 64, data: new Float32Array(4096).fill(1) };
    expect(generateHatching(img).length).toBe(0);
  });
});

describe('schedule', () => {
  it('packs strokes into [t0,t1] windows that tile the range', () => {
    const strokes = [
      { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], kind: 'contour' as const, pressure: 1 },
      { points: [{ x: 0, y: 0 }, { x: 50, y: 0 }], kind: 'contour' as const, pressure: 1 },
    ];
    const timed = schedule(strokes, 0, 0.5);
    expect(timed[0].t0).toBe(0);
    expect(timed[1].t0).toBeCloseTo(timed[0].t1, 6);
    expect(timed[1].t1).toBeCloseTo(0.5, 6);
    // Longer stroke gets more time.
    expect(timed[0].t1 - timed[0].t0).toBeGreaterThan(timed[1].t1 - timed[1].t0);
  });
});

describe('buildSketchPlan', () => {
  it('builds a lineart plan with only contours, timeline covering 0..1', () => {
    const plan = buildSketchPlan(squareImage(96), { style: 'lineart' });
    expect(plan.strokes.length).toBeGreaterThan(0);
    expect(plan.strokes.every((s) => s.kind === 'contour')).toBe(true);
    expect(plan.strokes[0].t0).toBe(0);
    expect(plan.strokes[plan.strokes.length - 1].t1).toBeCloseTo(1, 6);
  });

  it('adds hatching in shaded style, after contours', () => {
    const plan = buildSketchPlan(squareImage(96, 0.05), { style: 'shaded' });
    const kinds = new Set(plan.strokes.map((s) => s.kind));
    expect(kinds.has('contour')).toBe(true);
    expect(kinds.has('hatch')).toBe(true);
    const lastContourEnd = Math.max(
      ...plan.strokes.filter((s) => s.kind === 'contour').map((s) => s.t1),
    );
    const firstHatchStart = Math.min(
      ...plan.strokes.filter((s) => s.kind !== 'contour').map((s) => s.t0),
    );
    expect(firstHatchStart).toBeGreaterThanOrEqual(lastContourEnd - 1e-6);
  });
});

describe('buildStrokeGeometry', () => {
  it('emits 2 vertices per point and monotonic aT along each stroke', () => {
    const plan = buildSketchPlan(squareImage(96, 0.05), { style: 'shaded' });
    const geo = buildStrokeGeometry(plan);
    const expectedVerts = plan.strokes
      .filter((s) => s.points.length >= 2)
      .reduce((a, s) => a + s.points.length * 2, 0);
    expect(geo.getAttribute('position').count).toBe(expectedVerts);

    const aT = geo.getAttribute('aT');
    let v = 0;
    for (const s of plan.strokes) {
      if (s.points.length < 2) continue;
      let prev = -Infinity;
      for (let i = 0; i < s.points.length; i++) {
        const t = aT.getX(v);
        expect(t).toBeGreaterThanOrEqual(prev - 1e-6);
        expect(t).toBeGreaterThanOrEqual(s.t0 - 1e-6);
        expect(t).toBeLessThanOrEqual(s.t1 + 1e-6);
        prev = t;
        v += 2; // both ribbon sides share the same aT
      }
    }
  });

  it('keeps ribbon vertices near the source points', () => {
    const stroke = {
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 30, y: 10 },
      ],
      kind: 'contour' as const,
      pressure: 1,
      t0: 0,
      t1: 1,
    };
    const geo = buildStrokeGeometry({ width: 40, height: 40, strokes: [stroke] });
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      expect(Math.abs(pos.getY(i) - 10)).toBeLessThan(3);
    }
  });
});
