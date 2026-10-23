import { cropChannels, type CropRect } from './crop.ts';
import { buildSilhouette } from './silhouette.ts';
import { BACKDROP_OPACITY } from './sampler.ts';
import type { ShellMeshData } from './mesh.ts';
import { YARICAP_BUYUME_MAKS } from '../splatGeometri.ts';

/**
 * Arka planın öznenin arkasında alabileceği en büyük derinlik payı, sığdırılmış dünya
 * biriminde. Metrik arka plan metrelerce geride kalır; öznenin [-1,1] sığdırmasıyla
 * çarpılınca onlarca birim uzağa gidip perspektifle dev, bulanık splatlara dönüşüyordu
 * (kullanıcı görsel geri bildirimi, 2026-10-24). Sıkıştırma ışın boyunca yapılır: sıra ve
 * izdüşüm korunur, yalnız uzaklık yumuşakça tavanlanır.
 */
export const ARKA_PLAN_PAYI = 1;

/** Camera Z in metres; row-major K uses normalized image coordinates. */
export interface MetricPhotoGeometry {
  depth: Float32Array;
  width: number;
  height: number;
  intrinsics: Float64Array;
  validMask: Uint8Array;
}

export function cropMetricPhotoGeometry(g: MetricPhotoGeometry, rect: CropRect): MetricPhotoGeometry {
  const d = cropChannels(g.depth, g.width, g.height, 1, rect);
  const validity = cropChannels(Float32Array.from(g.validMask), g.width, g.height, 1, rect);
  const k = g.intrinsics.slice();
  for (let i = 0; i < 3; i++) {
    k[i] *= g.width / d.width;
    k[i + 3] *= g.height / d.height;
  }
  k[2] -= rect.x0 / d.width;
  k[5] -= rect.y0 / d.height;
  return { depth: d.data, width: d.width, height: d.height, intrinsics: k, validMask: Uint8Array.from(validity.data) };
}

export interface MetricPhotoProjection {
  scale: number;
  center: readonly [number, number, number];
  /** u/v both increase from the image's upper left. Invalid points are finite and transparent. */
  project(u: number, v: number, output: Float32Array, offset: number): void;
}

