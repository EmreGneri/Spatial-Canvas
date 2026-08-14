import * as THREE from 'three';
import { POSITION_TEXTURE_SIZE } from './buffers';
import type { GaussianBufferData } from '../shaders/splatFixture';
import {
  ensureSortScratch,
  needsResort,
  sortSplatsByDepth,
  type SplatSortMode,
  type SplatSortScratch,
} from '../shaders/splatSort';

/**
 * GAUSSIAN BUFFER + SPLAT ÇİZİM NESNESİ.
 *
 * ARCHITECTURE.md · D.1 sözleşmesinin GPU tarafı. Sözleşme gereği bu
 * texture'ların YAZARI veri katmanıdır (füzyon — Gün 7); bu modül onları
 * AYIRIR, BIND EDER ve çizim nesnesini kurar. Render katmanı (splatMaterial)
 * yalnızca okur ve texture referansına asla dokunmaz.
 *
 * ── GEÇİCİ KÖPRÜ (dürüstlük kaydı) ─────────────────────────────────────────
 * Füzyon henüz yok. `fillGaussiansFromPointCloud`, MEVCUT nokta bulutundan
 * (home texture + renk grid'i) geçerli bir GaussianBuffer türetir; böylece
 * splat modu bugün gerçek fotoğrafla çalışır ve Gün 7'de füzyon geldiğinde
 * yalnızca bu doldurucunun yerine geçer — texture sözleşmesi, material ve
 * sıralama DEĞİŞMEZ. Türetilen normal/ölçek gerçek füzyon çıktısı DEĞİLDİR
 * (tek görüntüden çıkarım), bu yüzden "3D Gaussian Splatting eğitimi" gibi
 * sunulmaz; splat rasterizer'ının veri yolu testidir.
 *
 * ── y-flip ─────────────────────────────────────────────────────────────────
 * GaussianBuffer bir GÖRÜNTÜ DEĞİLDİR: texel (i,j) bir piksele değil, bir
 * splat indeksine karşılık gelir. Bu yüzden `flipY = false` — y-flip
 * politikası (v=1 → görselin üstü) yalnızca görüntü türevli texture'lar
 * içindir (buffers.ts). Burada flip açık olsaydı index → uv çevrimi sessizce
 * dikey aynalanır ve sıralama başka splat'ı çizerdi.
 */

/** Splat quad'ının köşe düzeni: iki üçgen, dört köşe (TRIANGLE indeksli). */
const QUAD_CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);

export interface GaussianTextures {
  /** gSplatA — xyz + opaklık (RGBA32F). */
  a: THREE.DataTexture;
  /** gSplatB — normal.xyz + ölçek (RGBA32F). */
  b: THREE.DataTexture;
  /** gSplatC — rgb + AO (RGBA8). */
  c: THREE.DataTexture;
  /** Kenar uzunluğu (384) — index → uv çevrimi. */
  grid: number;
  /** Kapasite = grid². Bundan fazla splat taşınamaz. */
  capacity: number;
}

