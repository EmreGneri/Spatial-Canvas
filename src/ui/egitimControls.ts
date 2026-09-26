import { kameraMerkezi, yorunge, type GsKamera } from '../engine/reconstruction/egitim3dgs.ts';

/** Use a non-passive listener so zooming the training canvas never scrolls the page. */
export function bindWheelZoom(
  canvas: HTMLCanvasElement,
  zoom: (factor: number) => void,
): () => void {
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    if (event.deltaY === 0) return;
    const pixels = event.deltaY * (
      event.deltaMode === 1 ? 16 :
      event.deltaMode === 2 ? canvas.clientHeight : 1
    );
    zoom(Math.exp(Math.max(-2, Math.min(2, pixels * 0.0015))));
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });
  return () => canvas.removeEventListener('wheel', onWheel);
}

/** Keep the camera outside the pivot and within a navigable distance. */
export function boundedZoomFactor(distance: number, homeDistance: number, requested: number): number {
  if (!(distance > 0) || !(homeDistance > 0) || !Number.isFinite(requested)) return 1;
  const next = Math.max(homeDistance * 0.03, Math.min(homeDistance * 30, distance * requested));
  return next / distance;
}

type Vec3 = [number, number, number];
export interface FlyAxes { forward: number; right: number; vertical: number }

/** Held `KeyboardEvent.code`s -> movement axes; opposite keys cancel. Q/E avoid Space/Shift, which scroll or select. */
export function flyAxes(keys: ReadonlySet<string>): FlyAxes {
  const axis = (plus: string, minus: string) => (keys.has(plus) ? 1 : 0) - (keys.has(minus) ? 1 : 0);
  return { forward: axis('KeyW', 'KeyS'), right: axis('KeyD', 'KeyA'), vertical: axis('KeyE', 'KeyQ') };
}

/**
 * Free-fly bound: the training-camera volume. Outside it the splat has no
 * photographic evidence and degrades to fog and floaters (measured on the
 * lighthouse orbit: 25 deg past the arc end the subject is warped, 60 deg past
 * it is unrecognisable, while a close-up between the cameras and the subject
 * stays sharp). The volume is the fan of triangles (cam_i, cam_i+1, pivot) in
 * capture order, so the space between the cameras and what they looked at is
 * free; `pay` is the margin around it, tapering toward the pivot.
 */
export interface FlySiniri {
  ucgenler: [Vec3, Vec3, Vec3][]; pay: number; olcek: number;
  /** The margin tapers toward it; null (forward path) = no taper. */
  pivot: Vec3 | null;
}

/** Margin as a fraction of the median camera-to-pivot distance (lighthouse
 *  orbit: 0.4 of it past the arc end still reads, 0.9 does not). */
export const FLY_PAY = 0.35;
/** Forward path: margin around the walked line as a fraction of its length.
 *  A walk only sees along its line; forest walk 3679072 is smeared 15% of the
 *  path length to the side (T1 `stepL/R`), this stays well inside that. */
export const YOL_PAY = 0.06;
/** A path must reach this fraction of the median camera-to-pivot distance.
 *  Measured walks: forest 3679072 reaches 2.22 (path length / distance 2.24),
 *  Pixabay 29721 has path length / distance 1.06;
 *  body sway of a few cm at a subject 1-3 m away stays under 0.05. */
export const YOL_MIN = 0.2;

export function flySiniri(kameralar: Vec3[], pivot: Vec3, tur: CekimTuru = 'yorunge'): FlySiniri {
  if (tur === 'yol' && kameralar.length >= 2) {
    // The pivot of a walk is a far background point; the fan to it would
    // cover the whole unseen forest. Bound = the walked line itself.
    const ucgenler = kameralar.slice(1).map((c, i): [Vec3, Vec3, Vec3] => [kameralar[i], c, c]);
    const L = ucgenler.reduce((s, [a, b]) => s + Math.hypot(...fark(b, a)), 0) || 1;
    return { ucgenler, pay: YOL_PAY * L, olcek: L / 4, pivot: null };
  }
  const d = kameralar.map((c) => Math.hypot(c[0] - pivot[0], c[1] - pivot[1], c[2] - pivot[2])).sort((a, b) => a - b);
  const olcek = d.length ? d[(d.length - 1) >> 1] : 1;
  const ucgenler: [Vec3, Vec3, Vec3][] = kameralar.length < 2
    ? kameralar.map((c) => [c, c, pivot])
    : kameralar.slice(1).map((c, i) => [kameralar[i], c, pivot]);
  return { ucgenler: ucgenler.length ? ucgenler : [[pivot, pivot, pivot]], pay: FLY_PAY * olcek, olcek, pivot };
}

