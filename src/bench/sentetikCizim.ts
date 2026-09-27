// SENTETİK ORMAN YOLU — three.js çizimi.
//
// `sentetikSahne.ts`'in verdiği saf sahne tanımını three.js nesnelerine
// çevirir ve verilen `GsKamera`'yı `hizalama.ts`'in `threeMatrisleri`'i ile
// BİREBİR kurar (`matrixAutoUpdate = false`, view/projection doğrudan
// atanır) — GT render'ı splat.js'in gördüğü kamerayla piksel piksel aynı
// olur. Işık sabit (ambient + tek yönlü), gölge yok, sis yok: aynı poz her
// çağrıda aynı görüntüyü üretir (deterministik GT).
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
  ciz: (ctx: CanvasRenderingContext2D, rng: () => number) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = genislik;
  c.height = yukseklik;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for procedural texture');
  ciz(ctx, mulberry32(tohum));
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Ağaç kabuğu: dikey çizgiler (renk varyasyonlu) + birkaç budak — SIFT'in
 * tutunacağı yüksek frekanslı, tekrarsız doku. */
function govdeDokusu(renk: Vec3, tohum: number): THREE.CanvasTexture {
  return dokuOlustur(128, 512, tohum, (ctx, rng) => {
    const [r, g, b] = renk.map((v) => Math.round(v * 255));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, 128, 512);
    for (let i = 0; i < 260; i++) {
      const x = rng() * 128;
      const y0 = rng() * 512;
      const uzunluk = 20 + rng() * 130;
      const kalinlik = 0.5 + rng() * 2.5;
      const yon = rng() < 0.5 ? -1 : 1;
      const miktar = yon * (15 + rng() * 45);
      ctx.strokeStyle = `rgba(${clamp8(r + miktar)},${clamp8(g + miktar * 0.8)},${clamp8(b + miktar * 0.6)},${0.3 + rng() * 0.45})`;
      ctx.lineWidth = kalinlik;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x + (rng() - 0.5) * 6, y0 + uzunluk);
      ctx.stroke();
    }
    for (let i = 0; i < 7; i++) {
      const x = rng() * 128;
      const y = rng() * 512;
      const rr = 4 + rng() * 11;
      ctx.fillStyle = `rgba(${clamp8(r - 55)},${clamp8(g - 42)},${clamp8(b - 26)},0.85)`;
      ctx.beginPath();
      ctx.ellipse(x, y, rr, rr * 1.6, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Çalı yaprağı: benekli yeşil, orta frekans. */
function caliDokusu(renk: Vec3, tohum: number): THREE.CanvasTexture {
  return dokuOlustur(128, 128, tohum, (ctx, rng) => {
    const [r, g, b] = renk.map((v) => Math.round(v * 255));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 550; i++) {
      const x = rng() * 128;
      const y = rng() * 128;
      const rr = 1 + rng() * 3.2;
      const ton = 35 * (rng() - 0.5);
      ctx.fillStyle = `rgba(${clamp8(r + ton)},${clamp8(g + ton)},${clamp8(b + ton * 0.6)},${0.35 + rng() * 0.45})`;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Zemin: çok ölçekli çakıl lekeleri, tekrarlı döşenir (RepeatWrapping). */
function zeminDokusu(tohum: number): THREE.CanvasTexture {
  return dokuOlustur(512, 512, tohum, (ctx, rng) => {
    ctx.fillStyle = '#6b5a45';
    ctx.fillRect(0, 0, 512, 512);
    const olcekler: [number, number][] = [[3200, 1.1], [1200, 2.5], [420, 5], [90, 10]];
    for (const [adet, boyut] of olcekler) {
      for (let i = 0; i < adet; i++) {
        const x = rng() * 512;
        const y = rng() * 512;
        const rr = boyut * (0.4 + rng() * 0.9);
        const ton = 45 * (rng() - 0.5);
        ctx.fillStyle = `rgba(${clamp8(107 + ton)},${clamp8(90 + ton * 0.8)},${clamp8(69 + ton * 0.6)},${0.5 + rng() * 0.4})`;
        ctx.beginPath();
        ctx.ellipse(x, y, rr, rr * (0.7 + rng() * 0.6), rng() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

/** Uzak fon: gök gradyanı + sırt hattı + bulutlar + ince gürültü (tekil, döşenmez). */
function fonDokusu(tohum: number): THREE.CanvasTexture {
  return dokuOlustur(1024, 512, tohum, (ctx, rng) => {
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#bcd8ee');
    grad.addColorStop(0.55, '#9fc3dd');
    grad.addColorStop(1, '#6d8f70');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = '#5b7864';
    ctx.beginPath();
    ctx.moveTo(0, 512);
    ctx.lineTo(0, 340);
    for (let x = 0; x <= 1024; x += 14) {
      ctx.lineTo(x, 300 + Math.sin(x * 0.011) * 18 + (rng() - 0.5) * 24);
    }
    ctx.lineTo(1024, 512);
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 40; i++) {
      const x = rng() * 1024;
      const y = 20 + rng() * 200;
      const rr = 20 + rng() * 60;
      ctx.fillStyle = `rgba(255,255,255,${0.15 + rng() * 0.25})`;
      ctx.beginPath();
      ctx.ellipse(x, y, rr, rr * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 7000; i++) {
      const x = rng() * 1024;
      const y = rng() * 512;
      ctx.fillStyle = `rgba(0,0,0,${rng() * 0.06})`;
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
      const mat = new THREE.MeshLambertMaterial({ map: govdeDokusu(n.renk, n.dokuTohumu) });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(n.x, n.y, n.z);
      scene.add(mesh);
    } else if (n.tur === 'cali') {
      const geo = new THREE.SphereGeometry(n.r, 14, 10);
      const mat = new THREE.MeshLambertMaterial({ map: caliDokusu(n.renk, n.dokuTohumu) });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(n.x, n.y, n.z);
      scene.add(mesh);
    } else if (n.tur === 'zemin') {
      const genislik = n.xMax - n.xMin;
      const derinlik = n.zMax - n.zMin;
      const geo = new THREE.PlaneGeometry(genislik, derinlik);
      geo.rotateX(Math.PI / 2);
      geo.translate((n.xMin + n.xMax) / 2, ZEMIN_Y, (n.zMin + n.zMax) / 2);
      const tex = zeminDokusu(n.dokuTohumu);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(genislik / 2, derinlik / 2);
      const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
      scene.add(new THREE.Mesh(geo, mat));
    } else if (n.tur === 'fon') {
      const genislik = n.xMax - n.xMin;
      const yukseklik = n.yMax - n.yMin;
      const geo = new THREE.PlaneGeometry(genislik, yukseklik);
      geo.translate((n.xMin + n.xMax) / 2, (n.yMin + n.yMax) / 2, n.z);
      const mat = new THREE.MeshBasicMaterial({ map: fonDokusu(n.dokuTohumu), side: THREE.DoubleSide });
      scene.add(new THREE.Mesh(geo, mat));
    }
  }

  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x9fc3dd, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

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
