import { useCallback, useEffect, useRef, useState } from 'react';
import type { GrayImage, SketchStyle } from './types';
import { buildSketchPlan } from './pipeline/plan';
import { loadImageFromBlob, loadImageFromUrl, toGrayImage } from './pipeline/image';
import { SketchRenderer } from './render/SketchRenderer';
import { CameraCapture } from './ui/CameraCapture';

const SAMPLES = [
  { name: 'House', url: `${import.meta.env.BASE_URL}samples/house.svg` },
  { name: 'Cat', url: `${import.meta.env.BASE_URL}samples/cat.svg` },
  { name: 'Sailboat', url: `${import.meta.env.BASE_URL}samples/sailboat.svg` },
];

export function App() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<SketchRenderer | null>(null);
  const grayRef = useRef<GrayImage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [style, setStyle] = useState<SketchStyle>('shaded');
  const [duration, setDuration] = useState(12);
  const [detail, setDetail] = useState(0.5);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasImage, setHasImage] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = viewportRef.current!;
    const renderer = new SketchRenderer(container);
    renderer.onProgress = (p) => {
      setProgress(p);
      setPlaying(renderer.isPlaying);
    };
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const r = rendererRef.current;
    if (r) r.durationSec = duration;
  }, [duration]);

  const sketch = useCallback((gray: GrayImage, sketchStyle: SketchStyle, edgeDetail: number) => {
    setBusy(true);
    setError(null);
    // Let the busy state paint before the (CPU-heavy) pipeline runs.
    setTimeout(() => {
      try {
        const plan = buildSketchPlan(gray, { style: sketchStyle, detail: edgeDetail });
        rendererRef.current?.setPlan(plan);
        setHasImage(true);
        setPlaying(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sketching failed');
      } finally {
        setBusy(false);
      }
    }, 30);
  }, []);

  const acceptSource = useCallback(
    (source: CanvasImageSource, w: number, h: number) => {
      const gray = toGrayImage(source, w, h);
      grayRef.current = gray;
      sketch(gray, style, detail);
    },
    [sketch, style, detail],
  );

  const acceptBlob = useCallback(
    async (blob: Blob) => {
      try {
        const img = await loadImageFromBlob(blob);
        acceptSource(img, img.naturalWidth, img.naturalHeight);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not read image');
      }
    },
    [acceptSource],
  );

  // Re-run the pipeline when style/detail change and an image is loaded.
  const restyle = useCallback(
    (nextStyle: SketchStyle, nextDetail: number) => {
      setStyle(nextStyle);
      setDetail(nextDetail);
      if (grayRef.current) sketch(grayRef.current, nextStyle, nextDetail);
    },
    [sketch],
  );

  // Paste and drag-drop anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      );
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        void acceptBlob(file);
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) =>
        f.type.startsWith('image/'),
      );
      if (file) void acceptBlob(file);
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener('paste', onPaste);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
    };
  }, [acceptBlob]);

  const loadSample = async (url: string) => {
    try {
      setError(null);
      const img = await loadImageFromUrl(url);
      acceptSource(img, img.naturalWidth || 800, img.naturalHeight || 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load sample');
    }
  };

  const renderer = rendererRef.current;

  return (
    <div className="app">
      <aside className="panel">
        <h1>Sketcher</h1>
        <p className="tagline">Turn any picture into a hand-drawn pencil sketch.</p>

        <section>
          <h2>Picture</h2>
          <div className="button-row">
            <button onClick={() => fileInputRef.current?.click()}>Upload…</button>
            <button onClick={() => setCameraOpen(true)}>Camera</button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void acceptBlob(f);
              e.target.value = '';
            }}
          />
          <p className="hint">…or drag &amp; drop / paste (Ctrl+V) an image anywhere.</p>
          <div className="samples">
            {SAMPLES.map((s) => (
              <button key={s.name} className="sample" onClick={() => void loadSample(s.url)}>
                <img src={s.url} alt={s.name} />
                <span>{s.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Style</h2>
          <div className="button-row toggle">
            <button
              className={style === 'lineart' ? 'active' : ''}
              onClick={() => restyle('lineart', detail)}
            >
              Line art
            </button>
            <button
              className={style === 'shaded' ? 'active' : ''}
              onClick={() => restyle('shaded', detail)}
            >
              Pencil shading
            </button>
          </div>
          <label>
            Detail
            <input
              type="range"
              min={0.15}
              max={0.9}
              step={0.05}
              value={detail}
              onChange={(e) => restyle(style, Number(e.target.value))}
            />
          </label>
        </section>

        <section>
          <h2>Animation</h2>
          <label>
            Duration: {duration}s
            <input
              type="range"
              min={3}
              max={45}
              step={1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </label>
          <div className="button-row">
            <button
              disabled={!hasImage}
              onClick={() => {
                if (!renderer) return;
                if (renderer.isPlaying) renderer.pause();
                else renderer.play();
                setPlaying(renderer.isPlaying);
              }}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <button disabled={!hasImage} onClick={() => renderer?.restart()}>
              Redraw
            </button>
          </div>
          <label>
            Progress
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={progress}
              disabled={!hasImage}
              onChange={(e) => {
                renderer?.seek(Number(e.target.value));
                setPlaying(false);
              }}
            />
          </label>
        </section>

        {error && <p className="error">{error}</p>}
        <footer>
          <a href="https://github.com/kortexa-ai/sketcher">kortexa-ai/sketcher</a>
        </footer>
      </aside>

      <main className="viewport" ref={viewportRef}>
        {!hasImage && !busy && (
          <div className="placeholder">
            <p>Pick a picture to sketch it ✏️</p>
          </div>
        )}
        {busy && (
          <div className="placeholder">
            <p>Sketching…</p>
          </div>
        )}
      </main>

      {cameraOpen && (
        <CameraCapture
          onClose={() => setCameraOpen(false)}
          onCapture={(canvas) => {
            setCameraOpen(false);
            acceptSource(canvas, canvas.width, canvas.height);
          }}
        />
      )}
    </div>
  );
}
