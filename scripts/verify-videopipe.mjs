/**
 * GÜN 7 KABLOSU — videoPipe (App bağlantısı) saf fonksiyon testi.
 *
 * captureKeyframes DOM'a bağımlı (canvas/video) — tarayıcıda elle doğrulanır
 * (localhost). Burada SAF zincir ölçülür: buildFusionScene (flow → poz →
 * füzyon; sentetik karelerle) + fitBufferToCamera (kamera uyum ölçeği).
 *
 * Dürüstlük kolları: (a) durağan kareler → poz kazanılamaz → ölçek yok,
 * d_pred'in KENDİ ölçeğinde splat üretilir (scale: null — sessiz ölçek
 * varsayımı YOK); (b) fit: ağırlık merkezi → orijin, köşegen → 2, b.w aynı
 * çarpanla ölçeklenir (iç tutarlılık).
 * Math.random YOK — gürültü mulberry32.
 */
import { buildFusionScene, fitBufferToCamera, KEYFRAME_HEIGHT, KEYFRAME_WIDTH } from '../src/engine/vision/videoPipe.ts';

const W = KEYFRAME_WIDTH;
const H = KEYFRAME_HEIGHT;

let failures = 0;
function check(name, ok) {
  if (!ok) failures++;
  console.log(`${ok ? 'OK' : 'HATA'} · ${name}`);
}

// ── Sentetik kareler (deterministik; piksel başına mulberry32) ──────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sert köşeli + yatay kayma içeren sentetik luminance/rgb karesi.
 *  8px hücreler deterministik rastgele gri + renk (Shi-Tomasi'nin köşe
 *  bulabilmesi için 2 boyutta gradyan — tek yönlü şeritler köşe değildir). */
function synthFrame(shift, seed = 42) {
  const rnd = mulberry32(seed);
  const lum = new Float32Array(W * H);
  const rgb = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y += 8) {
    for (let x = 0; x < W; x += 8) {
      const v = 0.15 + 0.8 * rnd();
      const r = 0.3 + 0.7 * rnd();
      const g = 0.3 + 0.7 * rnd();
      const b = 0.3 + 0.7 * rnd();
      const sx = (x - shift + (W << 2)) % W;
      for (let dy = 0; dy < 8 && y + dy < H; dy++) {
        for (let dx = 0; dx < 8 && sx + dx < W; dx++) {
          lum[(y + dy) * W + (sx + dx)] = v;
          const o = ((y + dy) * W + (sx + dx)) * 3;
          rgb[o] = r;
          rgb[o + 1] = g;
          rgb[o + 2] = b;
        }
      }
    }
  }
  return { lum, rgb };
}

function uniformFrame(v) {
  const lum = new Float32Array(W * H);
  const rgb = new Float32Array(W * H * 3);
  lum.fill(v);
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = v;
    rgb[i * 3 + 1] = v;
    rgb[i * 3 + 2] = v;
  }
  return { lum, rgb };
}

// ── fitBufferToCamera ───────────────────────────────────────────────────────
{
  const make = (count) => {
    const out = {
      a: new Float32Array(count * 4),
      b: new Float32Array(count * 4),
      c: new Float32Array(count * 4),
      keyframeIndex: new Uint16Array(count),
      count,
    };
    for (let i = 0; i < count; i++) {
      out.a[i * 4] = (i % 3) + 10;
      out.a[i * 4 + 1] = (i % 5) - 7;
      out.a[i * 4 + 2] = i * 0.5 + 2;
      out.a[i * 4 + 3] = 1;
      out.b[i * 4 + 3] = 0.25;
    }
    return out;
  };
  const src = make(60);
  const fit = fitBufferToCamera(src);
  // Merkezleme: ortalamalar 0'a yakın.
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < fit.count; i++) {
    cx += fit.a[i * 4]; cy += fit.a[i * 4 + 1]; cz += fit.a[i * 4 + 2];
  }
  cx /= fit.count; cy /= fit.count; cz /= fit.count;
  check('fit: ağırlık merkezi → orijin', Math.abs(cx) < 1e-6 && Math.abs(cy) < 1e-6 && Math.abs(cz) < 1e-6);
  // Köşegen: maks |p−c| = 1.
  let maxR = 0;
  for (let i = 0; i < fit.count; i++) {
    const dx = fit.a[i * 4] - cx, dy = fit.a[i * 4 + 1] - cy, dz = fit.a[i * 4 + 2] - cz;
    const r = Math.hypot(dx, dy, dz);
    if (r > maxR) maxR = r;
  }
  check('fit: köşegen → 2 (maks uzaklık 1)', Math.abs(maxR - 1) < 1e-6);
  // b.w orantı: tüm yarıçaplar aynı çarpanla ölçeklenmiş.
  const k = fit.b[3] / src.b[3];
  check('fit: b.w konumla aynı çarpan', Math.abs(fit.b[7] / src.b[7] - k) < 1e-9 && k > 0);
  check('fit: kaynak değişmedi', src.a[0] === 10 && src.a[2] === 2 && src.b[3] === 0.25);
  check('fit: boş buffer', fitBufferToCamera({ a: new Float32Array(0), b: new Float32Array(0), c: new Float32Array(0), keyframeIndex: new Uint16Array(0), count: 0 }).count === 0);
}

// ── buildFusionScene: durağan kareler → dürüst ölçek kolu ───────────────────
{
  const u = uniformFrame(0.5);
  const stat = [0, 1, 2, 3].map((i) => ({ timeMs: i * 250, lum: u.lum, rgb: u.rgb }));
  const s1 = buildFusionScene(stat);
  check('durağan: splat üretilir (d_pred ölçeği)', s1.data.count > 0);
  check('durağan: ölçek yok (scale null)', s1.scale === null);
  check('durağan: pozlar kimlik zinciri olarak döner', s1.poses.length === 4 && s1.stats.poseFails >= 0);
}

// ── buildFusionScene: hareketli (kayma) kareler ─────────────────────────────
{
  const mov = [0, 6, 12, 18].map((sh, i) => ({ timeMs: i * 250, ...synthFrame(sh) }));
  const s2 = buildFusionScene(mov);
  check('hareketli: flow izleri bulundu', s2.stats.flowMatches > 100);
  check('hareketli: splat üretildi', s2.data.count > 0);
  check('hareketli: buffer sözleşmesi (keyframeIndex aralık içi)', s2.data.keyframeIndex[s2.data.count - 1] < mov.length);
  console.log(`  bilgi: ${s2.stats.flowMatches} eşleşme · ${s2.data.count} splat · ölçek ${s2.scale ? `a=${s2.scale.scaleA.toFixed(3)} b=${s2.scale.scaleB.toFixed(3)}` : 'yok'}`);
}

console.log(failures === 0 ? 'OK video boru hattı kablosu (Gün 7, App bağlantısı)' : `${failures} HATA`);
process.exit(failures === 0 ? 0 : 1);