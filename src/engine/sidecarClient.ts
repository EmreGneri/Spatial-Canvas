export type SidecarModel = 'small' | 'base' | 'mask';
export interface RawTensor { data: Float32Array; dims: number[] }

export class SidecarDroppedError extends Error {}

/** One capability probe per page. Failed inference switches to browser until
 * reload, avoiding a timeout on every video frame or repeated model allocation. */
export class SidecarClient {
  private url: string;
  private probe: Promise<boolean> | null = null;
  private disabled = false;
  private sequence = 0;
  backend = 'browser';

  constructor(url: string) { this.url = url.replace(/\/$/, ''); }

  available(): Promise<boolean> {
    if (this.disabled) return Promise.resolve(false);
    this.probe ??= (async () => {
      try {
        const response = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(1500) });
        const health = await response.json();
        if (!response.ok || health.ok !== true || !['DmlExecutionProvider','CUDAExecutionProvider','CPUExecutionProvider'].includes(health.arkaUc)) return false;
        this.backend = `sidecar · ${health.arkaUc}`;
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
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/octet-stream', 'X-Dims': tensor.dims.join(','), 'X-Frame-Id': id },
          // Respect views into a larger processor buffer. No JSON/base64 conversion.
          body: new Uint8Array(tensor.data.buffer, tensor.data.byteOffset, tensor.data.byteLength) as BodyInit,
        });
        const buffer = await response.arrayBuffer();
        if (response.status === 409) throw new SidecarDroppedError('Sidecar superseded frame');
        if (!response.ok) throw new Error(`Sidecar HTTP ${response.status}`);
        const dims = (response.headers.get('x-dims') ?? '').split(',').map(Number);
        const expected = model === 'mask' ? [1,1,1024,1024] : [1,tensor.dims[2],tensor.dims[3]];
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

// Explicit experiment: DML raw-output parity is not yet within the CPU gate's
// 1% tolerance. Keep the default browser path until GPU parity is accepted.
// Remote deployments never probe the viewer's local services.
const enabled = typeof location !== 'undefined'
  && ['localhost','127.0.0.1'].includes(location.hostname)
  && new URLSearchParams(location.search).get('inference') === 'sidecar';
export const localInference = enabled ? new SidecarClient('http://127.0.0.1:8765') : null;
export const localInferenceAvailable = () => localInference?.available() ?? Promise.resolve(false);
export const inferenceBackend = () => localInference?.backend ?? 'browser';
