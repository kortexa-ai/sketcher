import type { ColorImage, GrayImage } from '../types';

/** Draw any image source onto a canvas at working resolution → grayscale. */
export function toGrayImage(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  maxSide = 768,
): GrayImage {
  const scale = Math.min(1, maxSide / Math.max(srcWidth, srcHeight));
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // White backing so transparent images (e.g. SVG samples) read as paper.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  return { width, height, data: gray };
}

/** Like toGrayImage, but keeps RGB — one canvas read yields both via toImages. */
export function toImages(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  maxSide = 768,
): { gray: GrayImage; color: ColorImage } {
  const scale = Math.min(1, maxSide / Math.max(srcWidth, srcHeight));
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);
  const rgb = new Float32Array(width * height * 3);
  for (let i = 0; i < gray.length; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
    gray[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return {
    gray: { width, height, data: gray },
    color: { width, height, data: rgb },
  };
}

/** Load a File/Blob (upload, paste, camera snapshot) into an element. */
export function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode image'));
    };
    img.src = url;
  });
}

/** Load an image by URL (bundled samples). */
export function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}
