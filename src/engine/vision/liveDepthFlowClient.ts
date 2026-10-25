import type { LiveDepthFlowInput, LiveDepthFlowResult } from './liveDepthFlow.ts';

export interface FlowRequest { id: number; generation: number; input: LiveDepthFlowInput }
export interface FlowResponse { id: number; generation: number; result?: LiveDepthFlowResult; error?: string }

/** Worker yeniden başlatma tavanı; aşılınca ara kare kalıcı kapanır (model kareleri sürer). */
export const FLOW_WORKER_MAX_RESTARTS = 3;

/** One running task and one replaceable latest frame keep latency bounded. */
export class LiveDepthFlowClient {
  private worker: Worker | null = null;
  private generation = 0;
  private sequence = 0;
  private running: FlowRequest | null = null;
  private pending: LiveDepthFlowInput | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private restarts = 0;
  private retryAt = 0;
  private onResult: (result: LiveDepthFlowResult, input: LiveDepthFlowInput) => void;
  private createWorker: () => Worker;
  private now: () => number;

  constructor(
    onResult: (result: LiveDepthFlowResult, input: LiveDepthFlowInput) => void,
    createWorker: () => Worker = () => new Worker(new URL('./liveDepthFlowWorker.ts', import.meta.url), { type: 'module' }),
    now: () => number = () => performance.now(),
  ) {
    this.onResult = onResult;
    this.createWorker = createWorker;
    this.now = now;
    this.start();
  }

  private start(): void {
    try {
      const worker = this.createWorker();
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<FlowResponse>) => {
        const response = event.data, request = this.running;
        if (worker !== this.worker || !request || response.id !== request.id || this.closed) return;
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = null;
        this.running = null;
        if (response.error) { this.fail(); return; }
        try {
          if (request.generation === this.generation && response.generation === this.generation && response.result) {
            this.onResult(response.result, request.input);
          }
        } finally {
          const next = this.pending;
          this.pending = null;
          if (next) this.submit(next);
        }
      };
      worker.onerror = () => { if (worker === this.worker) this.fail(); };
      worker.onmessageerror = () => { if (worker === this.worker) this.fail(); };
    } catch { this.closed = true; }
  }

  /**
   * Tek yavaş (>1.5 s) yanıt ya da hata worker'ı öldürür; eskiden ara kare
   * kaynak değişene kadar sessizce kapanıyordu (F12). Artık artan beklemeyle
   * en fazla `FLOW_WORKER_MAX_RESTARTS` kez yeniden açılır.
   */
  private fail(): void {
    this.stopWorker();
    this.restarts++;
    if (this.restarts > FLOW_WORKER_MAX_RESTARTS) {
      this.closed = true;
      console.warn('canlı ara kare (akış) kapatıldı: worker tekrar tekrar yanıt vermedi');
      return;
    }
    this.retryAt = this.now() + 1000 * this.restarts;
  }

  private stopWorker(): void {
    this.reset();
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    this.running = null;
    this.worker?.terminate();
    this.worker = null;
  }

  submit(input: LiveDepthFlowInput): void {
    if (this.closed) return;
    if (!this.worker) {
      if (this.now() < this.retryAt) return;
      this.start();
      if (!this.worker) return;
    }
    if (this.running) { this.pending = input; return; }
    const request = { id: ++this.sequence, generation: this.generation, input };
    this.running = request;
    // A hung worker cannot retain frame arrays forever; model inference continues.
    this.timeout = setTimeout(() => this.fail(), 1500);
    try { this.worker!.postMessage(request); } catch { this.fail(); }
  }

  reset(): void { this.generation++; this.pending = null; }

  dispose(): void {
    this.closed = true;
    this.stopWorker();
  }
}