/** One similarity transform preserves focal length and relative metric depth. */
export function createMetricPhotoProjection(
  g: MetricPhotoGeometry,
  displayDepth: Float32Array,
  mask?: Float32Array,
): MetricPhotoProjection {
  const { width: w, height: h, depth, intrinsics: k, validMask } = g;
  if (w < 1 || h < 1 || depth.length !== w * h || validMask.length !== depth.length || displayDepth.length !== depth.length
    || k.length !== 9 || !Array.from(k).every(Number.isFinite) || k[0] <= 0 || k[4] <= 0
    || k[3] !== 0 || k[6] !== 0 || k[7] !== 0 || k[8] !== 1) {
    throw new RangeError('Invalid calibrated photo dimensions or normalized camera intrinsics');
  }
  const alpha = buildSilhouette(displayDepth, w, h, mask ?? null).alpha;
  const valid = (i: number) => validMask[i] !== 0 && Number.isFinite(depth[i]) && depth[i] > 0;
  const point = (u: number, v: number, z: number): [number, number, number] => {
    const y = (v - k[5]) / k[4];
    return [((u - k[2] - k[1] * y) / k[0]) * z, -y * z, -z];
  };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  // The foreground controls framing; background retains its measured position.
  // Mask-edge pixels can carry background depth (metres behind the subject); a Tukey
  // far fence on foreground Z keeps them from shrinking the subject (seen on DAVIS frames).
  const fg: number[] = [];
  for (let i = 0; i < w * h; i++) if (valid(i) && alpha[i] >= .5) fg.push(depth[i]);
  fg.sort((a, b) => a - b);
  const q1 = fg[Math.floor((fg.length - 1) * .25)] ?? 0, q3 = fg[Math.ceil((fg.length - 1) * .75)] ?? 0;
  const zLo = q1 - 3 * (q3 - q1), zHi = q3 + 3 * (q3 - q1);
  let count = 0;
  for (let pass = 0; pass < 2 && !count; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!valid(i) || (pass === 0 && (alpha[i] < .5 || depth[i] < zLo || depth[i] > zHi))) continue;
      const p = point((x + .5) / w, (y + .5) / h, depth[i]);
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
      count++;
    }
  }
  const center: [number, number, number] = count ? lo.map((n, i) => n / 2 + hi[i] / 2) as [number, number, number] : [0, 0, 0];
  const limits = [2 * w / h, 2, 2];
  let scale = Infinity;
  if (count) for (let a = 0; a < 3; a++) if (hi[a] > lo[a]) scale = Math.min(scale, limits[a] / (hi[a] - lo[a]));
  if (!Number.isFinite(scale)) scale = 1;
  // Öznenin en uzak yüzü (metrik Z; kamera −Z'ye bakar, uzak = daha negatif).
  const zFg = count ? lo[2] : 0, pay = ARKA_PLAN_PAYI / scale;
  return {
    center, scale,
    project(u, v, output, offset) {
      output.fill(0, offset, offset + 4);
      const x = Math.max(0, Math.min(w - 1, u * w - .5)), y = Math.max(0, Math.min(h - 1, v * h - .5));
      const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
      let z = 0, a = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const weight = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
        if (weight <= 1e-12) continue;
        const i = Math.min(h - 1, y0 + dy) * w + Math.min(w - 1, x0 + dx);
        // Never interpolate across an unknown or non-positive metric sample.
        if (!valid(i)) return;
        z += depth[i] * weight;
        a += alpha[i] * weight;
      }
      // Border texels repeat their measured ray as well as their Z; extending
      // only the ray would bend a tilted plane at the image boundary.
      const p = point((x + .5) / w, (y + .5) / h, z);
      // Arka plan: öznenin arkasındaki mesafe `pay`a yumuşakça tavanlanır (ışın boyunca).
      const geri = zFg - p[2];
      if (a < .5 && geri > 0 && p[2] < 0) {
        const hedef = zFg - pay * (1 - Math.exp(-geri / pay));
        const k = hedef / p[2];
        for (let axis = 0; axis < 3; axis++) p[axis] *= k;
      }
      for (let axis = 0; axis < 3; axis++) output[offset + axis] = (p[axis] - center[axis]) * scale;
      if (!output.subarray(offset, offset + 3).every(Number.isFinite)) { output.fill(0, offset, offset + 4); return; }
      output[offset + 3] = a >= .5 ? 1 : BACKDROP_OPACITY;
    },
  };
}

export function sampleMetricPhotoPositions(projection: MetricPhotoProjection, gridSize: number): Float32Array {
  const out = new Float32Array(gridSize * gridSize * 4);
  for (let y = 0; y < gridSize; y++) for (let x = 0; x < gridSize; x++) {
    projection.project((x + .5) / gridSize, (y + .5) / gridSize, out, (y * gridSize + x) * 4);
  }
  return out;
}

/** Perspective rays create a nonuniform XYZ grid; constant XY derivatives are incorrect here. */
export function updateMetricPhotoSplatGeometry(home: Float32Array, grid: number, normalScale: Float32Array) {
  for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
    const i = y * grid + x, o = i * 4;
    normalScale.set([0, 0, 1, 0], o);
    if (!home[o + 3]) continue;
    const neighbor = (nx: number, ny: number) => {
      if (nx < 0 || nx >= grid || ny < 0 || ny >= grid) return i;
      const j = ny * grid + nx, p = j * 4;
      if (!home[p + 3] || (home[p + 3] >= .5) !== (home[o + 3] >= .5)) return i;
      const xy = Math.hypot(home[p] - home[o], home[p + 1] - home[o + 1]);
      // A depth discontinuity is not a tangent connecting two surfaces.
      return Math.abs(home[p + 2] - home[o + 2]) <= 6 * xy ? j : i;
    };
    const left = neighbor(x - 1, y), right = neighbor(x + 1, y), top = neighbor(x, y - 1), bottom = neighbor(x, y + 1);
    const dx = [0,1,2].map(k => home[right * 4 + k] - home[left * 4 + k]);
    const dy = [0,1,2].map(k => home[bottom * 4 + k] - home[top * 4 + k]);
    const n = [dy[1]*dx[2]-dy[2]*dx[1],dy[2]*dx[0]-dy[0]*dx[2],dy[0]*dx[1]-dy[1]*dx[0]];
    const length = Math.hypot(...n);
    if (length) for (let k=0;k<3;k++) normalScale[o+k]=n[k]/length;
    // Yarıçap: komşuya yarı mesafe, ama ekran düzlemindeki ayak izinin en fazla
    // YARICAP_BUYUME_MAKS katı (splatGeometri ile aynı tavan) — dik yüzeyde dev diskler olmasın.
    let radius = 0, iz = 0;
    for (const j of [left,right,top,bottom]) if (j !== i) {
      radius = Math.max(radius, .5 * Math.hypot(home[j*4]-home[o],home[j*4+1]-home[o+1],home[j*4+2]-home[o+2]));
      iz = Math.max(iz, .5 * Math.hypot(home[j*4]-home[o],home[j*4+1]-home[o+1]));
    }
    normalScale[o+3] = iz > 0 ? Math.min(radius, iz * YARICAP_BUYUME_MAKS) : radius;
  }
}

