// SENTETİK ORMAN YOLU — three.js çizimi.
//
// `sentetikSahne.ts`'in verdiği saf sahne tanımını three.js nesnelerine
// çevirir ve verilen `GsKamera`'yı `hizalama.ts`'in `threeMatrisleri`'i ile
// BİREBİR kurar (`matrixAutoUpdate = false`, view/projection doğrudan
// atanır) — GT render'ı splat.js'in gördüğü kamerayla piksel piksel aynı
// olur. Işık sabit (ambient + tek yönlü), gölge yok, sis yok: aynı poz her
// çağrıda aynı görüntüyü üretir (deterministik GT).
//
// Dokular SIFT/ORB gibi eşleştiricilerin tutunacağı yüksek frekanslı, çok
// ölçekli detay taşımak zorunda — özellikle zemin (yakın alan, ileri
// yürüyüşün ıraksama/paralaks kaynağı) ve gövde kabuğu. Zemin ve fon TEK
// (döşenmeyen) büyük bir tuvale çizilir: tekrar deseni SIFT için yanıltıcı
// (aynı yama farklı yerlerde eşleşir) olduğundan `RepeatWrapping` kullanılmaz.
import * as THREE from 'three';
import { threeMatrisleri } from '../engine/reconstruction/hizalama.ts';
import type { GsKamera } from '../engine/reconstruction/egitim3dgs.ts';
import {
  ZEMIN_Y, VARSAYILAN_TOHUM, mulberry32, sahneTanimi, type Vec3,
} from './sentetikSahne.ts';

const YAKIN = 0.05;
const UZAK = 200;

