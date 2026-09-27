import { estimateDepth, type DepthResult } from '../../depth.ts';
import { bosAlanKur, vokselDurumu, type BosAlan } from './bosAlan.ts';
import { kareyiHizala, tutarlilikSuz } from './derinlikHizalama.ts';
import type { GsKamera } from './egitim3dgs.ts';

type Vec3 = [number, number, number];

export type GezinmeDerinlikKaynagi = 'model' | (
  (camera: GsKamera, frameName: string, time: number,
    registered: readonly { camera: GsKamera; time: number }[]) => Promise<DepthResult>
);

export interface GezinmeKaresi {
  name: string;
  tw: number;
  th: number;
  fw: number;
  fh: number;
  rgb: Float32Array | null;
  depth?: Float32Array;
}

export interface CozulmusKamera extends GsKamera { imgIdx: number }

export interface GezinmeDerinligi {
  alan: BosAlan;
  hizaliKare: number;
  gecerliPiksel: number;
  guven: GezinmeGuveni;
  /** Camera-space depth at the model output resolution, after cross-view filtering. */
  haritalar: { kamera: GsKamera; derinlik: Float32Array }[];
}

export interface GezinmeGuveni {
  alignedFrames: number;
  validPixelRatio: number;
  unknownVoxelRatio: number;
  /** Median per-frame residual divided by fitted inverse-depth slope. */
  medianRelativeFitRmse: number;
  /** Worst accepted frame; prevents a few bad alignments hiding in the median. */
  worstRelativeFitRmse: number;
  /** Maximum camera baseline divided by median observed camera-space depth. */
  baselineRatio: number;
  serbestGezinmeUygun: boolean;
  nedenler: string[];
}

/** Conservative product gate, not a collision-safety certification. */
export function gezinmeHazirlikDegerlendir(stats: Pick<GezinmeGuveni,
  'alignedFrames' | 'validPixelRatio' | 'unknownVoxelRatio' | 'medianRelativeFitRmse' |
  'worstRelativeFitRmse' | 'baselineRatio'>): GezinmeGuveni {
  const nedenler: string[] = [];
  if (stats.alignedFrames < 4) nedenler.push('en az 4 hizalı kare gerekli');
  if (!Number.isFinite(stats.validPixelRatio) || stats.validPixelRatio < 0.05) nedenler.push('geçerli derinlik kapsamı düşük');
  if (!Number.isFinite(stats.unknownVoxelRatio) || stats.unknownVoxelRatio >= 0.98) nedenler.push('ızgaranın çoğu bilinmiyor');
  if (!Number.isFinite(stats.baselineRatio) || stats.baselineRatio < 0.02) nedenler.push('kamera açı/konum çeşitliliği yetersiz');
  // Fit residual has real irreducible pixel/visibility noise even on exact
  // synthetic geometry (~0.25 at the worst view); reject gross failures while
  // keeping the worst-frame signal visible to the caller.
  if (!Number.isFinite(stats.worstRelativeFitRmse) || stats.worstRelativeFitRmse > 0.30) nedenler.push('en az bir karede derinlik hizalama hatası yüksek');
  return { ...stats, serbestGezinmeUygun: nedenler.length === 0, nedenler };
}

export function egitimKamerasi(camera: CozulmusKamera, frame: GezinmeKaresi): GsKamera {
  const sx = frame.tw / frame.fw, sy = frame.th / frame.fh;
  return {
    R: camera.R, t: camera.t, f: camera.f * sx,
    ...(camera.fy != null ? { fy: camera.fy * sy } : { fy: camera.f * sy }),
    cx: camera.cx * sx, cy: camera.cy * sy, w: frame.tw, h: frame.th,
  };
}

function haritaKamerasi(camera: GsKamera, w: number, h: number): GsKamera {
  const sx = w / camera.w, sy = h / camera.h;
  return { ...camera, f: camera.f * sx, fy: (camera.fy ?? camera.f) * sy,
    cx: camera.cx * sx, cy: camera.cy * sy, w, h };
}

