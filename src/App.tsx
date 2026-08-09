import { useRef, useState } from 'react';
import { estimateDepth, loadDepthModel, type DepthResult } from './depth';

/**
 * Smoke test only: proves the vendored model + WASM runtime load from /public
 * with no network. Day 1 replaces this with the real pipeline.
 */
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const say = (line: string) => setLog((prev) => [...prev, line]);

  async function run(source: HTMLCanvasElement | HTMLImageElement) {
    setBusy(true);
    try {
      const t0 = performance.now();
      await loadDepthModel();
      say(`model yüklendi   ${Math.round(performance.now() - t0)} ms`);

      const t1 = performance.now();
      const depth = await estimateDepth(source);
      say(`çıkarım          ${Math.round(performance.now() - t1)} ms  (${depth.width}x${depth.height})`);

      draw(canvasRef.current!, depth);
    } catch (err) {
      say(`HATA: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, display: 'grid', gap: 16, justifyItems: 'start' }}>
      <h1 style={{ font: 'inherit', fontSize: 18, margin: 0 }}>spatial-canvas · depth smoke test</h1>

      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={busy} onClick={() => run(syntheticImage())}>
          sentetik görsel
        </button>
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) run(await loadImage(URL.createObjectURL(file)));
          }}
        />
      </div>

      <canvas ref={canvasRef} style={{ maxWidth: 512, imageRendering: 'pixelated' }} />
      <pre style={{ margin: 0, color: '#8ab' }}>{log.join('\n')}</pre>
    </div>
  );
}

/** Grayscale preview: white = near, black = far. */
function draw(canvas: HTMLCanvasElement, { data, width, height }: DepthResult) {
  canvas.width = width;
  canvas.height = height;
  const image = new ImageData(width, height);
  for (let i = 0; i < data.length; i++) {
    const v = data[i] * 255;
    image.data.set([v, v, v, 255], i * 4);
  }
  canvas.getContext('2d')!.putImageData(image, 0, 0);
}

/** Shapes at different scales so the depth output is visibly non-flat. */
function syntheticImage(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const sky = ctx.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#9dc3e6');
  sky.addColorStop(1, '#e8d9b0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 512, 512);

  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(0, 380, 512, 132);
  for (const [x, w, h] of [[40, 70, 160], [150, 90, 240], [300, 60, 120], [400, 100, 300]]) {
    ctx.fillStyle = '#5a5a68';
    ctx.fillRect(x, 380 - h, w, h);
  }
  ctx.fillStyle = '#c94f4f';
  ctx.beginPath();
  ctx.arc(256, 430, 60, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