function floatTexture(grid: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    new Float32Array(grid * grid * 4),
    grid,
    grid,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  tex.flipY = false; // görüntü değil, splat dizisi (yukarıdaki not)
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function createGaussianTextures(grid = POSITION_TEXTURE_SIZE): GaussianTextures {
  const a = floatTexture(grid);
  const b = floatTexture(grid);
  const c = new THREE.DataTexture(
    new Uint8Array(grid * grid * 4),
    grid,
    grid,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  c.flipY = false;
  c.colorSpace = THREE.SRGBColorSpace;
  c.minFilter = THREE.NearestFilter;
  c.magFilter = THREE.NearestFilter;
  c.generateMipmaps = false;
  c.needsUpdate = true;
  return { a, b, c, grid, capacity: grid * grid };
}

/**
 * CPU tarafı GaussianBufferData'yı texture'lara yazar. Kapasiteyi aşan splat
 * SESSİZCE ATILMAZ — RangeError (volume.ts/sampler.ts sözleşme stili).
 */
export function uploadGaussianData(tex: GaussianTextures, data: GaussianBufferData) {
  if (data.count > tex.capacity) {
    throw new RangeError(
      `uploadGaussianData: ${data.count} splat, GaussianBuffer kapasitesi ${tex.capacity} (${tex.grid}²)`,
    );
  }
  const A = tex.a.image.data as Float32Array;
  const B = tex.b.image.data as Float32Array;
  const C = tex.c.image.data as Uint8Array;
  A.fill(0);
  B.fill(0);
  C.fill(0);
  A.set(data.a.subarray(0, data.count * 4), 0);
  B.set(data.b.subarray(0, data.count * 4), 0);
  for (let i = 0; i < data.count * 4; i++) {
    C[i] = Math.round(Math.min(1, Math.max(0, data.c[i])) * 255);
  }
  tex.a.needsUpdate = true;
  tex.b.needsUpdate = true;
  tex.c.needsUpdate = true;
}

/**
 * GEÇİCİ KÖPRÜ: nokta bulutundan GaussianBuffer türetir.
 *
 * - konum + opaklık: home texture'dan birebir (xyz + w; w iki seviyeli opaklık)
 * - normal: KOMŞU TEXEL'lerin z farkından (pointCloudMaterial ile aynı ilke —
 *   konum grid'i düzenli olduğu için merkezi fark geçerli bir yüzey normali
 *   verir). Grid kenarında tek yanlı fark.
 * - ölçek: komşu texel'ler arası dünya mesafesinin yarısı — splat'lar tam
 *   komşusuna değecek kadar büyük olur, yüzey delik bırakmaz.
 * - renk + AO: renk grid'inden birebir (RGBA8 → 0..1).
 *
 * `colorData` yoksa (kamera/video ya da fotoğraf öncesi) renk derinlik
 * rampasından türetilir — splat modu boş ekran göstermez.
 */
export function fillGaussiansFromPointCloud(
  tex: GaussianTextures,
  home: Float32Array,
  colorData: Uint8Array | null,
  grid = POSITION_TEXTURE_SIZE,
): number {
  const A = tex.a.image.data as Float32Array;
  const B = tex.b.image.data as Float32Array;
  const C = tex.c.image.data as Uint8Array;
  const n = grid * grid;
  // Dünya adımı: home grid'i [-halfW, +halfW] × [-1, +1] aralığını kaplar.
  // Adım x ve y'de farklı olabilir; ölçek için ikisinin ortalaması alınır.
  const stepX = Math.abs(home[4] - home[0]) || 2 / grid;
  const stepY = Math.abs(home[grid * 4 + 1] - home[1]) || 2 / grid;
  const baseScale = 0.5 * Math.max(stepX, stepY);

  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const k = j * grid + i;
      const o = k * 4;
      const x = home[o];
      const y = home[o + 1];
      const z = home[o + 2];
      A[o] = x;
      A[o + 1] = y;
      A[o + 2] = z;
      A[o + 3] = home[o + 3];

      // Merkezi fark (kenarda tek yanlı) → yüzey normali.
      const zl = home[(k - (i > 0 ? 1 : 0)) * 4 + 2];
      const zr = home[(k + (i < grid - 1 ? 1 : 0)) * 4 + 2];
      const zd = home[(k - (j > 0 ? grid : 0)) * 4 + 2];
      const zu = home[(k + (j < grid - 1 ? grid : 0)) * 4 + 2];
      // grid satırı j ARTARKEN dünya y AZALIR → dz/dy işareti ters.
      const dzdx = (zr - zl) / (2 * stepX);
      const dzdy = -(zu - zd) / (2 * stepY);
      const nx = -dzdx;
      const ny = -dzdy;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      B[o] = nx / len;
      B[o + 1] = ny / len;
      B[o + 2] = nz / len;
      B[o + 3] = baseScale;

      if (colorData) {
        C[o] = colorData[o];
        C[o + 1] = colorData[o + 1];
        C[o + 2] = colorData[o + 2];
        C[o + 3] = colorData[o + 3];
      } else {
        // Derinlik rampası (uHasImage = 0 yolunun splat karşılığı).
        const t = Math.min(1, Math.max(0, z / 2 + 0.5));
        C[o] = Math.round((0.05 + 0.87 * t) * 255);
        C[o + 1] = Math.round((0.06 + 0.88 * t) * 255);
        C[o + 2] = Math.round((0.1 + 0.88 * t) * 255);
        C[o + 3] = 255;
      }
    }
  }
  tex.a.needsUpdate = true;
  tex.b.needsUpdate = true;
  tex.c.needsUpdate = true;
  return n;
}

/**
 * Splat çizim nesnesi: tek instanced quad, splat başına bir instance.
 * `aSplatIndex` her yeniden sıralamada güncellenir (dinamik attribute).
 */
export class SplatObject {
  readonly mesh: THREE.Mesh;
  readonly textures: GaussianTextures;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly indexAttr: THREE.InstancedBufferAttribute;
  private scratch: SplatSortScratch | null = null;
  /** Sıralama girdisi: gSplatA'nın CPU kopyası (texture'dan geri okuma yok). */
  private readonly xyzw: Float32Array;
  private lastDir = new Float32Array([0, 0, 1]);
  private splatCount = 0;
  private drawCount = 0;
  /** Son sıralamanın süresi (ms) — Gün 4 ölçümü ve UI paneli okur. */
  lastSortMs = 0;
  /** Son sıralamada gerçekten çizilen splat sayısı. */
  get visibleCount(): number {
    return this.drawCount;
  }

