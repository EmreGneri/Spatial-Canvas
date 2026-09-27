// SENTETİK KLİP — tarayıcı tarafı. `sentetikSahne`/`sentetikCizim` ile
// yan-bakış GT'li orman yolu klibini üretir: her kare `yolPozu(i/(n-1))`
// pozuyla çizilir, mediabunny ile VP9/WebM'e kodlanır. Sonuç
// `window.__klip` (webm + gt.json) ve `window.__onizleme` (baş/orta/son PNG)
// üzerinden `scripts/sentetik-klip.mjs`'e (Playwright) verilir.
//
// `bench/` üretim build'ine girmez — yalnız Vite dev sunucusu üzerinden,
// bu betikle sürülür.
import { yolPozu, VARSAYILAN_TOHUM, SAHNE_GENISLIK, SAHNE_YUKSEKLIK } from '../src/bench/sentetikSahne.ts';
import { ciz } from '../src/bench/sentetikCizim.ts';

const FPS = 30;
const SURE_SN = 12;
const KARE_SAYISI = Math.round(FPS * SURE_SN); // 360

interface GtKare { t: number; R: number[]; tv: number[]; f: number; cx: number; cy: number }
interface Gt { tohum: number; w: number; h: number; fps: number; kareler: GtKare[] }

const gunluk = document.getElementById('log');
function yaz(metin: string): void {
  if (gunluk) gunluk.textContent = metin;
  console.log(metin);
}

/** ArrayBuffer -> base64, çağrı yığınını taşırmadan (parça parça String.fromCharCode). */
function taban64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const PARCA = 0x8000;
  for (let i = 0; i < bytes.length; i += PARCA) {
    binary += String.fromCharCode(...bytes.subarray(i, i + PARCA));
  }
  return btoa(binary);
}

function pngVer(img: ImageData): string {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

async function calistir(): Promise<void> {
  const w = SAHNE_GENISLIK;
  const h = SAHNE_YUKSEKLIK;
  const n = KARE_SAYISI;

  const kodlamaTuvali = document.createElement('canvas');
  kodlamaTuvali.width = w;
  kodlamaTuvali.height = h;
  const kctx = kodlamaTuvali.getContext('2d', { willReadFrequently: true });
  if (!kctx) throw new Error('2D canvas unavailable');

  // @ts-expect-error vendored JS, tip dosyası yok
  const mb = await import('/src/vendor/splat.js/vendor/mediabunny.min.mjs');
  const hedef = new mb.BufferTarget();
  const cikti = new mb.Output({ format: new mb.WebMOutputFormat(), target: hedef });
  const kaynak = new mb.CanvasSource(kodlamaTuvali, { codec: 'vp9', bitrate: 12_000_000 });
  cikti.addVideoTrack(kaynak, { frameRate: FPS });
  await cikti.start();

  const kareler: GtKare[] = [];
  let bas = '';
  let orta = '';
  let son = '';

  const t0 = performance.now();
  try {
    for (let i = 0; i < n; i++) {
      const t01 = i / (n - 1);
      const k = yolPozu(t01);
      const img = ciz(k, VARSAYILAN_TOHUM);
      kctx.putImageData(img, 0, 0);
      await kaynak.add(i / FPS, 1 / FPS);
      kareler.push({ t: i / FPS, R: k.R, tv: k.t, f: k.f, cx: k.cx, cy: k.cy });
      if (i === 0) bas = pngVer(img);
      if (i === 180) orta = pngVer(img);
      if (i === n - 1) son = pngVer(img);
      if (i % 30 === 0) yaz(`kare ${i}/${n} · ${Math.round(performance.now() - t0)} ms`);
    }
    kaynak.close();
    await cikti.finalize();
  } catch (e) {
    await cikti.cancel().catch(() => undefined);
    throw e;
  }

  const gt: Gt = { tohum: VARSAYILAN_TOHUM, w, h, fps: FPS, kareler };
  const webm = taban64(hedef.buffer);
  (window as unknown as { __klip: unknown }).__klip = { webm, gt };
  (window as unknown as { __onizleme: unknown }).__onizleme = { bas, orta, son };
  yaz(`tamam: ${n} kare, ${hedef.buffer.byteLength} bayt, ${Math.round(performance.now() - t0)} ms`);
}

calistir().catch((e: unknown) => {
  const mesaj = e instanceof Error ? (e.stack ?? e.message) : String(e);
  console.error(e);
  yaz(`HATA: ${mesaj}`);
  (window as unknown as { __klipHata: unknown }).__klipHata = mesaj;
});
