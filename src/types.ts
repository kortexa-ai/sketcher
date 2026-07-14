/** A point in image pixel coordinates. */
export interface Pt {
  x: number;
  y: number;
}

/** Grayscale image, values 0..1, row-major. */
export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
}

export type StrokeKind = 'contour' | 'hatch' | 'crosshatch';

/** A single pencil stroke: an ordered polyline plus rendering hints. */
export interface Stroke {
  points: Pt[];
  kind: StrokeKind;
  /** 0..1 — how hard the pencil presses (darkness/width). */
  pressure: number;
}

/** A stroke scheduled on the global animation timeline. */
export interface TimedStroke extends Stroke {
  /** Global timeline position where this stroke starts, 0..1. */
  t0: number;
  /** Global timeline position where this stroke ends, 0..1. */
  t1: number;
}

export interface SketchPlan {
  width: number;
  height: number;
  strokes: TimedStroke[];
}

export type SketchStyle = 'lineart' | 'shaded';

export interface PipelineOptions {
  style: SketchStyle;
  /** Working resolution: the longest image side is scaled to this. */
  maxSide?: number;
  /** Edge sensitivity 0..1 (higher = more edges/detail). */
  detail?: number;
}
