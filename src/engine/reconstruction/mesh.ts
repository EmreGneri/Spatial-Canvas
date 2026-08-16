/**
 * KAPALI KABUK MESH (Gün B — 'solid' render modu, fotoğraf-only).
 *
 * Parçacık bulutu (sampler.ts) grid'i 1:1 süreksiz örneklediği için kapalı
 * yüzey üretemez; bu modül AYNI sözleşmelerle (siluet, önem remap'i, z
 * formülleri, nesne maskesi) GERÇEK bir 2-manifold kabuk kurar:
 *
 *   - Siluet: buildSilhouette (delik doldurma + bileşen analizi + son AND)
 *     — mesh, parçacıklarla aynı binary maskeyi köşe ızgarasında değerlendirir.
 *   - Önem remap'i (açık): köşe koordinatı (i/N, 1−j/N) önce remap'ten
 *     geçer (xOf/yOf), depth/siluet o noktada bilinear örneklenir — renk
 *     grid'iyle (sampleImageGrid) birebir hizalı: mesh ön yüzeyi parçacık
 *     yüzeyinin AYNISI olur, her köşe kendi fotoğraf pikselinin rengini alır.
 *   - Ön yüzey z: sampler ile aynı formül ailesi — (d − 0.5)·zSpan + evrensel
 *     elipsoit kavis + kenar dökümü (oval kaide sönümü) + ince kabuk.
 *     zSpan = ANATOMIC_DEPTH_RATIO · 2 · min(rx, ry) (SİLÜET ORANLI uzam,
 *     siluet yoksa eski sabit `range`); duvar/kabuk/kavis sabitleri
 *     zUnit = zSpan/2 ile ölçeklenir — arka kapak da wallZ = EDGE_WALL_Z·zUnit
 *     düzlemindedir (yoksa kabuk kutuya döner).
 *     Gün B temizlik: depth 3×3 box blur'dan geçirilir (buruşukluk yok) ve
 *     ekstrüzyon depthScale (0.7) ile sönümlenir; kavis depthScale ile
 *     ölçeklenmez.
 *   - KAPANMA: front yüzeyi (marching-squares benzeri köşe üçgenlemesi) +
 *     sınır kenarlarına dikey duvar şeridi + arka kapak (EDGE_WALL_Z düzleminde,
 *     front ile aynı topoloji, ters sarım). Her iç kenar iki yüz tarafından
 *     zıt yönlerde paylaşılır → kapalı oriyente edilebilir yüzey (verify-mesh
 *     bunu yönlü kenar sayımıyla doğrular). k=1 / k=2 (diyagonal) hücrelerde
 *     sıfır genişlikli kıvrımlar oluşur — görsel olarak yokturlar, sayım
 *     "kazanılmış/sıfır alan" kenarları görmezden gelir.
 *   - Arka duvar güvencesi: ön yüz hiçbir köşede (EDGE_WALL_Z + 0.02)·zUnit
 *     altına inemez (döküm/z kelepçesi) — duvar şeridi her yerde en az
 *     0.02·zUnit kalın.
 *   - YÖN (Gün C): ön yüz +z'den bakınca CCW'dir, yani normalleri DIŞA bakar.
 *     Kapalı + tutarlı yönlü yüzeyde tek yüzün dışa bakması hepsinin dışa
 *     bakması demektir → material `FrontSide` çizebilir (fragment maliyeti
 *     yarıya iner). Normaller ve kabuk kimliği (shell) geometriyle birlikte
 *     üretilir — computeVertexNormals kullanılmaz.
 *
 * GPU transferi yapmaz; çıktı interleaved Float32Array'ler + Uint32 index
 * (Engine BufferGeometry'ye taşır, normalleri computeVertexNormals üretir).
 */

import { buildSilhouette } from './silhouette.ts';
import {
  ANATOMIC_DEPTH_RATIO,
  buildImportanceRemap,
  computeBodyGeometry,
  EDGE_WALL_Z,
  THIN_SHELL_Z,
} from './sampler.ts';

/**
 * Mesh köşe ızgarası boyutu (tek eksen). Gün C: 128 → 192. Kabuk yalnızca
 * fotoğraf yüklenişinde bir kez kurulur (video yolu mesh üretmez), maliyet
 * kare başına değil yükleme başınadır; 2.25× köşe yüzey detayını (burun/göz
 * çukuru/parmak) taşıyabilir hale getirir.
 */