function clamp8(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Ortak doku iskeleti: tohumlu bir 2D canvas üzerine çizer, `CanvasTexture` döner. */
function dokuOlustur(
  genislik: number, yukseklik: number, tohum: number,
  ciz: (ctx: CanvasRenderingContext2D, rng: () => number, w: number, h: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = genislik;
  c.height = yukseklik;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for procedural texture');
  ciz(ctx, mulberry32(tohum), genislik, yukseklik);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Ağaç kabuğu: dikey lifler + onları kesen yatay çatlaklar (kesişim =
 * köşe, aperture sorununu çözer), liken/yosun lekeleri (soluk yeşil/gri),
 * çok sayıda değişik boyutta budak — gövde yüzeyinin HER yerinde köşe var.
 */
function govdeDokusu(renk: Vec3, tohum: number): THREE.CanvasTexture {
  const W = 256, H = 1024;
  return dokuOlustur(W, H, tohum, (ctx, rng) => {
    const [r, g, b] = renk.map((v) => Math.round(v * 255));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, W, H);

    // Dikey lifler.
    for (let i = 0; i < 520; i++) {
      const x = rng() * W;
      const y0 = rng() * H;
      const uzunluk = 30 + rng() * 220;
      const kalinlik = 0.6 + rng() * 3;
      const yon = rng() < 0.5 ? -1 : 1;
      const miktar = yon * (18 + rng() * 50);
      ctx.strokeStyle = `rgba(${clamp8(r + miktar)},${clamp8(g + miktar * 0.8)},${clamp8(b + miktar * 0.6)},${0.3 + rng() * 0.45})`;
      ctx.lineWidth = kalinlik;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x + (rng() - 0.5) * 10, y0 + uzunluk);
      ctx.stroke();
    }
    // Yatay/eğik çatlaklar: dikey liflerle kesişip her yerde köşe üretir.
    for (let i = 0; i < 220; i++) {
      const x0 = rng() * W;
      const y = rng() * H;
      const uzunluk = 12 + rng() * 60;
      const egim = (rng() - 0.5) * 0.7;
      const miktar = -(20 + rng() * 40);
      ctx.strokeStyle = `rgba(${clamp8(r + miktar)},${clamp8(g + miktar * 0.8)},${clamp8(b + miktar * 0.5)},${0.35 + rng() * 0.4})`;
      ctx.lineWidth = 0.6 + rng() * 1.8;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + uzunluk, y + uzunluk * egim);
      ctx.stroke();
    }
    // Budaklar: çok sayıda, geniş boyut aralığı.
    for (let i = 0; i < 26; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const rr = 2 + rng() * rng() * 22;
      ctx.fillStyle = `rgba(${clamp8(r - 55)},${clamp8(g - 42)},${clamp8(b - 26)},${0.6 + rng() * 0.3})`;
      ctx.beginPath();
      ctx.ellipse(x, y, rr, rr * (1.2 + rng() * 0.8), rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
      if (rr > 6) {
        ctx.fillStyle = `rgba(${clamp8(r - 80)},${clamp8(g - 60)},${clamp8(b - 35)},0.7)`;
        ctx.beginPath();
        ctx.ellipse(x, y, rr * 0.4, rr * 0.6, rng() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Liken/yosun lekeleri: soluk yeşil-gri, pütürlü kenarlı kümeler.
    for (let küme = 0; küme < 34; küme++) {
      const cx = rng() * W;
      const cy = rng() * H;
      const parca = 5 + Math.floor(rng() * 9);
      const acik = rng() < 0.5;
      for (let i = 0; i < parca; i++) {
        const dx = (rng() - 0.5) * 26;
        const dy = (rng() - 0.5) * 26;
        const rr = 1.5 + rng() * 5;
        const ton: [number, number, number] = acik ? [178, 188, 160] : [120, 128, 118];
        ctx.fillStyle = `rgba(${ton[0]},${ton[1]},${ton[2]},${0.18 + rng() * 0.28})`;
        ctx.beginPath();
        ctx.arc(cx + dx, cy + dy, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

/** Çalı yaprağı: benekli yeşil, orta frekans. */
function caliDokusu(renk: Vec3, tohum: number): THREE.CanvasTexture {
  return dokuOlustur(160, 160, tohum, (ctx, rng, W, H) => {
    const [r, g, b] = renk.map((v) => Math.round(v * 255));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 750; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const rr = 1 + rng() * 3.6;
      const ton = 40 * (rng() - 0.5);
      ctx.fillStyle = `rgba(${clamp8(r + ton)},${clamp8(g + ton)},${clamp8(b + ton * 0.6)},${0.35 + rng() * 0.45})`;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/**
 * Zemin: TEK büyük (döşenmeyen) tuval — orta tonlu toprak zemin üstünde çok
 * ölçekli çakıl/taş (1–20 px), düşmüş yaprak lekeleri (sarı/turuncu/kızıl/
 * kahve), ince dallar (kısa koyu çizgiler) ve açık/koyu toprak yamaları.
 * Ortalama parlaklık orta düzeyde tutulur (yalnız koyu değil).
 */
function zeminDokusu(tohum: number, genislikM: number, derinlikM: number): THREE.CanvasTexture {
  const TEMEL = 2048;
  const W = TEMEL;
  const H = Math.max(64, Math.round(TEMEL * (derinlikM / genislikM)));
  return dokuOlustur(W, H, tohum, (ctx, rng) => {
    // Orta tonlu toprak taban (önceki koyu #6b5a45'ten daha açık).
    ctx.fillStyle = '#8a7355';
    ctx.fillRect(0, 0, W, H);

    // Büyük ölçek: açık/koyu toprak yamaları (yumuşak, düşük opaklık).
    for (let i = 0; i < 260; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const rr = 30 + rng() * 150;
      const acik = rng() < 0.55;
      const miktar = (acik ? 1 : -1) * (14 + rng() * 26);
      ctx.fillStyle = `rgba(${clamp8(138 + miktar)},${clamp8(115 + miktar * 0.9)},${clamp8(85 + miktar * 0.7)},${0.12 + rng() * 0.16})`;
      ctx.beginPath();
      ctx.ellipse(x, y, rr, rr * (0.5 + rng() * 0.7), rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    // Çok ölçekli çakıl/taş: yüksek kontrast, açık VE koyu, 1–20 px.
    const olcekler: [number, number][] = [
      [42000, 1.4], [16000, 3], [5200, 6], [1400, 11], [320, 18],
    ];
    for (const [adet, boyut] of olcekler) {
      for (let i = 0; i < adet; i++) {
        const x = rng() * W;
        const y = rng() * H;
        const rr = boyut * (0.35 + rng() * 0.9);
        const parlak = rng() < 0.5;
        const miktar = (parlak ? 1 : -1) * (35 + rng() * 55);
        const ton: [number, number, number] = [
          clamp8(138 + miktar), clamp8(115 + miktar * 0.85), clamp8(85 + miktar * 0.6),
        ];
        ctx.fillStyle = `rgba(${ton[0]},${ton[1]},${ton[2]},${0.55 + rng() * 0.4})`;
        ctx.beginPath();
        ctx.ellipse(x, y, rr, rr * (0.65 + rng() * 0.6), rng() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Düşmüş yapraklar: sarı/turuncu/kızıl/kahve benekler, birkaç piksel-onlarca px.
    const YAPRAK_TONLARI: [number, number, number][] = [
      [212, 168, 52], [200, 120, 40], [150, 60, 40], [110, 78, 40], [176, 140, 46],
    ];
    for (let i = 0; i < 1400; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const rr = 3 + rng() * rng() * 22;
      const [tr, tg, tb] = YAPRAK_TONLARI[(rng() * YAPRAK_TONLARI.length) | 0];
      const varyans = (rng() - 0.5) * 30;
      ctx.fillStyle = `rgba(${clamp8(tr + varyans)},${clamp8(tg + varyans)},${clamp8(tb + varyans * 0.6)},${0.6 + rng() * 0.35})`;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rng() * Math.PI);
      ctx.beginPath();
      ctx.ellipse(0, 0, rr, rr * (0.45 + rng() * 0.3), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // İnce dallar: kısa koyu çizgiler, rastgele açı.
    for (let i = 0; i < 900; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const uzunluk = 8 + rng() * 34;
      const aci = rng() * Math.PI * 2;
      const koyu = 40 + rng() * 30;
      ctx.strokeStyle = `rgba(${clamp8(70 - koyu * 0.3)},${clamp8(55 - koyu * 0.3)},${clamp8(38 - koyu * 0.2)},${0.55 + rng() * 0.3})`;
      ctx.lineWidth = 1 + rng() * 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(aci) * uzunluk, y + Math.sin(aci) * uzunluk);
      ctx.stroke();
    }
  });
}

/**
 * Uzak fon: `yMin`/`yMax` (dünya y-aşağı) plakanın kapladığı gerçek dikey
 * aralık — kamera her zaman ufka bakar (yaw/pitch yok), bu yüzden görünen
 * dilim ufuk çizgisinin (dünya Y=0) HEMEN çevresindeki dar bir banttır; bu
 * bandın canvas satırına karşılık geldiği yer plakanın toplam aralığına göre
 * hesaplanır (yalnızca kaba bir yüzde varsaymak, tepe hattını görünmeyen bir
 * satıra gönderirdi — ilk sürümde olan hata buydu). Ufkun HEMEN üstünde
 * dokulu ağaç çizgisi/tepe silueti, onun üstünde DÜZ gök.
 */
function fonDokusu(tohum: number, yMin: number, yMax: number): THREE.CanvasTexture {
  const W = 1600, H = 800;
  const aralik = yMax - yMin;
  // Satır 0 = dünya Y = yMax (zemin hizası/altı), satır H = dünya Y = yMin
  // (derin gökyüzü): satır = (yMax − Y) / aralik × H.
  const yDanSatir = (Y: number) => ((yMax - Y) / aralik) * H;
  // Ufuk (göz hizası, dünya Y=0) ve ağaç tepelerinin göz hizasının bu kadar
  // yukarısında (negatif Y = yukarı) bittiği satır.
  const ufukSatiri = yDanSatir(0);
  const agacTepeSatiri = yDanSatir(-6);
  const sirtTepeSatiri = yDanSatir(-11);

  return dokuOlustur(W, H, tohum, (ctx, rng) => {
    // Gök: DÜZ gradyan, ağaç tepelerinin üstünden canvas sonuna kadar.
    const grad = ctx.createLinearGradient(0, Math.max(0, sirtTepeSatiri - 40), 0, H);
    grad.addColorStop(0, '#8fb8d8');
    grad.addColorStop(1, '#cfe3f2');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Uzak sırt (soluk, az detaylı — derinlik hissi), ufkun biraz üstünde biter.
    ctx.fillStyle = '#7f9a86';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, sirtTepeSatiri);
    for (let x = 0; x <= W; x += 10) {
      ctx.lineTo(x, sirtTepeSatiri + Math.sin(x * 0.006) * 20 + (rng() - 0.5) * 12);
    }
    ctx.lineTo(W, 0);
    ctx.closePath();
    ctx.fill();

    // Yakın ağaç çizgisi: kümeli, çentikli tepe hattı; tabanı zemin hizasının
    // altına (canvas satır 0'a) kadar iner — orası zaten gerçek zeminle
    // örtülür, önemli olan ufkun HEMEN üstündeki siluet.
    ctx.fillStyle = '#4a6249';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    let y = agacTepeSatiri;
    ctx.lineTo(0, y);
    for (let x = 0; x <= W; x += 6) {
      y += (rng() - 0.5) * 14;
      y = Math.max(agacTepeSatiri - 30, Math.min(ufukSatiri, y));
      // Ağaç tepesi kümeleri: periyodik olmayan çentikler.
      const centik = Math.sin(x * 0.08 + rng()) * 9 * (rng() < 0.3 ? 1 : 0.2);
      ctx.lineTo(x, y - Math.abs(centik));
    }
    ctx.lineTo(W, 0);
    ctx.closePath();
    ctx.fill();

    // Ağaç çizgisi dolgusu içinde yüksek frekanslı köşe/beneklik (gövde
    // aralıkları, ışık-gölge lekeleri) — ufkun hemen üstündeki bant.
    const bandUst = Math.max(0, agacTepeSatiri - 40);
    const bandAlt = ufukSatiri + 20;
    for (let i = 0; i < 5200; i++) {
      const x = rng() * W;
      const yy = bandUst + rng() * (bandAlt - bandUst);
      const koyu = rng() < 0.5;
      const miktar = (koyu ? -1 : 1) * (16 + rng() * 30);
      ctx.fillStyle = `rgba(${clamp8(74 + miktar)},${clamp8(98 + miktar)},${clamp8(73 + miktar * 0.7)},${0.25 + rng() * 0.35})`;
      const rr = 1 + rng() * 4;
      ctx.beginPath();
      ctx.ellipse(x, yy, rr, rr * (0.6 + rng() * 0.6), rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // İnce tekil gürültü (tüm görüntüde, çok hafif) — döşeme yok, tekrar riski yok.
    for (let i = 0; i < 4000; i++) {
      const x = rng() * W;
      const y = rng() * H;
      ctx.fillStyle = `rgba(0,0,0,${rng() * 0.05})`;
      ctx.fillRect(x, y, 1, 1);
    }
  });
}

interface Hazirlik {
  tohum: number;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  aktarimTuvali: HTMLCanvasElement;
  aktarimBaglami: CanvasRenderingContext2D;
}

let hazir: Hazirlik | null = null;

function sahneKur(tohum: number): Hazirlik {
  const veri = sahneTanimi(tohum);

  // Renderer önce kurulur: dokulara azami anizotropik filtreleme uygulanır
  // (zemin kameraya göre dik açıda görülür — anizotropi olmadan mipmap
  // eğik açıda dokuyu bulanıklaştırıp tüm beneği yok eder).
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0xa9cbdf, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const anizotropi = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const yonlu = new THREE.DirectionalLight(0xfff2df, 0.85);
  // y aşağı dünyada "yukarı" negatif y'dir; ışık yüksekten, hafif yandan gelir.
  yonlu.position.set(6, -16, 4);
  yonlu.target.position.set(0, 0, 12);
  scene.add(yonlu);
  scene.add(yonlu.target);

  for (const n of veri.nesneler) {
    if (n.tur === 'govde') {
      const geo = new THREE.CylinderGeometry(n.r, n.r, n.yukseklik, 16, 1, false);
      const tex = govdeDokusu(n.renk, n.dokuTohumu);
      tex.anisotropy = anizotropi;
      const mat = new THREE.MeshLambertMaterial({ map: tex });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(n.x, n.y, n.z);
      scene.add(mesh);
    } else if (n.tur === 'cali') {
      const geo = new THREE.SphereGeometry(n.r, 14, 10);
      const tex = caliDokusu(n.renk, n.dokuTohumu);
      tex.anisotropy = anizotropi;
      const mat = new THREE.MeshLambertMaterial({ map: tex });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(n.x, n.y, n.z);
      scene.add(mesh);
    } else if (n.tur === 'zemin') {
      const genislik = n.xMax - n.xMin;
      const derinlik = n.zMax - n.zMin;
      const geo = new THREE.PlaneGeometry(genislik, derinlik);
      geo.rotateX(Math.PI / 2);
      geo.translate((n.xMin + n.xMax) / 2, ZEMIN_Y, (n.zMin + n.zMax) / 2);
      // Döşenmez: tek büyük tuval, `repeat` = 1×1 (tekrar deseni yok).
      const tex = zeminDokusu(n.dokuTohumu, genislik, derinlik);
      tex.anisotropy = anizotropi;
      const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
      scene.add(new THREE.Mesh(geo, mat));
    } else if (n.tur === 'fon') {
      const genislik = n.xMax - n.xMin;
      const yukseklik = n.yMax - n.yMin;
      const geo = new THREE.PlaneGeometry(genislik, yukseklik);
      geo.translate((n.xMin + n.xMax) / 2, (n.yMin + n.yMax) / 2, n.z);
      const tex = fonDokusu(n.dokuTohumu, n.yMin, n.yMax);
      tex.anisotropy = anizotropi;
      const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
      scene.add(new THREE.Mesh(geo, mat));
    }
  }

  const camera = new THREE.PerspectiveCamera();
  camera.matrixAutoUpdate = false;

  const aktarimTuvali = document.createElement('canvas');
  const aktarimBaglami = aktarimTuvali.getContext('2d', { willReadFrequently: true });
  if (!aktarimBaglami) throw new Error('2D canvas unavailable for GT readback');

  return { tohum, renderer, scene, camera, aktarimTuvali, aktarimBaglami };
}

/**
 * `k`'nin gördüğünü çizer: `threeMatrisleri` ile kamera birebir kurulur
 * (view = matrixWorldInverse, projection doğrudan atanır), sahne `k.w`×`k.h`
 * boyutunda render edilir ve renderer tuvali bir 2D tuvale çizilip geri
 * okunur (WebGL readPixels'in ters satır sırasına takılmamak için).
 */
export function ciz(k: GsKamera, tohum: number = VARSAYILAN_TOHUM): ImageData {
  if (!hazir || hazir.tohum !== tohum) {
    hazir?.renderer.dispose();
    hazir = sahneKur(tohum);
  }
  const { renderer, scene, camera, aktarimTuvali, aktarimBaglami } = hazir;
  renderer.setSize(k.w, k.h, false);

  const { view, proj } = threeMatrisleri(k, YAKIN, UZAK);
  camera.matrixWorldInverse.fromArray(view);
  camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
  camera.projectionMatrix.fromArray(proj);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

  renderer.render(scene, camera);

  aktarimTuvali.width = k.w;
  aktarimTuvali.height = k.h;
  aktarimBaglami.drawImage(renderer.domElement, 0, 0);
  return aktarimBaglami.getImageData(0, 0, k.w, k.h);
}

/** GPU kaynaklarını bırakır; bir sonraki `ciz` çağrısı sahneyi yeniden kurar. */
export function sahneyiKapat(): void {
  if (!hazir) return;
  hazir.scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const anyMat = m as THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;
        anyMat.map?.dispose();
        anyMat.dispose();
      }
    }
  });
  hazir.renderer.dispose();
  hazir = null;
}
