import { useEffect, useRef, useState } from 'react';

interface Props {
  onCapture: (canvas: HTMLCanvasElement) => void;
  onClose: () => void;
}

/** Fullscreen camera view with a shutter button. */
export function CameraCapture({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Camera unavailable');
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const snap = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    onCapture(canvas);
  };

  return (
    <div className="camera-overlay" role="dialog" aria-label="Camera">
      {error ? (
        <div className="camera-error">
          <p>{error}</p>
          <button onClick={onClose}>Close</button>
        </div>
      ) : (
        <>
          <video ref={videoRef} playsInline muted />
          <div className="camera-buttons">
            <button className="shutter" onClick={snap} aria-label="Take picture" />
            <button className="camera-close" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