export const MESH_GRID_SIZE = 192;
/**
 * Ön yüzün asla inemeyeceği z (ÖLÇEKSİZ sözleşme değeri): döküm/ince kabuk ön
 * yüzü duvar düzleminin altına çekerse duvar şeridi ters döner
 * (self-intersection). Duvar her köşede en az 0.02 kalın kalır.
 * Kullanım yerinde zUnit ile ölçeklenir (silüet-oranlı z uzamı) — sabitin
 * kendisi sözleşme değeri olarak sabittir.
 */
export const MESH_MIN_WALL_Z = EDGE_WALL_Z + 0.02;

// sampler.ts ile birebir aynı formül sabitleri (parçacık yüzeyi hizası).
const MESH_FG_NEAR = 0.2;
const MESH_FG_FAR = 0.7;
const MESH_THIN_SHELL_PX = 3;
const MESH_BACK_FILL = 0.35;
const MESH_BUST_ROUND = 0.5;
const MESH_BUST_FADE_LO = 0.55;
const MESH_BUST_FADE_HI = 1.15;
const MESH_BUST_VERT_WEIGHT = 0.65;

const DEFAULT_WORLD_HEIGHT = 2;
const DEFAULT_DEPTH_RANGE = 2;
const DEFAULT_CURVATURE = 0.1;

export interface ShellMeshOptions {
  /** Köşe ızgarası boyutu (tek eksen, köşe sayısı = (N+1)²). Varsayılan 128. */
  gridSize?: number;
  /** Bulut dünya yüksekliği. Varsayılan 2 (POINTS_WORLD_HEIGHT). */
  worldHeight?: number;
  /** z aralığı (POINTS_DEPTH_RANGE). Varsayılan 2. */
  depthRange?: number;
  /**
   * Ekstrüzyon ölçeği (Gün B temizlik): `(d − 0.5)·range` teriminin çarpanı.
   * 0.7 → derinlik patlaması %30 sönümlenir, yüz hatları sivri/patlak değil.
   * Kavis bileşeni ölçeklenmez. Varsayılan 0.7.
   */
  depthScale?: number;
  /** Elipsoit kavis şiddeti (α). 0 = düz. Varsayılan 0.1. */
  curvature?: number;
  /** Önem remap'i — sampleVolumePositions ile BİREBİR aynı ayar (hizalama). Varsayılan açık. */
  importanceSampling?: boolean;
  /** Ön plan maskeesi (segmentation çıktısı) — siluete AND edilir. Opsiyonel. */
  foregroundMask?: Float32Array | null;
}

export interface ShellMeshData {
  /** Interleaved xyz (köşe başına: önce front, sonra back — 2K köşe). */
  positions: Float32Array;
  /** Interleaved uv — grid uzayı (i/N, 1−j/N), aUv sözleşmesiyle birebir. */
  uvs: Float32Array;
  /**
   * Interleaved köşe normali (Gün C). computeVertexNormals YERİNE burada
   * üretilir: ön yüz normali z ALANINDAN türetilir (−dz/dx, −dz/dy, 1), arka
   * kapak (0, 0, −1). Sebep: front/back/duvar köşeleri PAYLAŞILIR (su
   * geçirmezlik sayımı bunu ister), computeVertexNormals siluet sınırında ön
   * yüz normalini duvar normaliyle ortalayıp yüzeyi bulandırıyordu; ayrıca
   * sarım düzeltmesinden önce ön yüz normalleri EKRANIN İÇİNE bakıyordu
   * (ışık tersti, duvar sınıflaması ön yüzü komple duvar sayıyordu).
   */
  normals: Float32Array;
  /**
   * Köşe başına kabuk kimliği (Gün C): 1 = ön yüz köşesi, 0 = arka kapak
   * köşesi. Duvar şeridi bu iki köşeyi paylaştığı için fragment'te 1→0
   * interpolasyonu duvarı KESİN olarak ayırır — normalden tahmin etmek
   * (eski yol) dik yüzeyleri yanlışlıkla duvar sayıyordu.
   */
  shell: Float32Array;
  /** Üçgen index'leri (Uint32 — 65535+ köşe olabilir). */
  indices: Uint32Array;
}

