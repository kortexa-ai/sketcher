import type { GrayImage, SketchStyle } from './types';
import { buildSketchPlan } from './pipeline/plan';
import { loadImageFromBlob, loadImageFromUrl, toGrayImage } from './pipeline/image';
import { SketchRenderer } from './render/SketchRenderer';

/** What a host app hands us: a decoded image/canvas/bitmap, a Blob, or a URL. */
export type SketchSource = CanvasImageSource | Blob | string;

export interface SketchOptions {
  style?: SketchStyle;
  /** Edge sensitivity 0..1 (higher = more edges/detail). */
  detail?: number;
  /** Wall-clock draw time in seconds. */
  durationSec?: number;
  /** Working resolution: the longest image side is scaled to this. */
  maxSide?: number;
}

export interface SketchPlayerOptions extends SketchOptions {
  onProgress?: (progress: number) => void;
  /** Fires once each time the drawing reaches the end. */
  onComplete?: () => void;
}

/**
 * The embeddable surface for Folio: everything the standalone app does minus
 * its UI. Owns a SketchRenderer inside `container`; feed it images and
 * control playback.
 *
 *   const player = createSketchPlayer(div, { durationSec: 15 });
 *   await player.draw(generatedIllustration);
 */
export class SketchPlayer {
  private renderer: SketchRenderer;
  private gray: GrayImage | null = null;
  private currentStyle: SketchStyle;
  private currentDetail: number;
  private maxSide: number;
  private completeFired = false;

  onProgress: ((progress: number) => void) | null;
  onComplete: (() => void) | null;

  constructor(container: HTMLElement, options: SketchPlayerOptions = {}) {
    this.currentStyle = options.style ?? 'shaded';
    this.currentDetail = options.detail ?? 0.5;
    this.maxSide = options.maxSide ?? 768;
    this.onProgress = options.onProgress ?? null;
    this.onComplete = options.onComplete ?? null;
    this.renderer = new SketchRenderer(container);
    this.renderer.durationSec = options.durationSec ?? 12;
    this.renderer.onProgress = (p) => {
      this.onProgress?.(p);
      if (p >= 1) {
        if (!this.completeFired) {
          this.completeFired = true;
          this.onComplete?.();
        }
      } else {
        this.completeFired = false;
      }
    };
  }

  /** Sketch a new image and start drawing it from the beginning. */
  async draw(source: SketchSource, overrides: SketchOptions = {}): Promise<void> {
    const el =
      typeof source === 'string'
        ? await loadImageFromUrl(source)
        : source instanceof Blob
          ? await loadImageFromBlob(source)
          : source;
    if (overrides.maxSide !== undefined) this.maxSide = overrides.maxSide;
    const { width, height } = sourceSize(el);
    this.gray = toGrayImage(el, width, height, this.maxSide);
    await this.replan(overrides);
  }

  /** Re-sketch the current image with a different style/detail. */
  async restyle(overrides: SketchOptions = {}): Promise<void> {
    if (!this.gray) return;
    await this.replan(overrides);
  }

  private async replan(overrides: SketchOptions): Promise<void> {
    if (overrides.style !== undefined) this.currentStyle = overrides.style;
    if (overrides.detail !== undefined) this.currentDetail = overrides.detail;
    if (overrides.durationSec !== undefined) this.renderer.durationSec = overrides.durationSec;
    // Yield a beat so hosts can paint a "sketching…" state before the
    // CPU-heavy pipeline blocks the main thread.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const plan = buildSketchPlan(this.gray!, {
      style: this.currentStyle,
      detail: this.currentDetail,
    });
    this.completeFired = false;
    this.renderer.setPlan(plan); // starts drawing from t=0
  }

  play(): void {
    this.renderer.play();
  }

  pause(): void {
    this.renderer.pause();
  }

  restart(): void {
    this.completeFired = false;
    this.renderer.restart();
  }

  /** Jump to a timeline position 0..1 (pauses playback). */
  seek(progress: number): void {
    this.renderer.seek(progress);
  }

  get playing(): boolean {
    return this.renderer.isPlaying;
  }

  get progress(): number {
    return this.renderer.progress;
  }

  get hasImage(): boolean {
    return this.gray !== null;
  }

  get durationSec(): number {
    return this.renderer.durationSec;
  }

  set durationSec(seconds: number) {
    this.renderer.durationSec = seconds;
  }

  get style(): SketchStyle {
    return this.currentStyle;
  }

  get detail(): number {
    return this.currentDetail;
  }

  dispose(): void {
    this.renderer.dispose();
    this.gray = null;
  }
}

export function createSketchPlayer(
  container: HTMLElement,
  options?: SketchPlayerOptions,
): SketchPlayer {
  return new SketchPlayer(container, options);
}

function sourceSize(source: CanvasImageSource): { width: number; height: number } {
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    // SVGs without an intrinsic size report 0 — fall back to a sane raster size.
    return { width: source.naturalWidth || 800, height: source.naturalHeight || 600 };
  }
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame) {
    return { width: source.displayWidth, height: source.displayHeight };
  }
  const { width, height } = source as { width: number; height: number };
  return { width, height };
}