  constructor(material: THREE.Material, grid = POSITION_TEXTURE_SIZE) {
    this.textures = createGaussianTextures(grid);
    this.xyzw = new Float32Array(grid * grid * 4);

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('aCorner', new THREE.BufferAttribute(QUAD_CORNERS, 2));
    // `position` attribute'u three.js'in bounding-sphere hesabı için gerekir;
    // shader onu kullanmaz (konum GaussianBuffer'dan gelir).
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geometry.setIndex(new THREE.BufferAttribute(QUAD_INDICES, 1));
    const order = new Float32Array(grid * grid);
    for (let i = 0; i < order.length; i++) order[i] = i;
    this.indexAttr = new THREE.InstancedBufferAttribute(order, 1);
    this.indexAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aSplatIndex', this.indexAttr);
    geometry.instanceCount = 0;
    this.geometry = geometry;

    this.mesh = new THREE.Mesh(geometry, material);
    // Konumlar GPU'da texture'dan geldiği için bounding hacmi anlamsız.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // Splat'lar saydamdır: opak geometriden SONRA çizilsin.
    this.mesh.renderOrder = 10;
    (this.textures.grid = grid);
    const u = (material as THREE.ShaderMaterial).uniforms;
    if (u?.['uSplatGrid']) u['uSplatGrid'].value = grid;
  }

  /** GaussianBuffer'ı doldurduktan SONRA çağrılır: sıralama girdisini tazeler. */
  syncFromTextures(count: number) {
    this.splatCount = Math.min(count, this.textures.capacity);
    this.xyzw.set((this.textures.a.image.data as Float32Array).subarray(0, this.splatCount * 4), 0);
    // Yeni veri → sıra kesin bayat; bir sonraki update zorla sıralasın.
    this.lastDir[0] = 0;
    this.lastDir[1] = 0;
    this.lastDir[2] = 0;
  }

  /** Material takas edildiğinde texture bağlarını yeniden işler (Engine kuralı). */
  bindTextures(material: THREE.Material) {
    const u = (material as THREE.ShaderMaterial).uniforms as
      | Record<string, THREE.IUniform>
      | undefined;
    if (!u?.['uSplatA']) return;
    u['uSplatA'].value = this.textures.a;
    u['uSplatB'].value = this.textures.b;
    u['uSplatC'].value = this.textures.c;
    u['uSplatGrid'].value = this.textures.grid;
  }

  /**
   * Kare kancası: gerekiyorsa derinlik sırasını yeniden kurar ve instance
   * sayısını günceller. Kamera yeterince dönmediyse (needsResort) HİÇBİR ŞEY
   * yapmaz — 147k'lık attribute yüklemesi her karede tekrarlanmaz.
   */
  update(
    camera: THREE.Camera,
    mode: SplatSortMode,
    minOpacity: number,
    viewport: THREE.Vector2,
    material: THREE.Material,
  ) {
    if (this.splatCount === 0) return;
    const u = (material as THREE.ShaderMaterial).uniforms as
      | Record<string, THREE.IUniform>
      | undefined;
    if (u?.['uViewport']) (u['uViewport'].value as THREE.Vector2).copy(viewport);

    const view = camera.matrixWorldInverse.elements;
    if (!needsResort(view, this.lastDir)) return;
    this.scratch = ensureSortScratch(this.scratch, this.splatCount);
    const t0 = performance.now();
    const result = sortSplatsByDepth(
      mode,
      this.xyzw,
      this.splatCount,
      view,
      minOpacity,
      this.scratch,
    );
    this.lastSortMs = performance.now() - t0;
    const dst = this.indexAttr.array as Float32Array;
    for (let k = 0; k < result.count; k++) dst[k] = result.order[k];
    this.indexAttr.needsUpdate = true;
    this.indexAttr.clearUpdateRanges?.();
    this.indexAttr.addUpdateRange?.(0, result.count);
    this.drawCount = result.count;
    this.geometry.instanceCount = result.count;
  }

  setVisible(v: boolean) {
    this.mesh.visible = v && this.splatCount > 0;
  }

  get ready(): boolean {
    return this.splatCount > 0;
  }

  dispose() {
    this.geometry.dispose();
    this.textures.a.dispose();
    this.textures.b.dispose();
    this.textures.c.dispose();
  }
}