export function buildShellMesh(
  depth: Float32Array,
  width: number,
  height: number,
  opts: ShellMeshOptions = {},
): ShellMeshData | null {
  // Boyut güvenliği: sessiz yanlış sonuç yerine sert hata (volume.ts stili).
  if (depth.length !== width * height) {
    throw new RangeError(
      `buildShellMesh: depth boyutu (${depth.length}) ${width}x${height} ile uyuşmuyor`,
    );
  }
  if (opts.foregroundMask && opts.foregroundMask.length !== depth.length) {
    throw new RangeError(
      `buildShellMesh: fgMask boyutu (${opts.foregroundMask.length}) depth ile aynı olmalı (${depth.length})`,
    );
  }
  const N = opts.gridSize ?? MESH_GRID_SIZE;
  const S = N + 1;
  const range = opts.depthRange ?? DEFAULT_DEPTH_RANGE;
  // Gün B temizlik: ham depth buruşuk kağıt etkisi verir — Z hesabı öncesi
  // 3×3 box blur (ayrılabilir, kenar kelepçeli). Siluet/remap/kaide HAM
  // depth'ten beslenir (maske keskinliği korunur); parçacık yolu etkilenmez.
  const smoothed = boxBlur3x3(depth, width, height);
  const depthScale = opts.depthScale ?? 0.7;
  const curvature = opts.curvature ?? DEFAULT_CURVATURE;
  const halfH = (opts.worldHeight ?? DEFAULT_WORLD_HEIGHT) / 2;
  const halfW = (width / height) * halfH;
  const remap =
    opts.importanceSampling === false
      ? null
      : buildImportanceRemap(depth, width, height, opts.foregroundMask ?? null);
  const sil = buildSilhouette(depth, width, height, opts.foregroundMask ?? null);
  // Kaide geometrisi (döküm sönümü merkezi) — parçacıklarla aynı hesap.
  const body = computeBodyGeometry(sil.alpha, width, height, halfH);
  const d1 = body ? MESH_BACK_FILL * Math.min(body.rx, body.ry) : 0;
  // Silüet-oranlı z uzamı (sampler.ts ile BİREBİR aynı kural): derinlik uzamı
  // bulut yüksekliğine değil öznenin kendi genişliğine oranlıdır. `depthScale`
  // (0.7) buna DOKUNMAZ — zSpan `range`in YERİNE geçer, onun ÜSTÜNE gelmez;
  // ekstrüzyon sönümü ayrı bir koldur. Duvar/kabuk sabitleri kullanım yerinde
  // zUnit ile ölçeklenir, aksi halde küçülen yüzeyin arkasında eski uzamda
  // duran duvar kalır (kabuk yine kutuya döner).
  // Gün E (bulgu 4) düzeltmesi (sampler.ts:255-257 ile aynı): dünya uzayında
  // y hep ±halfH, x ise ±(w/h)·halfH — dikey kadrajda dünya genişliği 1'in
  // ALTINA iner ve siluetin rx'i bu daralmış ölçekte ölçülür. Bölensiz formül
  // aynı özneyi yalnızca kadraj yönü yüzünden SIĞ çiziyordu; yarı eksen,
  // kadrajın KISA kenarı biriminde ölçülür (yatay/karede bölen 1 — davranış
  // aynen korunur).
  const frameShortHalf = Math.min(halfW, halfH);
  const zSpan = body ? (ANATOMIC_DEPTH_RATIO * 2 * Math.min(body.rx, body.ry)) / frameShortHalf : range;
  const zUnit = zSpan / 2;
  const wallZ = EDGE_WALL_Z * zUnit;
  const thinShellZ = THIN_SHELL_Z * zUnit;
  const minWallZ = MESH_MIN_WALL_Z * zUnit;

  // -- 1. Köşe ızgarası: iç/dış + ön yüzey z --
  const inside = new Uint8Array(S * S);
  const zF = new Float32Array(S * S);
  const wx = new Float32Array(S * S);
  const wy = new Float32Array(S * S);
  const uvc = new Float32Array(S * S * 2);
  for (let j = 0; j < S; j++) {
    // GÜN C DÜZELTMESİ (dikey flip): grid satırı j ÜSTTEN alta gider (t = j/N),
    // dünya/uv v ise ALTTAN üste (v = 1 − t; aUv sözleşmesi). `remap.yOf` SATIR
    // koordinatı bekler — üstten alta (sampler.ts ile birebir). Buraya v
    // verildiği için mesh dikey TERS kuruluyordu: fotoğrafın üstü dünyanın
    // altına düşüyor, doğru yönde boyanan fotoğraf dokusu ters geometriye
    // biniyordu (solid modun "yanlış şekil" sebebi).
    const t = j / N;
    const v = 1 - t;
    const yv = remap ? remap.yOf(t) - 0.5 : t * height - 0.5;
    for (let i = 0; i < S; i++) {
      const u = i / N;
      const xv = remap ? remap.xOf(u) - 0.5 : u * width - 0.5;
      const c = j * S + i;
      uvc[c * 2] = u;
      uvc[c * 2 + 1] = v;
      wx[c] = (u - 0.5) * 2 * halfW;
      wy[c] = (v - 0.5) * 2 * halfH;
      if (bilinear(sil.alpha, width, height, xv, yv) < 0.5) continue;
      // Ön yüzey z — sampler.ts ile AYNI formül ailesi (yüzey hizası).
      // Depth yumuşatılmış haritadan örneklenir; ekstrüzyon depthScale ile
      // sönümlenir (kavis ölçeklenmez).
      const d = bilinear(smoothed, width, height, xv, yv);
      let z = (d - 0.5) * zSpan * depthScale;
      const wFg = smoothstep(MESH_FG_NEAR, MESH_FG_FAR, d);
      if (curvature > 0) {
        const rx = u * 2 - 1;
        const ry = v * 2 - 1;
        const r2 = rx * rx + ry * ry;
        // Kavis zUnit ile ölçeklenir (sampler ile aynı), depthScale ile DEĞİL
        // — Gün B kuralı (kavis ekstrüzyon sönümüne girmez) korunur.
        z += curvature * zUnit * Math.sqrt(Math.max(0, 1 - r2)) * wFg;
      }
      const zFront = z;
      const dPx = body ? bilinear(sil.dist, width, height, xv, yv) : 0;
      // Kenar dökümü (oval kaide sönümü + kadraj kenarı sönümü) — parçacık
      // formülünün birebir karşılığı; dist haritasının INF bölgeleri (iç
      // kısım/kadrajı dolduran ön plan) doğal olarak dökülmez.
      if (body && d1 > 0) {
        const dW = (dPx / width) * 2 * halfW;
        const fill = 1 - Math.min(1, dW / d1);
        if (fill > 0) {
          const dxE = (wx[c] - body.cx) / body.rx;
          const dyE = (wy[c] - body.cy) / body.ry;
          const round =
            1 -
            MESH_BUST_ROUND *
              (MESH_BUST_VERT_WEIGHT * smoothstep(MESH_BUST_FADE_LO, MESH_BUST_FADE_HI, Math.abs(dyE)) +
                (1 - MESH_BUST_VERT_WEIGHT) * smoothstep(MESH_BUST_FADE_LO, MESH_BUST_FADE_HI, Math.abs(dxE)));
          const edgeFade = Math.min(u, Math.min(1 - u, Math.min(v, 1 - v))) * 4.0;
          const edgeFactor = Math.min(1.0, edgeFade);
          const fillSmooth = smoothstep(0, 1, fill) * 0.35 * edgeFactor;
          z += (wallZ - z) * fillSmooth * round;
        }
      }
      // İnce kabuk (Tur 10 karşılığı): en dış siluet köşeleri ön yüzlerinin
      // en az THIN_SHELL_Z arkasına iner.
      if (dPx <= MESH_THIN_SHELL_PX) z = Math.min(z, zFront - thinShellZ);
      // Duvar güvencesi (ölçekli) + z sözleşmesi [-1, +1].
      z = Math.max(z, minWallZ);
      inside[c] = 1;
      zF[c] = Math.min(1, Math.max(-1, z));
    }
  }
  // İç köşe yok → siluet yok → kabuk yok.
  let K = 0;
  for (let c = 0; c < S * S; c++) if (inside[c]) K++;
  if (K === 0) return null;

  // -- 2. Vertex şeması: front (çift) / back (tek) — 2K köşe --
  // Dünya adımı köşeler arasında SABİTTİR (önem remap'i yalnızca hangi depth
  // pikselinin okunduğunu büker, köşenin dünya konumunu bükmez) — normal
  // türevleri bu adımla ölçeklenir.
  const stepX = (2 * halfW) / N;
  const stepY = (2 * halfH) / N;
  const fIdx = new Int32Array(S * S).fill(-1);
  const positions = new Float32Array(K * 2 * 3);
  const uvs = new Float32Array(K * 2 * 2);
  const normals = new Float32Array(K * 2 * 3);
  const shell = new Float32Array(K * 2);
  let k = 0;
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const c = j * S + i;
      if (!inside[c]) continue;
      const z = zF[c];
      const x = wx[c];
      const y = wy[c];
      const u = uvc[c * 2];
      const v = uvc[c * 2 + 1];
      const o = k * 6;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;
      positions[o + 3] = x;
      positions[o + 4] = y;
      // Arka kapak, duvar düzleminde (EDGE_WALL_Z).
      positions[o + 5] = wallZ;
      const q = k * 4;
      uvs[q] = u;
      uvs[q + 1] = v;
      uvs[q + 2] = u;
      uvs[q + 3] = v;
      // Ön yüz normali z alanının merkezi farkından; iç köşesi olmayan yönde
      // tek yanlı fark, ikisi de yoksa düz (0, 0, 1). Yüzey z'si +z'ye doğru
      // yükseldiği için normal = normalize(−dz/dx, −dz/dy, 1).
      const dzdx = slope(zF, inside, c, 1, i > 0, i < S - 1, stepX);
      const dzdy = slope(zF, inside, c, S, j > 0, j < S - 1, stepY);
      // j ARTARKEN dünya y AZALIR (v = 1 − j/N): dz/dy dünya işareti terstir.
      const nz = 1;
      const len = Math.hypot(-dzdx, dzdy, nz) || 1;
      normals[o] = -dzdx / len;
      normals[o + 1] = dzdy / len;
      normals[o + 2] = nz / len;
      normals[o + 3] = 0;
      normals[o + 4] = 0;
      normals[o + 5] = -1; // arka kapak −z'ye bakar
      shell[k * 2] = 1; // front
      shell[k * 2 + 1] = 0; // back
      fIdx[c] = k * 2;
      k++;
    }
  }

  // -- 3. Üçgenleme: front + back (aynı topoloji, ters sarım) --
  // Hücre (i,j) köşeleri döngüsel sırayla: c0=(i,j) sol-üst, c1=(i+1,j)
  // sağ-üst, c2=(i+1,j+1) sağ-alt, c3=(i,j+1) sol-alt — +z'den CCW.
  // k=4: iki front üçgen + iki back üçgen. k=3: döngüsel alt dizi (dış köşe
  // bölgesi "air" üçgeni) — su geçirmezlik, komşu hücrenin aynı köşegeni
  // paylaşmasıyla sağlanır. k≤2: sıfır genişlikli kıvrım — front yüz yok,
  // sınır yürüyüşü köşegen/kenar boyunca sürer (görsel olarak yok).
  const tris: number[] = [];
  // Yönlü front kenar sayacı — duvar şeridi yalnızca front'un TEK yönlü
  // sınır kenarlarında kurulur. Back yüz bu sayıma GİRMEZ (zaten push sırası
  // front/back iç içe olduğundan oturup "ilk frontTris*3" yürüyemeyiz; sayaç
  // front üçgeni push edilirken elle beslenir).
  const sign = new Map<number, number>();
  const keyOf = (a: number, b: number) => a * (K * 2 + 1) + b;
  const bump = (a: number, b: number, c: number) => {
    sign.set(keyOf(a, b), (sign.get(keyOf(a, b)) ?? 0) + 1);
    sign.set(keyOf(b, c), (sign.get(keyOf(b, c)) ?? 0) + 1);
    sign.set(keyOf(c, a), (sign.get(keyOf(c, a)) ?? 0) + 1);
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const c0 = j * S + i;
      const c1 = j * S + i + 1;
      const c2 = (j + 1) * S + i + 1;
      const c3 = (j + 1) * S + i;
      const m0 = inside[c0];
      const m1 = inside[c1];
      const m2 = inside[c2];
      const m3 = inside[c3];
      const cnt = m0 + m1 + m2 + m3;
      if (cnt < 3) continue;
      // Döngüsel sıradaki iç köşelerin F index'leri (k=3 → 3'lü, k=4 → 4'lü).
      const F = [c0, c1, c2, c3]
        .filter((_, idx) => [m0, m1, m2, m3][idx])
        .map((c) => fIdx[c]);
      // GÜN C DÜZELTMESİ (sarım yönü): döngüsel sıra c0(sol-üst) → c1(sağ-üst)
      // → c2(sağ-alt) → c3(sol-alt) dünya koordinatında SAAT YÖNÜDÜR, yani
      // +z'den bakınca ön yüz DIŞA değil İÇE bakıyordu. computeVertexNormals
      // normalleri ekranın içine çeviriyor, fragment'teki duvar sınıflaması
      // (n.z < 0 → duvar) ön yüzün TAMAMINI duvar rengine boyuyor ve fotoğraf
      // dokusu yalnızca görünmeyen arka kapağa biniyordu. Sıra ters çevrildi:
      // ön yüz CCW (dış = +z), arka kapak eski ön yüz sarımıyla (dış = −z).
      if (F.length === 3) {
        tris.push(F[0], F[2], F[1]);
        tris.push(F[0] + 1, F[1] + 1, F[2] + 1);
        bump(F[0], F[2], F[1]);
      } else if (F.length === 4) {
        tris.push(F[0], F[2], F[1], F[0], F[3], F[2]);
        tris.push(F[0] + 1, F[1] + 1, F[2] + 1, F[0] + 1, F[2] + 1, F[3] + 1);
        bump(F[0], F[2], F[1]);
        bump(F[0], F[3], F[2]);
      }
    }
  }

  // -- 4. Duvar şeridi: yalnızca TEK yönlü kenarlarda (front sınırı). İç
  // kenarlar front + back tarafından zıt yönlerde kullanılır (çift sayım);
  // sınır kenarı yalnızca front'ta görünür → dik duvar üçgenleri onu ters
