import type { GrayImage, PipelineOptions, SketchPlan, Stroke, TimedStroke } from '../types';
import { detectEdges } from './edges';
import { arcLength, simplify, smoothResample, traceEdges } from './trace';
import { generateHatching } from './hatch';

/**
 * Full sketch pipeline (DOM-free): grayscale image → timed stroke plan.
 *
 * Contours are drawn first — longest, most structural lines leading — then
 * hatching passes build up tone from light to dark, which is roughly how a
 * person shades a pencil drawing.
 */
export function buildSketchPlan(gray: GrayImage, options: PipelineOptions): SketchPlan {
  const detail = options.detail ?? 0.5;

  const edges = detectEdges(gray, detail);
  const chains = traceEdges(edges);
  const contours: Stroke[] = chains.map((chain) => ({
    points: smoothResample(simplify(chain, 1.3), 3),
    kind: 'contour',
    pressure: 0.85,
  }));
  // Structural lines first: sort by length, longest leading. A light spatial
  // bias (top-left earlier) breaks ties so the order feels intentional.
  const withLen = contours.map((s) => ({ s, len: arcLength(s.points) }));
  withLen.sort((a, b) => {
    const scoreA = a.len - 0.15 * (a.s.points[0].x + a.s.points[0].y);
    const scoreB = b.len - 0.15 * (b.s.points[0].x + b.s.points[0].y);
    return scoreB - scoreA;
  });
  const orderedContours = withLen.map((w) => w.s);

  let hatches: Stroke[] = [];
  if (options.style === 'shaded') {
    hatches = generateHatching(gray).map((s) => ({
      ...s,
      points: smoothResample(s.points, 3),
    }));
  }

  // Split the timeline: contours get the first chunk, shading the rest.
  // Each stroke's duration is proportional to its length, with a small
  // constant per-stroke cost (pencil travel between strokes).
  const contourShare = options.style === 'shaded' ? 0.45 : 1;
  const strokes: TimedStroke[] = [
    ...schedule(orderedContours, 0, contourShare),
    ...schedule(hatches, contourShare, 1),
  ];
  return { width: gray.width, height: gray.height, strokes };
}

/** Lay strokes head-to-tail across [tStart, tEnd] proportionally to length. */
export function schedule(strokes: Stroke[], tStart: number, tEnd: number): TimedStroke[] {
  if (strokes.length === 0 || tEnd <= tStart) return [];
  const perStrokeCost = 14; // constant px-equivalent cost per stroke
  const weights = strokes.map((s) => arcLength(s.points) + perStrokeCost);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = tEnd - tStart;
  let t = tStart;
  return strokes.map((s, i) => {
    const dt = (weights[i] / total) * span;
    const timed: TimedStroke = { ...s, t0: t, t1: t + dt };
    t += dt;
    return timed;
  });
}
