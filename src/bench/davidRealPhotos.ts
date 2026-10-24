// DAViD insan derinliği — gerçek fotoğraflarda niteliksel kıyas (yer gerçeği YOK).
// Varsayılan fotoğraf zinciri vs aynı zincir + DAViD füzyonu (`?derinlik=david`),
// motorun kendi konum örnekleyicisiyle 0° / 45° / 90° ortografik çizimler.
// Çizim yardımcıları mogeRealPhotos.ts ile aynı sözleşme (ortografik, Y ekseni etrafında).
import { estimateDepth, FOTO_KALITE, depthDevice, type DepthResult } from '../depth.ts';
import { createHomeTexture, fillPositionsFromDepth, POINTS_DEPTH_RANGE, POINTS_WORLD_HEIGHT, POSITION_TEXTURE_SIZE } from '../engine/buffers.ts';
import { segmentForeground } from '../engine/reconstruction/segmentation.ts';
import { resampleBilinear } from '../engine/reconstruction/silhouette.ts';
import { subjectZSpan } from '../engine/reconstruction/sampler.ts';
import { yuzRolyefHaritasi, yuzRolyefiUygula } from '../engine/reconstruction/yuzRolyef.ts';
import { yuzNoktalari } from '../engine/vision/yuzTespit.ts';

const PANEL = 420, VIEWS = [0, 45, 90];

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(`image load failed: ${url}`));
    img.src = url;
  });
}

async function sha256(data: Float32Array) {
  const h = await crypto.subtle.digest('SHA-256', data.slice().buffer);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Varsayılan yolun (App ile aynı çağrı: FOTO_KALITE + özne maskesi) derinlik özeti. */
export async function varsayilanHash(urls: string[]) {
  const out = [];
  for (const url of urls) {
    const img = await loadImage(url);
    const seg = await segmentForeground(img, 'webgpu', 'foto');
    const d = await estimateDepth(img, { ...FOTO_KALITE, subjectMask: { data: seg.mask, width: seg.width, height: seg.height } });
    out.push({ url, device: depthDevice, width: d.width, height: d.height, sha256: await sha256(d.data) });
  }
  return out;
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

/** Özne (alfa ≥ 0.5) merkezi ve ön görünüm yarı genişliği: kadraj özneye oturur. */
function kadraj(home: Float32Array) {
  let sx = 0, sy = 0, sz = 0, k = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let o = 0; o < home.length; o += 4) {
    if (home[o + 3] < 0.5) continue;
    sx += home[o]; sy += home[o + 1]; sz += home[o + 2]; k++;
    x0 = Math.min(x0, home[o]); x1 = Math.max(x1, home[o]); y0 = Math.min(y0, home[o + 1]); y1 = Math.max(y1, home[o + 1]);
  }
  return k ? { c: [sx / k, sy / k, sz / k], half: 0.55 * Math.max(x1 - x0, y1 - y0) } : { c: [0, 0, 0], half: 1.7 };
}

function drawPoints(ctx: CanvasRenderingContext2D, home: Float32Array, rgb: Uint8ClampedArray, w: number, h: number, deg: number, ox: number, oy: number, half: number) {
  const n = POSITION_TEXTURE_SIZE, phi = deg * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const img = ctx.getImageData(ox, oy, PANEL, PANEL), zbuf = new Float32Array(PANEL * PANEL).fill(-Infinity);
  const { c } = kadraj(home);
  for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
    const o = (gy * n + gx) * 4, a = home[o + 3];
    if (a < 0.5) continue; // yalnız özne: arka plan levhası yan görünümde kişiyi örtüyordu
    const [x, y, z] = [home[o] - c[0], home[o + 1] - c[1], home[o + 2] - c[2]];
    const u = x * cp - z * sp, key = x * sp + z * cp;
    const px = Math.round((u + half) / (2 * half) * PANEL), py = Math.round((half - y) / (2 * half) * PANEL);
    const si = Math.min(h - 1, Math.floor((gy + .5) / n * h)) * w + Math.min(w - 1, Math.floor((gx + .5) / n * w));
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
      const X = px + dx, Y = py + dy;
      if (X < 0 || Y < 0 || X >= PANEL || Y >= PANEL || zbuf[Y * PANEL + X] >= key) continue;
      zbuf[Y * PANEL + X] = key;
      for (let c = 0; c < 3; c++) img.data[(Y * PANEL + X) * 4 + c] = rgb[si * 4 + c];
    }
  }
  ctx.putImageData(img, ox, oy);
}