function rgbCanvas(frame: GezinmeKaresi): HTMLCanvasElement {
  if (!frame.rgb || frame.rgb.length !== frame.tw * frame.th * 3) {
    throw new Error(`Depth input unavailable for ${frame.name}`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = frame.tw;
  canvas.height = frame.th;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas unavailable for depth input');
  const image = context.createImageData(frame.tw, frame.th);
  for (let i = 0; i < frame.tw * frame.th; i++) {
    const src = i * 3, dst = i * 4;
    image.data[dst] = Math.round(frame.rgb[src] * 255);
    image.data[dst + 1] = Math.round(frame.rgb[src + 1] * 255);
    image.data[dst + 2] = Math.round(frame.rgb[src + 2] * 255);
    image.data[dst + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export function derinlikBuyut(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y + 0.5) * sh / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x + 0.5) * sw / dw));
      out[y * dw + x] = src[sy * sw + sx];
    }
  }
  return out;
}

/** Run the depth model only after SfM has supplied its scale. Failed alignment
 *  excludes a frame instead of inventing free space from an unscaled map. */
export async function gezinmeDerinligiHazirla(
  frames: GezinmeKaresi[], cameras: CozulmusKamera[], points: readonly Vec3[], up: Vec3,
  source: GezinmeDerinlikKaynagi, times: ReadonlyMap<string, number>,
  progress?: (done: number, total: number) => void, signal?: AbortSignal,
): Promise<GezinmeDerinligi> {
  const ordered = [...cameras].sort((a, b) => a.imgIdx - b.imgIdx);
  const registered = ordered.map((solved) => {
    const frame = frames[solved.imgIdx];
    return { camera: egitimKamerasi(solved, frame), time: times.get(frame.name) ?? NaN };
  });
  const aligned: { camera: GsKamera; depth: Float32Array; frame: GezinmeKaresi; relativeFitRmse: number }[] = [];
  for (const [i, solved] of ordered.entries()) {
    signal?.throwIfAborted();
    const frame = frames[solved.imgIdx];
    if (!frame) throw new Error(`Missing frame ${solved.imgIdx} for aligned depth`);
    const camera = egitimKamerasi(solved, frame);
    const prediction = source === 'model'
      ? await estimateDepth(rgbCanvas(frame), {
        detailStrength: 0, foregroundStretch: false, sobelRelief: 0, depthSmoothing: false,
      })
      : await source(camera, frame.name, times.get(frame.name) ?? NaN, registered);
    if (prediction.data.length !== prediction.width * prediction.height) {
      throw new Error(`Invalid depth map for ${frame.name}`);
    }
    const mapCamera = haritaKamerasi(camera, prediction.width, prediction.height);
    const fit = kareyiHizala(prediction.data, prediction.width, prediction.height, mapCamera, points);
    if (fit.uydurma && fit.kullanilan >= 20) {
      aligned.push({ camera: mapCamera, depth: fit.derinlik, frame,
        // `rmse` and scaleA share inverse-depth units. Normalize by fitted
        // disparity span (the slope), as scaleVerdict does; normalizing by
        // scene median inverse-depth incorrectly rejects clean but narrow-FOV
        // scenes and doesn't measure how well this affine fit explains data.
        relativeFitRmse: Math.abs(fit.uydurma.scaleA) > 1e-9
          ? fit.uydurma.rmse / Math.abs(fit.uydurma.scaleA) : NaN });
    }
    progress?.(i + 1, ordered.length);
  }
  if (aligned.length < 2) throw new Error('At least two depth frames must align with SfM points');
  const filtered = tutarlilikSuz(aligned.map(({ camera, depth }) => ({ kamera: camera, derinlik: depth })));
  const maps: GezinmeDerinligi['haritalar'] = [];
  let valid = 0;
  for (let i = 0; i < aligned.length; i++) {
    const { camera, frame } = aligned[i];
    const depth = filtered[i];
    const count = depth.reduce((n, z) => n + Number(Number.isFinite(z) && z > 0), 0);
    if (!count) continue;
    valid += count;
    maps.push({ kamera: camera, derinlik: depth });
    frame.depth = derinlikBuyut(depth, camera.w, camera.h, frame.tw, frame.th);
  }
  if (maps.length < 2) throw new Error('Cross-view depth consistency rejected the reconstruction');
  const centres = ordered.map((c) => {
    const R = c.R, t = c.t;
    return [-R[0] * t[0] - R[3] * t[1] - R[6] * t[2],
      -R[1] * t[0] - R[4] * t[1] - R[7] * t[2],
      -R[2] * t[0] - R[5] * t[1] - R[8] * t[2]] as Vec3;
  });
  let path = 0;
  for (let i = 1; i < centres.length; i++) path += Math.hypot(...centres[i].map((v, j) => v - centres[i - 1][j]));
  const voxel = Math.max(path / 90, 1e-4);
  let area: BosAlan | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      area = bosAlanKur(maps.map((m) => ({ derinlik: m.derinlik, kamera: m.kamera })),
        // Narrow poles/branches can occupy only a few pixels; denser ray
        // sampling reduces phase-dependent misses before voxelization.
        { voksel: voxel * 2 ** attempt, yukari: up, adimPx: 2, guvenPayiOrani: 0.08 });
      break;
    } catch (error) {
      if (!(error instanceof RangeError) || !error.message.includes('voksel sınırı')) throw error;
    }
  }
  if (!area) throw new Error('Free-space grid exceeds the memory budget');
  let unknown = 0;
  for (let i = 0; i < area.bos.length; i++) {
    if (vokselDurumu(area.bos[i], area.dolu[i], area.bosKare[i], area.enAzKare) === 'bilinmiyor') unknown++;
  }
  const fits = aligned.map((a) => a.relativeFitRmse).filter(Number.isFinite).sort((a, b) => a - b);
  const mappedCentres = maps.map(({ kamera }) => {
    const camera = kamera;
    const { R, t } = camera;
    return [-R[0] * t[0] - R[3] * t[1] - R[6] * t[2],
      -R[1] * t[0] - R[4] * t[1] - R[7] * t[2],
      -R[2] * t[0] - R[5] * t[1] - R[8] * t[2]] as Vec3;
  });
  let maxBaseline = 0;
  for (let i = 0; i < mappedCentres.length; i++) for (let j = i + 1; j < mappedCentres.length; j++) {
    maxBaseline = Math.max(maxBaseline, Math.hypot(...mappedCentres[i].map((v, axis) => v - mappedCentres[j][axis])));
  }
  const sampledDepths: number[] = [];
  const stride = Math.max(1, Math.ceil(points.length / 1000));
  for (const { kamera: camera } of maps) for (let i = 0; i < points.length; i += stride) {
    const p = points[i];
    const z = camera.R[6] * p[0] + camera.R[7] * p[1] + camera.R[8] * p[2] + camera.t[2];
    if (Number.isFinite(z) && z > 0) sampledDepths.push(z);
  }
  sampledDepths.sort((a, b) => a - b);
  const medianSceneDepth = sampledDepths.length ? sampledDepths[sampledDepths.length >> 1] : NaN;
  const guven = gezinmeHazirlikDegerlendir({
    alignedFrames: maps.length,
    validPixelRatio: valid / Math.max(1, maps.reduce((sum, m) => sum + m.derinlik.length, 0)),
    unknownVoxelRatio: unknown / area.bos.length,
    medianRelativeFitRmse: fits.length ? fits[fits.length >> 1] : NaN,
    worstRelativeFitRmse: fits.length ? fits[fits.length - 1] : NaN,
    baselineRatio: medianSceneDepth > 0 ? maxBaseline / medianSceneDepth : NaN,
  });
  return { alan: area, hizaliKare: maps.length, gecerliPiksel: valid, guven, haritalar: maps };
}