// ── capture shape ─────────────────────────────────────────────────────────

export type CekimTuru = 'yorunge' | 'yol' | 'karma';
type Poz = Pick<GsKamera, 'R' | 't'>;
const bakis = (k: Poz): Vec3 => [k.R[6], k.R[7], k.R[8]];

/**
 * Orbit, forward path or mixed, from the training poses in capture order:
 * the median |cos| between where the camera moved (over ~10% of the capture,
 * so handheld bob cancels) and where it looked. An orbit moves sideways (~0),
 * a walk moves where it looks (~1). Fewer than 3 cameras, or a camera that
 * never gets farther than `YOL_MIN` × the median camera-to-pivot distance
 * from where it started (standing still, swaying, panning), keeps the orbit
 * default.
 */
export function cekimTuru(pozlar: readonly Poz[], pivot: Vec3): CekimTuru {
  const n = pozlar.length;
  if (n < 3) return 'yorunge';
  const C = pozlar.map((p) => kameraMerkezi(p as GsKamera));
  const d = C.map((c) => Math.hypot(...fark(c, pivot))).sort((a, b) => a - b);
  const kapsam = Math.max(...C.map((c) => Math.hypot(...fark(c, C[0]))));
  if (!(kapsam > YOL_MIN * d[(n - 1) >> 1])) return 'yorunge';
  const k = Math.max(1, Math.round(n / 10));
  const kos: number[] = [];
  for (let i = 0; i + k < n; i++) {
    const m = fark(C[i + k], C[i]);
    const lm = Math.hypot(...m);
    const d = bakis(pozlar[i]).map((v, j) => v + bakis(pozlar[i + k])[j]) as Vec3;
    const ld = Math.hypot(...d);
    if (lm > 0 && ld > 0) kos.push(Math.abs(ic(m, d)) / (lm * ld));
  }
  if (!kos.length) return 'yorunge';
  kos.sort((a, b) => a - b);
  const med = kos[(kos.length - 1) >> 1];
  return med > 0.8 ? 'yol' : med < 0.5 ? 'yorunge' : 'karma';
}

/** Level camera at `C` looking along `f` (horizon perpendicular to `yukari`),
 *  with `taban`'s intrinsics. */
function bakanKamera(taban: GsKamera, C: Vec3, f: Vec3, yukari: Vec3): GsKamera {
  const birim = (v: Vec3): Vec3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const z = birim(f);
  const x = birim(dis([-yukari[0], -yukari[1], -yukari[2]], z));
  const y = dis(z, x);
  const R = [...x, ...y, ...z];
  return { ...taban, R, t: [0, 1, 2].map((r) => -(R[r * 3] * C[0] + R[r * 3 + 1] * C[1] + R[r * 3 + 2] * C[2])) };
}

/**
 * Camera on the recorded path at arc-length fraction `s` (0 = first frame,
 * 1 = last): centres and view directions are averaged over ~±10% of the
 * capture so handheld bob and glances do not shake the view, and the horizon
 * is levelled. It looks where the camera looked while walking.
 */
export function yolKamerasi(pozlar: readonly GsKamera[], yukari: Vec3, s: number): GsKamera {
  const n = pozlar.length;
  const w = Math.max(1, Math.round(n / 10));
  const ort = (A: Vec3[], i: number): Vec3 => {
    const lo = Math.max(0, i - w), hi = Math.min(n - 1, i + w), m = hi - lo + 1;
    const o: Vec3 = [0, 0, 0];
    for (let j = lo; j <= hi; j++) for (let a = 0; a < 3; a++) o[a] += A[j][a] / m;
    return o;
  };
  const Craw = pozlar.map(kameraMerkezi), Fraw = pozlar.map(bakis);
  const C = Craw.map((_, i) => ort(Craw, i)), F = Fraw.map((_, i) => ort(Fraw, i));
  const L = [0];
  for (let i = 1; i < n; i++) L.push(L[i - 1] + Math.hypot(...fark(C[i], C[i - 1])));
  const hedef = Math.min(1, Math.max(0, s)) * L[n - 1];
  let j = 0;
  while (j < n - 2 && L[j + 1] < hedef) j++;
  const seg = n > 1 ? L[j + 1] - L[j] : 0;
  const u = seg > 0 ? Math.min(1, (hedef - L[j]) / seg) : 0;
  const b = Math.min(n - 1, j + 1);
  const lerp = (A: Vec3[]): Vec3 => [0, 1, 2].map((a) => A[j][a] + (A[b][a] - A[j][a]) * u) as Vec3;
  return bakanKamera(pozlar[u < 0.5 ? j : b], lerp(C), lerp(F), yukari);
}