async function adaptor() {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> } }).gpu;
  const i = (await gpu?.requestAdapter())?.info;
  return i ? { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description } : null;
}

export async function runDavidRealPhotos(urls: string[], progress: (m: string) => void = console.log) {
  const results = [];
  const gpu = await adaptor();
  for (const url of urls) {
    progress(`photo ${url}`);
    const img = await loadImage(url);
    const seg = await segmentForeground(img, 'webgpu', 'foto');
    const opts = { ...FOTO_KALITE, subjectMask: { data: seg.mask, width: seg.width, height: seg.height } };
    let t = performance.now();
    const def = await estimateDepth(img, opts);
    const defMs = performance.now() - t, defDevice = depthDevice;
    t = performance.now();
    const dav = await estimateDepth(img, { ...opts, insanDerinligi: 'david' });
    const davMs = performance.now() - t;
    const yuz = await yuzNoktalari(img);

    const rows: [string, DepthResult, boolean][] = [['default', def, true], ['david', dav, true], ['david', dav, false]];
    const canvas = document.createElement('canvas');
    canvas.width = PANEL * (1 + VIEWS.length); canvas.height = PANEL * rows.length + 24;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    let half = 0;
    for (const [r, [label, d, rolyefIstegi]] of rows.entries()) {
      const mask = d.subjectMask ?? resampleBilinear(seg.mask, seg.width, seg.height, d.width, d.height);
      let depth = d.data;
      const rol = rolyefIstegi && yuz ? yuzRolyefHaritasi(yuz.noktalar, d.width, d.height, 1.5) : null;
      if (rol) {
        // App/Engine ile aynı: yüz rölyefi ×1.5 örneklemeden önce (kırpma atlandı).
        const halfH = POINTS_WORLD_HEIGHT / 2;
        const zSpan = subjectZSpan(depth, d.width, d.height, mask, halfH, POINTS_DEPTH_RANGE);
        depth = yuzRolyefiUygula(depth, d.width, d.height, rol, zSpan * d.height / (2 * halfH));
      }
      const home = createHomeTexture();
      fillPositionsFromDepth(home, depth, d.width, d.height, { foregroundMask: mask, blend: 1, importanceSampling: false });
      const rgb = pixels(img, d.width, d.height);
      const y0 = 24 + r * PANEL;
      drawDepth(ctx, depth, d.width, d.height, 0, y0);
      half ||= kadraj(home.image.data as Float32Array).half; // tüm satırlar varsayılanın ölçeğinde
      VIEWS.forEach((v, k) => drawPoints(ctx, home.image.data as Float32Array, rgb, d.width, d.height, v, PANEL * (k + 1), y0, half));
      ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif';
      const dusus = label === 'david' && !d.david ? ' (FELL BACK: no fusion)' : '';
      ctx.fillText(`${label}${dusus}${rol ? ' +face relief' : ' no face relief'}`, 6, y0 + 16);
    }
    ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif';
    ctx.fillText(`depth | front 0° | 45° | 90° side  —  ${url.split('/').pop()}`, 6, 16);
    results.push({ url, gpu, defaultMs: defMs, defaultDevice: defDevice, davidMs: davMs, david: dav.david ?? null,
      defaultSha256: await sha256(def.data), png: canvas.toDataURL('image/png') });
  }
  return results;
}