//   yönde kapatır (yönlü kenar sayımı dengelenir — verify-mesh).
  for (const [key, count] of sign) {
    if (count !== 1) continue;
    const a = (key / (K * 2 + 1)) | 0;
    const b = key % (K * 2 + 1);
    if (sign.get(keyOf(b, a))) continue;
    // Sınır kenarı (a→b): duvar = (Fb, Fa, Ba) + (Fb, Ba, Bb) — front'un
    // yönünü ters çevirir (kapalı kutu kenarı iki yüz arasında paylaşılır).
    tris.push(b, a, a + 1, b, a + 1, b + 1);
  }

  const indices = new Uint32Array(tris);
  return { positions, uvs, normals, shell, indices };
}

/**
 * z alanının bir eksendeki eğimi (merkezi fark; iç köşesi olmayan yönde tek
 * yanlı, ikisi de yoksa 0). `stride` = 1 (x) veya S (y). Yalnızca `inside`
 * köşeleri kullanılır: siluet dışındaki zF = 0 çöpü normale sızmaz.
 */
function slope(
  z: Float32Array,
  inside: Uint8Array,
  c: number,
  stride: number,
  hasLo: boolean,
  hasHi: boolean,
  step: number,
): number {
  const lo = hasLo && inside[c - stride] === 1;
  const hi = hasHi && inside[c + stride] === 1;
  if (lo && hi) return (z[c + stride] - z[c - stride]) / (2 * step);
  if (hi) return (z[c + stride] - z[c]) / step;
  if (lo) return (z[c] - z[c - stride]) / step;
  return 0;
}

