/**
 * 3DGS KAMERASI → EKRAN UZAYI. DOM'suz, Node'dan test edilir.
 *
 * Splat temizleme aracının seçim mantığı (`splatSecim.ts`) three.js
 * sözleşmesiyle çalışır: KOLON-major bir görünüm-izdüşüm matrisi, NDC ve
 * `wClip > 0` ile "kameranın önünde" testi. Eğitim oturumu ise splat.js'in
 * `GsKamera`'sını veriyor: R SATIR sıralı dünya→kamera, COLMAP eksenleri
 * (y AŞAĞI, z İLERİ) ve piksel içsel parametreleri (f, fy, cx, cy, w, h).
 *
 * Bu dosya ikisini birbirine çevirir; aracın geri kalanı iki kaynakta da
 * DEĞİŞMEDEN çalışır.
 *
 * ── TÜRETME ────────────────────────────────────────────────────────────────
 * Kamera uzayı:  p_cam = R·p_world + t,  derinlik = z_cam (COLMAP'te z ileri).
 * Piksel:        u = f·x_cam/z_cam + cx,   v = fy·y_cam/z_cam + cy.
 *
 * `ekranaProjekte` şunu yapıyor:
 *   ekran.x = (clip.x/clip.w · 0.5 + 0.5)·en
 *   ekran.y = (1 − (clip.y/clip.w · 0.5 + 0.5))·boy      (ekran y AŞAĞI)
 *
 * clip.w = z_cam seçilirse (böylece "önde" testi COLMAP derinliğiyle aynı
 * şey olur), u ve v'yi eşitleyip satırlar çıkar:
 *   clip.x = (2f/en)·x_cam + (2·cx/en − 1)·z_cam
 *   clip.y = −(2·fy/boy)·y_cam + (1 − 2·cy/boy)·z_cam     (y aşağı → işaret −)
 *   clip.w = z_cam
 * x_cam/y_cam/z_cam de R'nin satırları olduğundan matris doğrudan yazılır.
 *
 * clip.z KULLANILMIYOR (seçim yalnız x, y, w okur); birim satır bırakıldı —
 * uydurma bir near/far aralığı yazmak, kullanılmayan bir sayıyı gerçekmiş
 * gibi gösterirdi.
 */

import type { GsKamera } from '../engine/reconstruction/egitim3dgs.ts';

/**
 * `GsKamera`'dan KOLON-major (three.js `Matrix4.elements`) görünüm-izdüşüm.
 * Çıktı doğrudan `ekranaProjekte`'ye verilir; kadraj ölçüsü kameranın kendi
 * `w`×`h`'ıdır.
 */
export function gsGorunumIzdusumu(k: GsKamera): Float32Array {
  const fy = k.fy ?? k.f;
  const sx = (2 * k.f) / k.w;
  const sy = (2 * fy) / k.h;
  const ox = (2 * k.cx) / k.w - 1;
  const oy = 1 - (2 * k.cy) / k.h;
  const R = k.R;
  // R satır sıralı: satır0 = R[0..2], satır1 = R[3..5], satır2 = R[6..8].
  const r0 = [R[0], R[1], R[2]];
  const r1 = [R[3], R[4], R[5]];
  const r2 = [R[6], R[7], R[8]];
  const t = k.t;

  // Satırlar (kavramsal), sonra kolon-major yerleşime yazılır.
  const satirX = [
    sx * r0[0] + ox * r2[0], sx * r0[1] + ox * r2[1], sx * r0[2] + ox * r2[2],
    sx * t[0] + ox * t[2],
  ];
  const satirY = [
    -sy * r1[0] + oy * r2[0], -sy * r1[1] + oy * r2[1], -sy * r1[2] + oy * r2[2],
    -sy * t[1] + oy * t[2],
  ];
  const satirW = [r2[0], r2[1], r2[2], t[2]];

  const m = new Float32Array(16);
  // m[kolon*4 + satir]
  m[0] = satirX[0]; m[4] = satirX[1]; m[8] = satirX[2]; m[12] = satirX[3];
  m[1] = satirY[0]; m[5] = satirY[1]; m[9] = satirY[2]; m[13] = satirY[3];
  m[2] = 0; m[6] = 0; m[10] = 1; m[14] = 0; // clip.z kullanılmıyor (yukarı bak)
  m[3] = satirW[0]; m[7] = satirW[1]; m[11] = satirW[2]; m[15] = satirW[3];
  return m;
}

/**
 * Eğitim tuvali `object-fit: contain` ile gösteriliyor: eleman kutusu
 * kameranın en-boy oranından farklıysa kenarlarda boşluk kalır. Seçim
 * imlecin ELEMAN üzerindeki yerinden geliyor, izdüşüm ise KAMERA pikselinde;
 * ikisi arasındaki tek ölçek ve öteleme burada hesaplanır.
 *
 * Contain oranı KORUDUĞU için tek bir `olcek` yeter — x ve y ayrı ayrı
 * ölçeklenseydi fırça dairesi elips olurdu.
 */
export interface KadrajDonusumu {
  /** kamera pikseli → eleman CSS pikseli çarpanı */
  olcek: number;
  /** eleman içindeki sol/üst boşluk (CSS px) */
  dx: number;
  dy: number;
}

export function icerikDonusumu(
  elemanEn: number, elemanBoy: number, kameraEn: number, kameraBoy: number,
): KadrajDonusumu {
  if (!(kameraEn > 0) || !(kameraBoy > 0) || !(elemanEn > 0) || !(elemanBoy > 0)) {
    return { olcek: 1, dx: 0, dy: 0 };
  }
  const olcek = Math.min(elemanEn / kameraEn, elemanBoy / kameraBoy);
  return {
    olcek,
    dx: (elemanEn - kameraEn * olcek) / 2,
    dy: (elemanBoy - kameraBoy * olcek) / 2,
  };
}

/** Eleman CSS noktası → kamera pikseli. */
export function elemandanKameraya(d: KadrajDonusumu, x: number, y: number): { x: number; y: number } {
  return { x: (x - d.dx) / d.olcek, y: (y - d.dy) / d.olcek };
}

/** Kamera pikseli → eleman CSS noktası (vurgu çizimi bunu kullanır). */
export function kameradanElemana(d: KadrajDonusumu, x: number, y: number): { x: number; y: number } {
  return { x: x * d.olcek + d.dx, y: y * d.olcek + d.dy };
}

/**
 * EĞİTİM GAUSSIAN'I → SEÇİM GİRDİSİ.
 *
 * `GaussianState` 16 float/Gaussian taşır (konum 0..2, opaklık LOGIT 13);
 * seçim mantığı ise 4 float/splat ve 0..1 opaklık bekliyor. İndeks sırası
 * KORUNUR: i'inci Gaussian i'inci xyzw girdisi olur, böylece seçimden çıkan
 * indeksler doğrudan `temizle()`ye verilebilir.
 *
 * Opaklık sigmoid'den geçer — `temizle` ölü splat'ı logit −20 yazıyor, o da
 * alfa ≈ 2e-9, yani her makul kapının altında.
 */
export function gaussianlariXyzw(data: Float32Array, n: number, stride = 16): Float32Array {
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const s = i * stride;
    const o = i * 4;
    out[o] = data[s];
    out[o + 1] = data[s + 1];
    out[o + 2] = data[s + 2];
    out[o + 3] = 1 / (1 + Math.exp(-data[s + 13]));
  }
  return out;
}
