import * as THREE from 'three';
import { POSITION_TEXTURE_SIZE } from './buffers';
import type { GaussianBufferData } from '../shaders/splatFixture';
import {
  createResortState,
  ensureSortScratch,
  filterOrderByKeyframe,
  needsResort,
  type ResortState,
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

/**
 * Türetilen normalin en küçük |n_z|'si. Eksen başına eğim kırpmak YETMEZ
 * (iki eksen birden büyükse n_z yine çöker); sınır doğrudan normalin
 * kendisine uygulanır: yanal bileşen, n_z bu tabanı tutacak şekilde
 * ölçeklenir. 0.38 → splat kameraya göre en fazla ~68° eğilebilir.
 *
 * Bu bir GÖRÜNTÜ kararı değil, TÜRETME hatasının tavanıdır: gerçek füzyon
 * normalleri geldiğinde (Gün 7) bu tabana ihtiyaç kalmaz.
 */
const NORMAL_MIN_NZ = 0.38;

/**
 * (nx, ny, 1) ham normalini normalize eder ve |n_z| ≥ NORMAL_MIN_NZ olacak
 * şekilde yanal bileşeni kısar. Çıktı BİRİM uzunluktadır.
 */
function stabilizedNormal(nx: number, ny: number, out: Float32Array, o: number) {
  const lat = Math.hypot(nx, ny);
  // n_z = 1/√(1+lat²) ≥ min  ⇔  lat ≤ √(1/min² − 1)
  const maxLat = Math.sqrt(1 / (NORMAL_MIN_NZ * NORMAL_MIN_NZ) - 1);
  const k = lat > maxLat ? maxLat / lat : 1;
  const cx = nx * k;
  const cy = ny * k;
  const len = Math.hypot(cx, cy, 1);
  out[o] = cx / len;
  out[o + 1] = cy / len;
  out[o + 2] = 1 / len;
}

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
  // NORMAL türevleri için sabit adım yeterlidir (grid düzenli).
  const stepX = Math.abs(home[4] - home[0]) || 2 / grid;
  const stepY = Math.abs(home[grid * 4 + 1] - home[1]) || 2 / grid;
  // Yarıçap: komşu aralığının yarısı → komşu splat'lar 2σ'da buluşur,
  // Gauss kuyrukları örtüşür. Aralık grid boyunca SABİTTİR (yukarıdaki
  // "yarıçap küreseldir" kaydına bak).
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
      // EĞİM TAVANI (ölçüldü — aşağı bak): derinlik SÜREKSİZLİĞİNDE (siluet
      // kenarı, kol/gövde sınırı) merkezi fark patlar; normal kameraya
      // neredeyse DİK döner, splat kılcal bir şerite çöker ve yüzeyde delik
      // bırakır. Ölçüm (2026-08-14, sentetik görsel, 640×420): tavansız
      // %15.87 splat |n_z| < 0.35 taşıyordu ve yüzeyin %9.68'i delikti;
      // yarıçapı 3× büyütmek deliği yalnızca %4.48'e indiriyordu — yani
      // sorun YARIÇAP değil YÖNELİMDİ.
      const dzdx = (zr - zl) / (2 * stepX);
      const dzdy = -(zu - zd) / (2 * stepY);
      stabilizedNormal(-dzdx, -dzdy, B, o);
      // YARIÇAP KÜRESELDİR — ve öyle KALMALI. Denendi ve ÖLÇÜLDÜ (2026-08-14):
      // splat başına "komşu dünya mesafesi"nden yarıçap türetmek hiçbir şeyi
      // değiştirmiyor, çünkü önem remap'i (buildImportanceRemap) yalnızca
      // hangi DEPTH pikselinin okunduğunu büker; parçacığın DÜNYA konumu
      // kendi grid yerindedir (ARCHITECTURE.md · Point Cloud Sözleşmesi:
      // "grid ve aUv sözleşmesi aynı kalır"). Ölçüm: türetilen yarıçapın
      // min/maks/ortalaması 0.0026 / 0.0026 / 0.0026 — yani tam olarak
      // küresel değerin kendisi. Fazladan komşu okuması ve dallanma bedava
      // değildi; geri alındı.
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
  private resort: ResortState = createResortState();
  /** Sahne yarıçapı (splat konumlarının maksimum normu) — öteleme kapısının
   *  eşiği buna GÖRELİDİR; sabit dünya mesafesi farklı ölçekli sahnelerde
   *  yanlış karar verir. syncFromTextures her veri yüklemesinde günceller. */
  private sceneRadius = 1;
  private splatCount = 0;
  private drawCount = 0;
  /**
   * D.4 timeline filtresi (Gün 5-6): splat başına kaynak keyframe id'si.
   * GPU'ya GİTMEZ (D.4 kaydı) — filtre CPU'da, sıralama girdisinde uygulanır.
   */
  private keyframeIndex: Uint16Array | null = null;
  /** Seçili keyframe (null = hepsi). Filtre sıralamada uygulanır. */
  private keyframeFilter: number | null = null;
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
  /** Yüklü splat sayısı — export ve tanı için (texture kapasitesi değil). */
  get count(): number {
    return this.splatCount;
  }

  syncFromTextures(count: number, keyframeIndex?: Uint16Array | null) {
    this.splatCount = Math.min(count, this.textures.capacity);
    this.xyzw.set((this.textures.a.image.data as Float32Array).subarray(0, this.splatCount * 4), 0);
    // D.4: keyframe kimliği CPU'da yaşar (GPU'ya gitmez). Yeni veri gelince
    // eski kimlik dizisi geçersizdir — verilmezse filtre kapanır, aksi halde
    // timeline başka bir sahnenin indekslerini süzerdi.
    this.keyframeIndex = keyframeIndex ?? null;
    if (!this.keyframeIndex) this.keyframeFilter = null;
    // Sahne yarıçapı: öteleme kapısının eşiği buna görelidir. Splat
    // konumlarının maksimum normu — sahne 10× büyütülünce eşik de büyür,
    // aynı GÖRELİ hareket aynı kararı verir.
    let r2 = 0;
    for (let i = 0; i < this.splatCount; i++) {
      const o = i * 4;
      const d = this.xyzw[o] * this.xyzw[o] + this.xyzw[o + 1] * this.xyzw[o + 1] + this.xyzw[o + 2] * this.xyzw[o + 2];
      if (d > r2) r2 = d;
    }
    this.sceneRadius = Math.max(1e-4, Math.sqrt(r2));
    // Yeni veri → sıra kesin bayat; bir sonraki update zorla sıralasın.
    this.forceResort();
  }

  /**
   * Kapıyı bir sonraki `update`'te KESİN açar. Yön vektörünü sıfırlamak
   * yeterlidir (hiçbir birim vektörle eşik dolmaz); konum da uzağa itilir ki
   * yalnız-öteleme kolu da tetiklensin.
   */
  forceResort() {
    this.resort.dir[0] = 0;
    this.resort.dir[1] = 0;
    this.resort.dir[2] = 0;
    this.resort.pos[0] = Infinity;
    this.resort.pos[1] = 0;
    this.resort.pos[2] = 0;
  }

  /** D.4 timeline: yalnızca bu keyframe'in splat'ları çizilir (null = hepsi). */
  setKeyframeFilter(id: number | null) {
    if (this.keyframeFilter === id) return;
    this.keyframeFilter = this.keyframeIndex ? id : null;
    // Filtre sıralamadan sonra uygulanıyor; sıra bayat olmasa da instance
    // sayısı değişmeli → kapıyı zorla.
    this.forceResort();
  }

  /** Sahnedeki farklı keyframe sayısı (timeline uzunluğu). 0 = kimlik yok. */
  get keyframeCount(): number {
    if (!this.keyframeIndex) return 0;
    let max = -1;
    for (let i = 0; i < this.splatCount; i++) {
      if (this.keyframeIndex[i] > max) max = this.keyframeIndex[i];
    }
    return max + 1;
  }

  /**
   * Çizim material'ını takas eder (Gün 3: crystal modu splat geometrisinde de
   * çizebilsin diye). Texture bağları yeni material'a yeniden işlenir.
   */
  setMaterial(material: THREE.Material) {
    if (this.mesh.material === material) return;
    this.mesh.material = material;
    this.bindTextures(material);
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
    if (
      !needsResort(
        view,
        (camera as THREE.PerspectiveCamera).position,
        this.resort,
        this.sceneRadius,
      )
    ) {
      return;
    }
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
    // D.4 TIMELINE FİLTRESİ: sıralanmış diziyi YERİNDE sıkıştır. Sıra
    // arkadan öne olduğu için sıkıştırma o sırayı korur — yeniden sıralama
    // gerekmez. Filtre sıralamadan SONRA uygulanır ki sıralama maliyeti
    // filtreye göre değişmesin (ölçüm tutarlılığı).
    const count = filterOrderByKeyframe(
      result.order,
      result.count,
      this.keyframeIndex,
      this.keyframeFilter,
    );
    const dst = this.indexAttr.array as Float32Array;
    for (let k = 0; k < count; k++) dst[k] = result.order[k];
    this.indexAttr.needsUpdate = true;
    this.indexAttr.clearUpdateRanges?.();
    this.indexAttr.addUpdateRange?.(0, count);
    this.drawCount = count;
    this.geometry.instanceCount = count;
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