/** The observed metric surface receives a thin backing, never an invented body volume. */
export function buildMetricPhotoShell(projection: MetricPhotoProjection, gridSize = 192): ShellMeshData | null {
  const side = gridSize + 1, count = side * side;
  const samples = new Float32Array(count * 4);
  const positions = new Float32Array(count * 6), uvs = new Float32Array(count * 4);
  const normals = new Float32Array(count * 6), shell = new Float32Array(count * 2);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const i = y * side + x, u = x / gridSize, v = y / gridSize;
    projection.project(u, v, samples, i * 4);
    for (let back = 0; back < 2; back++) {
      const j = i + back * count;
      positions.set(samples.subarray(i * 4, i * 4 + 3), j * 3);
      positions[j * 3 + 2] -= back * .005;
      uvs.set([u, 1 - v], j * 2);
      shell[j] = 1 - back;
    }
  }
  const indices: number[] = [], edges = new Map<string, [number, number] | null>();
  const triangle = (a: number, b: number, c: number) => {
    if (samples[a * 4 + 3] < .5 || samples[b * 4 + 3] < .5 || samples[c * 4 + 3] < .5) return;
    // Derinlik sıçraması iki yüzeyi bağlamaz (splat komşuluğuyla aynı kural): yandan
    // bakınca gerilmiş "perde" üçgenleri oluşmasın.
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const xy = Math.hypot(samples[u * 4] - samples[v * 4], samples[u * 4 + 1] - samples[v * 4 + 1]);
      if (Math.abs(samples[u * 4 + 2] - samples[v * 4 + 2]) > 6 * xy) return;
    }
    indices.push(a,b,c,c+count,b+count,a+count);
    for (const [u,v] of [[a,b],[b,c],[c,a]]) {
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      edges.set(key, edges.has(key) ? null : [u,v]);
    }
  };
  for (let y = 0; y < gridSize; y++) for (let x = 0; x < gridSize; x++) {
    const a = y * side + x, b = a + 1, c = a + side, d = c + 1;
    triangle(a,c,b); triangle(b,c,d);
  }
  if (!indices.length) return null;
  // Front normals use only the observed surface; backing and walls cannot soften its contour.
  for (let i = 0; i < indices.length; i += 6) {
    const [a,b,c] = indices.slice(i,i+3), ab = [0,1,2].map(k=>positions[b*3+k]-positions[a*3+k]), ac = [0,1,2].map(k=>positions[c*3+k]-positions[a*3+k]);
    const n = [ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    for (const v of [a,b,c]) for (let k=0;k<3;k++) normals[v*3+k]+=n[k];
  }
  for (let i=0;i<count;i++) {
    const length = Math.hypot(normals[i*3],normals[i*3+1],normals[i*3+2]);
    for(let k=0;k<3;k++) { normals[i*3+k] = length ? normals[i*3+k]/length : Number(k===2); normals[(i+count)*3+k]=-normals[i*3+k]; }
  }
  for (const edge of edges.values()) if (edge) { const [a,b]=edge; indices.push(b,a,a+count,b,a+count,b+count); }
  return { positions,uvs,normals,shell,indices:Uint32Array.from(indices) };
}
