import type {
  ColorImage,
  GrayImage,
  PipelineOptions,
  Pt,
  SketchPlan,
  Stroke,
  TimedStroke,
} from '../types';
import { detectEdges } from './edges';
import { arcLength, simplify, smoothResample, traceEdges } from './trace';
import { generateHatching, type HatchPass } from './hatch';
import { buildSaliency, strokeSaliency } from './saliency';
import { normalizeTone } from './tone';
import { coverageTone, splitByColor, strokeColor } from './color';

/**
 * Colored-pencil fill passes: denser than graphite shading, thresholds set
 * against the saturation-aware coverage tone so vivid-but-light regions
 * still get colored in.
 */
export const COLOR_PASSES: HatchPass[] = [
  { threshold: 0.82, angle: (-35 * Math.PI) / 180, spacing: 4.2, pressure: 0.5, kind: 'hatch' },
  { threshold: 0.45, angle: (52 * Math.PI) / 180, spacing: 3.4, pressure: 0.62, kind: 'crosshatch' },
];

/**
 * Full sketch pipeline (DOM-free): grayscale image → timed stroke plan.
 *
 * Draw order aims to feel human: the subject (where edge detail concentrates,
 * biased toward the image center) is outlined before the background, longest
 * structural lines leading, then hatching builds tone light to dark — subject
 * shaded first within each pass. Time is spent like a person spends it too:
 * long confident lines are drawn fast, short fiddly ones slowly (strokeEffort).
 */
export function buildSketchPlan(
  rawGray: GrayImage,
  options: PipelineOptions,
  color?: ColorImage,
): SketchPlan {
  const detail = options.detail ?? 0.5;
  const gray = normalizeTone(rawGray);

  const edges = detectEdges(gray, detail);
  const saliency = buildSaliency(edges);
  const chains = traceEdges(edges);
  const contours: Stroke[] = chains.map((chain) => ({
    points: smoothResample(simplify(chain, 1.3), 3),
    kind: 'contour',
    pressure: 0.85,
  }));

  // Subject before background, structure before detail: a stroke's slot mixes
  // where it lives (saliency) with how structural it is (length).
  const lens = contours.map((s) => arcLength(s.points));
  const longest = lens.reduce((a, b) => Math.max(a, b), 1);
  const orderedContours = contours
    .map((s, i) => ({ s, score: 3 * strokeSaliency(s.points, saliency) + lens[i] / longest }))
    .sort((a, b) => b.score - a.score)
    .map((o) => o.s);

  // 'colored' without a color image degrades gracefully to graphite shading.
  const colored = options.style === 'colored' && !!color;
  let hatches: Stroke[] = [];
  if (options.style === 'shaded' || options.style === 'colored') {
    if (colored) {
      // Split each hatch line at color boundaries so small colorful details
      // (a blue door on a red house) keep their own hue.
      hatches = generateHatching(coverageTone(gray, color!), COLOR_PASSES).flatMap((s) =>
        splitByColor(s.points, color!).map((run) => ({
          ...s,
          points: smoothResample(run, 3),
          color: strokeColor(run, color!),
        })),
      );
    } else {
      hatches = generateHatching(gray).map((s) => ({
        ...s,
        points: smoothResample(s.points, 3),
      }));
    }
    // Keep the tonal passes (light wash → dark cross-hatch) in order, but
    // shade the subject before the backdrop within each pass.
    const passIndex = new Map<number, number>();
    for (const s of hatches) {
      if (!passIndex.has(s.pressure)) passIndex.set(s.pressure, passIndex.size);
    }
    const sal = new Map<Stroke, number>();
    for (const s of hatches) sal.set(s, strokeSaliency(s.points, saliency));
    hatches.sort(
      (a, b) =>
        passIndex.get(a.pressure)! - passIndex.get(b.pressure)! || sal.get(b)! - sal.get(a)!,
    );
  }

  // Split the timeline by how much work each phase actually is, so heavy
  // shading doesn't rush the line work. Lineart uses the whole timeline.
  let contourShare = 1;
  if (hatches.length > 0) {
    const contourEffort = orderedContours.reduce((a, s) => a + strokeEffort(s), 0);
    const hatchEffort = hatches.reduce((a, s) => a + strokeEffort(s), 0);
    const raw = contourEffort / (contourEffort + hatchEffort || 1);
    contourShare = Math.min(0.65, Math.max(0.35, raw));
  }

  const strokes: TimedStroke[] = [
    ...schedule(orderedContours, 0, contourShare),
    ...schedule(hatches, contourShare, 1),
  ];
  return { width: gray.width, height: gray.height, strokes };
}

/** Lay strokes head-to-tail across [tStart, tEnd] proportionally to effort. */
export function schedule(strokes: Stroke[], tStart: number, tEnd: number): TimedStroke[] {
  if (strokes.length === 0 || tEnd <= tStart) return [];
  const weights = strokes.map(strokeEffort);
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

/**
 * Time cost of drawing one stroke, in arbitrary units. Sublinear in length —
 * a long confident line moves fast, while short detail strokes get
 * proportionally more time — increased by curvature (wiggly = careful =
 * slow), plus a fixed cost for travelling the pencil to the stroke start.
 */
export function strokeEffort(s: Stroke): number {
  const len = arcLength(s.points);
  const turnPerPx = totalTurning(s.points) / Math.max(len, 1);
  const care = 1 + 0.6 * Math.min(2, turnPerPx * 25);
  return 12 + Math.pow(len, 0.72) * care;
}

/** Sum of absolute direction changes along a polyline, radians. */
function totalTurning(points: Pt[]): number {
  let turn = 0;
  for (let i = 2; i < points.length; i++) {
    const a1 = Math.atan2(points[i - 1].y - points[i - 2].y, points[i - 1].x - points[i - 2].x);
    const a2 = Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    turn += Math.abs(d);
  }
  return turn;
}
