// Qualitative only: default photo depth vs ?derinlik=moge on real photos, rendered from the
// side with the engine's own position sampler. No ground truth; not an accuracy measurement.
import { estimateDepth, FOTO_KALITE, depthDevice } from '../depth.ts';
import { createHomeTexture, fillPositionsFromDepth, POINTS_DEPTH_RANGE, POINTS_WORLD_HEIGHT, POSITION_TEXTURE_SIZE } from '../engine/buffers.ts';
import { createMetricPhotoProjection } from '../engine/reconstruction/metricPhotoGeometry.ts';
import { segmentForeground } from '../engine/reconstruction/segmentation.ts';
import { resampleBilinear } from '../engine/reconstruction/silhouette.ts';
import { subjectZSpan } from '../engine/reconstruction/sampler.ts';
import { yuzRolyefHaritasi, yuzRolyefiUygula } from '../engine/reconstruction/yuzRolyef.ts';
import { yuzNoktalari } from '../engine/vision/yuzTespit.ts';

const PANEL = 320, VIEWS = [0, 45, 90];

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(`image load failed: ${url}`));
    img.src = url;
  });
}

function pixels(img: HTMLImageElement, w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

function drawDepth(ctx: CanvasRenderingContext2D, data: Float32Array, w: number, h: number, ox: number, oy: number) {
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = 255 * data[i]; img.data.set([v, v, v, 255], i * 4); }
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d')!.putImageData(img, 0, 0);
  const s = Math.min(PANEL / w, PANEL / h);
  ctx.drawImage(c, ox + (PANEL - w * s) / 2, oy + (PANEL - h * s) / 2, w * s, h * s);
}

/** Orthographic splat render of the home texture, rotated around Y (same convention as verify-splat-yan). */
function drawPoints(ctx: CanvasRenderingContext2D, home: Float32Array, rgb: Uint8ClampedArray, w: number, h: number, deg: number, ox: number, oy: number) {
  const n = POSITION_TEXTURE_SIZE, phi = deg * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const img = ctx.getImageData(ox, oy, PANEL, PANEL), zbuf = new Float32Array(PANEL * PANEL).fill(-Infinity);
  const half = 1.7;
  for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
    const o = (gy * n + gx) * 4, a = home[o + 3];
    if (!a) continue;
    const [x, y, z] = [home[o], home[o + 1], home[o + 2]];
    const u = x * cp - z * sp, key = x * sp + z * cp;
    const px = Math.round((u + half) / (2 * half) * PANEL), py = Math.round((half - y) / (2 * half) * PANEL);
    const si = Math.min(h - 1, Math.floor((gy + .5) / n * h)) * w + Math.min(w - 1, Math.floor((gx + .5) / n * w));
    const dim = a >= .5 ? 1 : .35;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const X = px + dx, Y = py + dy;
      if (X < 0 || Y < 0 || X >= PANEL || Y >= PANEL || zbuf[Y * PANEL + X] >= key) continue;
      zbuf[Y * PANEL + X] = key;
      for (let c = 0; c < 3; c++) img.data[(Y * PANEL + X) * 4 + c] = rgb[si * 4 + c] * dim;
    }
  }
  ctx.putImageData(img, ox, oy);
}

export async function runMogeRealPhotos(urls: string[], progress: (m: string) => void = console.log) {
  const results = [];
  for (const url of urls) {
    progress(`photo ${url}`);
    const img = await loadImage(url);
    const seg = await segmentForeground(img, 'webgpu', 'foto');
    let t = performance.now();
    const def = await estimateDepth(img, { ...FOTO_KALITE, model: 'da3-mono', subjectMask: { data: seg.mask, width: seg.width, height: seg.height } });
    const defMs = performance.now() - t, defDevice = depthDevice;
    t = performance.now();
    const moge = await estimateDepth(img, { ...FOTO_KALITE, model: 'moge-2' });
    const mogeMs = performance.now() - t, mogeDevice = depthDevice;

    const canvas = document.createElement('canvas');
    canvas.width = PANEL * (1 + VIEWS.length); canvas.height = PANEL * 2 + 24;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const rows = [['default', def], ['moge', moge]] as const;
    const diag: Record<string, unknown> = {};
    for (let r = 0; r < 2; r++) {
      const [label, d] = rows[r];
      const mask = d.subjectMask ?? resampleBilinear(seg.mask, seg.width, seg.height, d.width, d.height);
      let depth = d.data;
      let faceRelief = false;
      const home = createHomeTexture();
      const projection = d.metricGeometry ? createMetricPhotoProjection(d.metricGeometry, d.data, mask) : null;
      if (!projection) {
        // Default path mirrors App/Engine: face relief x1.5 before sampling (crop omitted).
        const yuz = await yuzNoktalari(img);
        const rol = yuz ? yuzRolyefHaritasi(yuz.noktalar, d.width, d.height, 1.5) : null;
        if (rol) {
          const halfH = POINTS_WORLD_HEIGHT / 2;
          const zSpan = subjectZSpan(depth, d.width, d.height, mask, halfH, POINTS_DEPTH_RANGE);
          depth = yuzRolyefiUygula(depth, d.width, d.height, rol, zSpan * d.height / (2 * halfH));
          faceRelief = true;
        }
      }
      fillPositionsFromDepth(home, depth, d.width, d.height, { metricProjection: projection, foregroundMask: mask, blend: 1, importanceSampling: false });
      const rgb = pixels(img, d.width, d.height);
      const y0 = 24 + r * PANEL;
      drawDepth(ctx, d.data, d.width, d.height, 0, y0);
      VIEWS.forEach((v, k) => drawPoints(ctx, home.image.data as Float32Array, rgb, d.width, d.height, v, PANEL * (k + 1), y0));
      ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif';
      ctx.fillText(`${label}${label === 'moge' && !d.moge ? ' (FELL BACK to default chain)' : ''}${faceRelief ? ' +face relief' : ''}`, 6, y0 + 16);
      diag[label] = { width: d.width, height: d.height, faceRelief, metric: !!d.metricGeometry, moge: d.moge ?? null };
    }
    ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif';
    ctx.fillText(`depth | front 0° | 45° | 90° side  —  ${url.split('/').pop()}`, 6, 16);
    results.push({ url, defaultMs: defMs, defaultDevice: defDevice, mogeMs, mogeDevice, ...diag, png: canvas.toDataURL('image/png') });
  }
  return results;
}
