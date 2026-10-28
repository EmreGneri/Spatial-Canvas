import { propagateLiveDepth, type LiveDepthFrame } from './liveDepthFlow.ts';

/**
 * Anahtar kare aralığı (kare): her N karede bir segmentasyon, aradakiler akışla.
 * Tarayıcıda BiRefNet anahtar kare başına ~8.5 sn (RTX 5070, ölçüldü); 24 kare
 * 5 sn'lik klipte ~92 sn sürüyordu. 48 ile maliyet yarıya iner, iki yönlü akış
 * 48 karelik aralıkta öznede tutuyor.
 */
export const MASK_KEY_INTERVAL = 48;

/**
 * Bir anahtar aralığının maskelerini akışla doldurur (offline, iki yönlü).
 *
 * `frames[0]` ve (varsa) son kare anahtar karelerdir. İleri zincir başlangıç
 * maskesini, geri zincir bitiş maskesini taşır; kare j'de ağırlık j/(n-1).
 * Akışın güvenmediği pikseller bir önceki maskeyi yerinde korur: canlı
 * yayılımdaki gibi 0'a düşselerdi 24 karelik zincirde maske aşınırdı.
 * Histories stop at detected cuts. Scenes without an endpoint anchor keep all pixels.
 */
export async function propagateMaskInterval(
  frames: readonly LiveDepthFrame[], startMask: Float32Array, endMask: Float32Array | null,
  width: number, height: number,
  /** Her akış adımından sonra çağrılır (ana iş parçacığına nefes aldırmak için). */
  pause: () => Promise<void> = async () => {},
): Promise<Float32Array[]> {
  const n = frames.length;
  if (n < 1) return [];
  const zero = new Float32Array(width * height);
  const cuts = new Set<number>();
  const step = (mask: Float32Array, from: number, to: number) => {
    const result = propagateLiveDepth(zero, frames[from], frames[to], width, height, mask);
    if (result.sceneCut) {
      cuts.add(Math.max(from, to));
      return new Float32Array(zero.length).fill(1);
    }
    if (!result.mask) return mask;
    const out = result.mask;
    for (let i = 0; i < out.length; i++) if (!result.confidence[i]) out[i] = mask[i];
    return out;
  };
  const forward = [startMask];
  for (let j = 1; j < n; j++) { forward.push(step(forward[j - 1], j - 1, j)); await pause(); }
  const firstCut = cuts.size ? Math.min(...cuts) : n;
  const lastCut = cuts.size ? Math.max(...cuts) : 0;
  if ((!endMask || n < 2) && !cuts.size) return forward;
  const backward: Float32Array[] = new Array(n);
  if (endMask) {
    backward[n - 1] = endMask;
    for (let j = n - 2; j >= lastCut; j--) { backward[j] = step(backward[j + 1], j + 1, j); await pause(); }
  }
  return forward.map((f, j) => {
    if (cuts.size) {
      if (j < firstCut) return new Float32Array(f);
      if (endMask && j >= lastCut) return new Float32Array(backward[j]);
      // No scene-local anchor: retain the scene rather than importing an unrelated subject.
      return new Float32Array(zero.length).fill(1);
    }
    const w = j / (n - 1), b = backward[j], out = new Float32Array(f.length);
    for (let i = 0; i < f.length; i++) out[i] = f[i] * (1 - w) + b[i] * w;
    return out;
  });
}

/** Anahtar kare indeksleri: her sahnenin ilk karesi + her `interval` kare + sahnenin son karesi. */
export function maskKeyFrames(sceneStart: number, sceneEnd: number, interval = MASK_KEY_INTERVAL): number[] {
  const keys: number[] = [];
  for (let i = sceneStart; i < sceneEnd; i += interval) keys.push(i);
  if (sceneEnd - 1 > keys[keys.length - 1]) keys.push(sceneEnd - 1);
  return keys;
}
