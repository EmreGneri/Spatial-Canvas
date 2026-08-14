// GÜN D/1 — sentetik lab sahnesi. Eval harness (scripts/eval.mjs) ve
// verify-eval.mjs bu sahnede mevcut video depth boru hattının çekirdeğini
// ölçer. Kesme sırası (D.7): gerçek veri kümesi metrikleri gelene kadar
// ground-truth sentetiktir — deterministik olması zorunlu (aynı girdi, aynı
// hesap; test doğrular).

import { FLOW_HEIGHT, FLOW_WIDTH } from './flow.ts';

export interface SyntheticLab {
  luminance: Float32Array;
  gtDepth: Float32Array;
  gtFg: Float32Array;
  width: number;
  height: number;
}

/** Sol yarı NET ön plan (2px şerit — yüksek gradyan enerjisi), sağ yarı FLU
 *  arka plan (aynı min/max [0.15, 0.85] ve aynı parlaklık ortalaması 0.5,
 *  düşük frekans sinüs — gradyan enerjisi ~0). GT derinlik: sol 0.85, sağ 0.3,
 *  keskin sınır x = W/2. İki yarının parlaklık istatistikleri aynı olduğu için
 *  parlaklık vekili çözüm ÜRETEMEZ; yalnızca netlik (defocus) ipucu ayırır —
 *  focusBoost kolunun kanıtı (focus kapalıyken AbsRel/IoU kötüdür). */
export function makeSyntheticLab(width = 128, height = 128): SyntheticLab {
  const n = width * height;
  const luminance = new Float32Array(n);
  const gtDepth = new Float32Array(n);
  const gtFg = new Float32Array(n);
  const mid = Math.floor(width / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const net = x < mid;
      luminance[i] = net
        ? Math.floor(x / 2) % 2 === 0
          ? 0.85
          : 0.15
        : 0.5 + 0.35 * Math.sin((2 * Math.PI * x) / 16);
      gtDepth[i] = net ? 0.85 : 0.3;
      gtFg[i] = net ? 1 : 0;
    }
  }
  return { luminance, gtDepth, gtFg, width, height };
}

/**
 * GÜN 2 — küçük özne lab sahnesi: merkezde alanın ~%17'sini kaplayan daire
 * (kompakt özne; importanceSampling kolunun kanıtı: grid noktaları ön plana
 * yoğunlaşınca foregroundPointShare artar). GT derinlik: ön plan 0.8, arka
 * plan 0.2; GT fg maskesi daire içi. Deterministik (textel merkezi dairede
 * mi — kayan nokta yok).
 */
export function makeSmallSubjectLab(width = 128, height = 128): SyntheticLab {
  const n = width * height;
  const luminance = new Float32Array(n);
  const gtDepth = new Float32Array(n);
  const gtFg = new Float32Array(n);
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.floor(0.24 * Math.min(width, height)); // 128²'de r=30 → %17.3
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const fg = dx * dx + dy * dy <= r * r;
      luminance[i] = fg ? 0.8 : 0.2;
      gtDepth[i] = fg ? 0.8 : 0.2;
      gtFg[i] = fg ? 1 : 0;
    }
  }
  return { luminance, gtDepth, gtFg, width, height };
}

// ---------------------------------------------------------------------------
// GÜN 3 — D.6: sentetik akış sahnesi (MADDE 3). Optik akış boru hattı
// (flow.ts) bu dokularda ölçülür (verify-flow.mjs): pan/rotate alt-piksel
// doğruluğu, status=0 yolları, determinizm. Tüm dokular deterministik
// formüllerle üretilir (Math.random YOK).
// ---------------------------------------------------------------------------

/**
 * Zengin gradyanlı, PERİYODİK OLMAYAN deterministik doku — köşe tespiti
 * için yeterli kontrast. Hash-gürültüsü + 2× 3×3 kutu filtresi + min-max
 * normalize [0,1]: her piksel biricik, HİÇBİR piramit seviyesinde periyot
 * YOK → LK "hizalı kaçış" (aliasing) bandı hiçbir ölçekte açılmaz.
 * Ölçüm gerekçesi (2026-08-14): asimetrik sinüs karışımı (0.06..0.13 rad/px)
 * KABA seviyede 4× çarpanla pencereye yeniden çakışıyordu (0.13·4 =
 * 0.52 rad/px → periyot 12 px ≈ pencere 15 px) — rotate geçişi 37/500'e
 * takılı kaldı, başarısız köşelerin HAM hatası ~6-8 px (gerçek ıraksama).
 * Gürültü dokusu her seviyede tek minimum bırakır: 3 seviyeli (default)
 * piramitte θ=0.01 rotate: çerçeve-içi köşelerde %95 geçiş (263/276),
 * status=0 kalanların ham hatası ≤ 1.6 px (küçük piksel mertebesi —
 * "birkaç piksel" IRAKSAMA YOK); 500'ün tamamında 263/500: kalan 237 köşe
 * kaba seviyede (seviye2 pencere ±7 = ±28 gerçek px) çerçeve bandına
 * düşer → lkLevel pencere-taşması status=0 yolu (belgeli LK davranışı).
 */
