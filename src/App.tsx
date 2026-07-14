import { useCallback, useEffect, useRef, useState } from 'react';
import type { SketchStyle } from './types';
import { createSketchPlayer, SketchPlayer, type SketchSource } from './api';
import { CameraCapture } from './ui/CameraCapture';

const SAMPLES = [
  { name: 'House', url: `${import.meta.env.BASE_URL}samples/house.svg` },
  { name: 'Cat', url: `${import.meta.env.BASE_URL}samples/cat.svg` },
  { name: 'Sailboat', url: `${import.meta.env.BASE_URL}samples/sailboat.svg` },
];

export function App() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<SketchPlayer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [style, setStyle] = useState<SketchStyle>('shaded');
  const [duration, setDuration] = useState(12);
  const [detail, setDetail] = useState(0.5);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pencil, setPencil] = useState(true);
  const [sound, setSound] = useState(true);
  const [hasImage, setHasImage] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const player = createSketchPlayer(viewportRef.current!, {
      onProgress: (p) => {
        setProgress(p);
        setPlaying(player.playing);
      },
    });
    playerRef.current = player;
    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (player) player.durationSec = duration;
  }, [duration]);

  // Run a player task with busy/error bookkeeping around it.
  const run = useCallback(async (task: (player: SketchPlayer) => Promise<void>) => {
    const player = playerRef.current;
    if (!player) return;
    setBusy(true);
    setError(null);
    try {
      await task(player);
      setHasImage(player.hasImage);
      setPlaying(player.playing);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sketching failed');
    } finally {
      setBusy(false);
    }
  }, []);

  const draw = useCallback(
    (source: SketchSource) => run((player) => player.draw(source, { style, detail })),
    [run, style, detail],
  );

  // Re-run the pipeline on the cached image when style/detail change.
  const restyle = useCallback(
    (nextStyle: SketchStyle, nextDetail: number) => {
      setStyle(nextStyle);
      setDetail(nextDetail);
      if (playerRef.current?.hasImage) {
        void run((player) => player.restyle({ style: nextStyle, detail: nextDetail }));
      }
    },
    [run],
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
        void draw(file);
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) =>
        f.type.startsWith('image/'),
      );
      if (file) void draw(file);
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
  }, [draw]);

  const player = playerRef.current;

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
              if (f) void draw(f);
              e.target.value = '';
            }}
          />
          <p className="hint">…or drag &amp; drop / paste (Ctrl+V) an image anywhere.</p>
          <div className="samples">
            {SAMPLES.map((s) => (
              <button key={s.name} className="sample" onClick={() => void draw(s.url)}>
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
          <label className="check">
            <input
              type="checkbox"
              checked={pencil}
              onChange={(e) => {
                setPencil(e.target.checked);
                if (player) player.pencil = e.target.checked;
              }}
            />
            Show pencil
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={sound}
              onChange={(e) => {
                setSound(e.target.checked);
                if (player) player.sound = e.target.checked;
              }}
            />
            Pencil sound
          </label>
          <div className="button-row">
            <button
              disabled={!hasImage}
              onClick={() => {
                if (!player) return;
                if (player.playing) player.pause();
                else player.play();
                setPlaying(player.playing);
              }}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <button disabled={!hasImage} onClick={() => player?.restart()}>
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
                player?.seek(Number(e.target.value));
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
            void draw(canvas);
          }}
        />
      )}
    </div>
  );
}
