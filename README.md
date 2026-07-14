# Sketcher

Prototype: turn any picture into an animated hand-drawn **pencil sketch**, rendered with three.js.

Intended for the Folio storybook app: a genAI-generated illustration is presented to the child as if someone is drawing it by hand with a pencil, live.

**Live demo:** https://kortexa-ai.github.io/sketcher/

## What it does

1. **Input** — upload / drag-drop / paste (Ctrl+V) a picture, take one with the camera, or click a bundled sample.
2. **Sketch pipeline** (pure TypeScript, no server):
   - grayscale + blur → Canny-style edge detection (Sobel, non-max suppression, hysteresis)
   - edge pixels are linked into chains, simplified (Douglas-Peucker) and smoothed (Catmull-Rom) into **contour strokes**
   - tone-based **hatching**: three passes (light wash → midtones → dark cross-hatch) generate parallel strokes clipped to dark regions
   - strokes are scheduled on a 0..1 timeline: long structural contours first, then shading light-to-dark — roughly how a person draws
3. **Rendering** — all strokes are merged into a single three.js mesh of textured ribbons. A per-vertex timeline attribute plus one `uProgress` uniform reveals the sketch progressively in **one draw call**, with hand wobble, pressure variation, graphite grain, taper, and a procedural paper background.

## Controls

- **Style**: line art only, or full pencil shading (toggle)
- **Detail**: edge sensitivity
- **Duration**: 3–45 s draw time, plus play/pause, redraw, and a progress scrubber

## Develop

```bash
npm install
npm run dev     # local dev server
npm test        # vitest unit tests for the pipeline
npm run build   # type-check + production build
```

## Deploy

Pushes to `main` build and deploy to GitHub Pages via `.github/workflows/deploy.yml`.

## Using this from Folio

The pipeline (`src/pipeline/`) and renderer (`src/render/`) have no app dependencies:

```ts
const gray = toGrayImage(imageElement, w, h);          // any CanvasImageSource
const plan = buildSketchPlan(gray, { style: 'shaded' });
const renderer = new SketchRenderer(containerDiv);
renderer.durationSec = 15;
renderer.setPlan(plan);                                 // starts drawing
```