/**
 * Ayrılabilir 3×3 box blur (radius 1, kenarlar kelepçeli) — Gün B temizlik:
 * Z hesabındaki ham depth gürültüsünü yumuşatır, "buruşuk kağıt" etkisini
 * giderir. Düz bölgeler birebir korunur (3×3 ortalaması sabitin kendisi).
 */
function boxBlur3x3(src: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = x;
      const x2 = Math.min(w - 1, x + 1);
      tmp[row + x] = (src[row + x0] + src[row + x1] + src[row + x2]) / 3;
    }
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const y0 = Math.max(0, y - 1);
      const y2 = Math.min(h - 1, y + 1);
      out[row + x] = (tmp[y0 * w + x] + tmp[row + x] + tmp[y2 * w + x]) / 3;
    }
  }
  return out;
}

/** Bilinear örnekleme; grid dışı taşmalar kenara kelepçelenir (sampler uyumlu). */
function bilinear(
  map: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
): number {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, x - x0));
  const ty = Math.min(1, Math.max(0, y - y0));
  const top = map[y0 * w + x0] * (1 - tx) + map[y0 * w + x1] * tx;
  const bot = map[y1 * w + x0] * (1 - tx) + map[y1 * w + x1] * tx;
  return top * (1 - ty) + bot * ty;
}

/** GLSL-style smoothstep: e0 altı 0, e1 üstü 1, arada Hermite geçiş. */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}