export function makeFlowTexture(width = FLOW_WIDTH, height = FLOW_HEIGHT): Float32Array {
  const n = width * height;
  // Deterministik hash gürültüsü (Math.random YOK — 32-bit karıştırıcı).
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let h = (i * 2654435761) >>> 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    raw[i] = (h >>> 0) / 4294967295;
  }
  // Kenar kelepçeli ayrılabilir 3×3 kutu filtresi — 2 geçiş: korelasyon
  // uzunluğu ~3-4 px (köşe üretecek yapı), periyot yine de yok.
  let a = raw;
  for (let k = 0; k < 2; k++) {
    const tmp = new Float32Array(n);
    const out2 = new Float32Array(n);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - 1);
        const x1 = Math.min(width - 1, x + 1);
        tmp[y * width + x] = (a[y * width + x0] + a[y * width + x] + a[y * width + x1]) / 3;
      }
    }
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(height - 1, y + 1);
      for (let x = 0; x < width; x++) {
        out2[y * width + x] = (tmp[y0 * width + x] + tmp[y * width + x] + tmp[y1 * width + x]) / 3;
      }
    }
    a = out2;
  }
  // Min-max normalize → [0,1] (korelasyon ve aralık dokudan bağımsız).
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < n; i++) {
    if (a[i] < mn) mn = a[i];
    if (a[i] > mx) mx = a[i];
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (a[i] - mn) / (mx - mn);
  return out;
}

/** Kenar kelepçeli bilinear örnekleyici — flow.ts/flow'taki bilinear'dan
 *  bağımsız küçük helper (alt-piksel konumlar için; taşma en yakın kenar
 *  pikseline sabitlenir). */
function sampleBilinear(tex: Float32Array, w: number, h: number, x: number, y: number): number {
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const a = tex[y0 * w + x0];
  const b = tex[y0 * w + x1];
  const c = tex[y1 * w + x0];
  const d = tex[y1 * w + x1];
  return a + (b - a) * fx + (c - a) * fy + (d - b - c + a) * fx * fy;
}

/** Kaynak dokuyu (dx, dy) kadar BİLİNEAR kaydırır (alt-piksel dx/dy
 *  destekler — 3.2/−1.7 gerçek alt-piksel kaymadır). Taşan kısım en yakın
 *  kenar pikseline kelepçelenir; sarma/wrap YOK (gerçek sahne: kadraj
 *  dışından yeni veri GELMEZ — kenarda görüntü "sürüklenir"). */
export function panTexture(tex: Float32Array, w: number, h: number, dx: number, dy: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = sampleBilinear(tex, w, h, x - dx, y - dy);
    }
  }
  return out;
}

/** Kaynak dokuyu görüntü MERKEZİ (w/2, h/2) etrafında angleRad döndürür —
 *  bilinear örnekleme, kenar kelepçeli. Tanımlı kullanım: θ=0.01 rad
 *  (çerçeve köşesinde max ~1.7 px kayma — 60 fps kamera hareketiyle aynı
 *  mertebe). 0.05 rad denenemez: çerçeve köşesinde 8.3 px kayma LK
 *  yakınsama küresini aşıyor (2026-08-14 ölçümü: ~yarı köşe 5-8 px gerçek
 *  ıraksama) — büyük açı test EDİLMEZ, LK'nın bilinen sınırı, bug değil. */
export function rotateTexture(tex: Float32Array, w: number, h: number, angleRad: number): Float32Array {
  const cx = w / 2;
  const cy = h / 2;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rx = x - cx;
      const ry = y - cy;
      out[y * w + x] = sampleBilinear(tex, w, h, cx + rx * cos - ry * sin, cy + rx * sin + ry * cos);
    }
  }
  return out;
}