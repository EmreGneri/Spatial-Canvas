// Sunucu: sidecar/server.py (protokol ve ölçümler orada).
//   small: V2-small, canlı video        -> [1,H,W] disparite
//   da3:   DA3Mono-Large, fotoğraf      -> [1,2,H,W] derinlik + gökyüzü (disparite istemcide)
//   mask:  BiRefNet_lite, fotoğraf      -> [1,1,1024,1024] olasılık
export type SidecarModel = 'small' | 'da3' | 'moge' | 'mask';
export interface RawTensor { data: Float32Array; dims: number[] }

export class SidecarDroppedError extends Error {}

/** Model başına beklenen yanıt şekli (girdi [1,3,H,W]). */
export function beklenenSekil(model: SidecarModel, inDims: number[]): number[] {
  if (model === 'mask') return [1, 1, 1024, 1024];
  if (model === 'da3') return [1, 2, inDims[2], inDims[3]];
  if (model === 'moge') return [1, 5, inDims[2], inDims[3]];
  return [1, inDims[2], inDims[3]];
}

/**
 * Yardımcı açık mı?
 *  - Localhost'ta VARSAYILAN AÇIK: `npm run dev` yardımcıyı kendisi başlatır
 *    (vite.config.ts); çalışmıyorsa yoklama hemen düşer, tarayıcı yolu aynen sürer.
 *  - Yayındaki sitede varsayılan KAPALI: hiçbir sayfa izinsiz 127.0.0.1'i yoklamaz.
 *  - `?inference=sidecar` açar, `?inference=browser` kapatır; seçim kalıcıdır ve
 *    localhost varsayılanını da ezer.
 * `acikca`: kullanıcı açıkça seçti mi. Canlı video yalnız buna bakar: DirectML'de
 * V2-small çıktısı tarayıcıdan %2,9'a kadar farklı (ölçüldü), önceki karar canlı
 * yolu bu farkla varsayılan yapmamaktı.
 */
export function sidecarAcikMi(search: string, kayitli: string | null, yerel = false): { acik: boolean; acikca: boolean; kaydet: string | undefined } {
  const istek = new URLSearchParams(search).get('inference');
  if (istek === 'sidecar') return { acik: true, acikca: true, kaydet: '1' };
  if (istek === 'browser') return { acik: false, acikca: false, kaydet: '0' };
  if (kayitli === '1') return { acik: true, acikca: true, kaydet: undefined };
  if (kayitli === '0') return { acik: false, acikca: false, kaydet: undefined };
  return { acik: yerel, acikca: false, kaydet: undefined };
}

/** One capability probe per page. Failed inference switches to browser until
 * reload, avoiding a timeout on every video frame or repeated model allocation. */
export class SidecarClient {
  private url: string;
  private probe: Promise<boolean> | null = null;
  private disabled = false;
  private sequence = 0;
  backend = 'browser';
  /** /health `modeller`: optional models (moge) are called only when the server lists them. */
  models: string[] = [];

  constructor(url: string) { this.url = url.replace(/\/$/, ''); }

  available(): Promise<boolean> {
    if (this.disabled) return Promise.resolve(false);
    this.probe ??= (async () => {
      try {
        const response = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(1500) });
        const health = await response.json();
        // CPU arka ucu KABUL EDİLMEZ: DA3 CPU'da ~14 sn/çağrı, fotoğraf başına ~7 çağrı;
        // tarayıcıdan yavaş olur ve sıradaki canlı kareleri zaman aşımına iterdi.
        if (!response.ok || health.ok !== true || !['DmlExecutionProvider','CUDAExecutionProvider'].includes(health.arkaUc)) return false;
        this.backend = `sidecar · ${health.arkaUc}`;
        this.models = Array.isArray(health.modeller) ? health.modeller : [];
        return true;
      } catch { return false; }
    })();
    return this.probe;
  }

  async infer(model: SidecarModel, tensor: RawTensor, fallback: () => Promise<RawTensor>): Promise<RawTensor> {
    if (await this.available()) {
      try {
        const id = String(++this.sequence);
        const path = model === 'mask' ? '/infer/mask' : `/infer/depth?model=${model}`;
        const response = await fetch(this.url + path, {
          // BiRefNet DirectML'de ~5 sn; ilk çağrıda kabuk ısınması da eklenir.
          method: 'POST', signal: AbortSignal.timeout(model === 'small' ? 15000 : 60000),
          headers: { 'Content-Type': 'application/octet-stream', 'X-Dims': tensor.dims.join(','), 'X-Frame-Id': id },
          // Respect views into a larger processor buffer. No JSON/base64 conversion.
          body: new Uint8Array(tensor.data.buffer, tensor.data.byteOffset, tensor.data.byteLength) as BodyInit,
        });
        const buffer = await response.arrayBuffer();
        if (response.status === 409) throw new SidecarDroppedError('Sidecar superseded frame');
        if (!response.ok) throw new Error(`Sidecar HTTP ${response.status}`);
        const dims = (response.headers.get('x-dims') ?? '').split(',').map(Number);
        const expected = beklenenSekil(model, tensor.dims);
        if (response.headers.get('x-frame-id') !== id || dims.length !== expected.length
          || dims.some((d,i) => d !== expected[i]) || buffer.byteLength !== expected.reduce((a,b)=>a*b,1)*4) {
          throw new Error('Sidecar frame or tensor shape mismatch');
        }
        const data = new Float32Array(buffer);
        if (!data.every(Number.isFinite)) throw new Error('Sidecar returned non-finite depth');
        return { data, dims };
      } catch (error) {
        if (error instanceof SidecarDroppedError) throw error;
        this.disabled = true;
        this.backend = 'browser';
        console.warn('Local inference unavailable; switching to browser.', error);
      }
    }
    return fallback();
  }
}

const KAYIT_ANAHTARI = 'spatial-canvas.inference';
function acilisDurumu(): { acik: boolean; acikca: boolean } {
  if (typeof location === 'undefined') return { acik: false, acikca: false }; // Node (verify)
  let kayitli: string | null = null;
  try { kayitli = localStorage.getItem(KAYIT_ANAHTARI); } catch { /* gizli pencere vb. */ }
  const yerel = ['localhost', '127.0.0.1'].includes(location.hostname);
  const durum = sidecarAcikMi(location.search, kayitli, yerel);
  try {
    if (durum.kaydet) localStorage.setItem(KAYIT_ANAHTARI, durum.kaydet);
  } catch { /* depolama yoksa yalnız bu sayfa için geçerli */ }
  return durum;
}
const durum = acilisDurumu();
export const localInference = durum.acik ? new SidecarClient('http://127.0.0.1:8765') : null;
/** Canlı video için: yalnız kullanıcı açıkça seçtiyse (bkz. sidecarAcikMi). */
export const localInferenceAvailableCanli = () =>
  durum.acikca ? localInferenceAvailable() : Promise.resolve(false);
export const localInferenceAvailable = () => localInference?.available() ?? Promise.resolve(false);
export const inferenceBackend = () => localInference?.backend ?? 'browser';