const fark = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const ic = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dis = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function segmentteEnYakin(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = fark(b, a);
  const L = ic(ab, ab);
  const t = L > 0 ? Math.max(0, Math.min(1, ic(fark(p, a), ab) / L)) : 0;
  return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
}

function ucgendeEnYakin(p: Vec3, [a, b, c]: [Vec3, Vec3, Vec3]): Vec3 {
  const ab = fark(b, a), ac = fark(c, a);
  const n = dis(ab, ac);
  const nn = ic(n, n);
  if (nn > 1e-12 * ic(ab, ab) * ic(ac, ac) && nn > 0) {
    const k = ic(fark(p, a), n) / nn;
    const q: Vec3 = [p[0] - n[0] * k, p[1] - n[1] * k, p[2] - n[2] * k];
    if (ic(dis(ab, fark(q, a)), n) >= 0 && ic(dis(fark(c, b), fark(q, b)), n) >= 0 && ic(dis(fark(a, c), fark(q, c)), n) >= 0) return q;
  }
  let best = a, bd = Infinity;
  for (const e of [segmentteEnYakin(p, a, b), segmentteEnYakin(p, b, c), segmentteEnYakin(p, c, a)]) {
    const d = ic(fark(p, e), fark(p, e));
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** Nearest point of the camera volume, the distance to it and the margin
 *  there. The margin tapers toward the pivot (to 10% at it): the pivot sits on
 *  the subject, and a full margin there let Q/E sink into the lighthouse. A
 *  forward path has no subject pivot, so no taper. */
function hacmeEnYakin(p: Vec3, sinir: FlySiniri): [Vec3, number, number] {
  let best: Vec3 = p, bd = Infinity;
  for (const t of sinir.ucgenler) {
    const q = ucgendeEnYakin(p, t);
    const d = Math.hypot(...fark(p, q));
    if (d < bd) { bd = d; best = q; }
  }
  const pay = sinir.pivot
    ? sinir.pay * Math.max(0.1, Math.min(1, Math.hypot(...fark(best, sinir.pivot)) / sinir.olcek))
    : sinir.pay;
  return [best, bd, pay];
}

/**
 * Translate without rotating: forward/right follow the camera (R rows 2 and 0,
 * COLMAP x right, z forward), vertical follows world up so rising never drifts
 * sideways on a tilted view. The centre stays within `pay` of the camera
 * volume, sliding along its surface; a camera already outside (orbit zooms out
 * further) may only move closer, so entering fly mode never snaps the pose.
 */
export function flyStep(k: GsKamera, axes: FlyAxes, distance: number, sinir: FlySiniri, up: Vec3): GsKamera {
  const len = Math.hypot(axes.forward, axes.right, axes.vertical);
  if (!(len > 0) || !(distance > 0)) return k;
  const s = distance / len;
  const C = kameraMerkezi(k);
  const next = [0, 1, 2].map((i) =>
    C[i] + s * (axes.forward * k.R[6 + i] + axes.right * k.R[i] + axes.vertical * up[i])) as Vec3;
  // Distances in units of the local margin: > 1 is outside the bound.
  const [P, d, pay] = hacmeEnYakin(next, sinir);
  const [, dC, payC] = hacmeEnYakin(C, sinir);
  const limit = Math.max(1, dC / payC);
  const C2 = d > limit * pay ? next.map((v, i) => P[i] + (v - P[i]) * (limit * pay / d)) : next;
  const t = [0, 1, 2].map((r) => -(k.R[r * 3] * C2[0] + k.R[r * 3 + 1] * C2[1] + k.R[r * 3 + 2] * C2[2]));
  return { ...k, t };
}

/** FPS look: orbit around the camera's own centre; pitch that would pass `limit` or flip the view is dropped. */
export function lookAround(k: GsKamera, up: Vec3, yaw: number, pitch: number, limit = (85 * Math.PI) / 180): GsKamera {
  const C = kameraMerkezi(k);
  const next = yorunge(k, C, up, yaw, pitch);
  const n = Math.hypot(...up);
  const elevation = (m: GsKamera) => Math.asin(Math.max(-1, Math.min(1, (m.R[6] * up[0] + m.R[7] * up[1] + m.R[8] * up[2]) / n)));
  const upright = -(next.R[3] * up[0] + next.R[4] * up[1] + next.R[5] * up[2]) > 0;
  const e = Math.abs(elevation(next));
  return upright && (e <= limit || e <= Math.abs(elevation(k))) ? next : yorunge(k, C, up, yaw, 0);
}
