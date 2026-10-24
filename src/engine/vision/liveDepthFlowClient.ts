import type { LiveDepthFlowInput, LiveDepthFlowResult } from './liveDepthFlow.ts';

export interface FlowRequest { id: number; generation: number; input: LiveDepthFlowInput }
export interface FlowResponse { id: number; generation: number; result?: LiveDepthFlowResult; error?: string }

/** One running task and one replaceable latest frame keep latency bounded. */
export class LiveDepthFlowClient {
  private worker: Worker | null = null;
  private generation = 0;
  private sequence = 0;
  private running: FlowRequest | null = null;
  private pending: LiveDepthFlowInput | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private onResult: (result: LiveDepthFlowResult, input: LiveDepthFlowInput) => void;

  constructor(
    onResult: (result: LiveDepthFlowResult, input: LiveDepthFlowInput) => void,
    createWorker: () => Worker = () => new Worker(new URL('./liveDepthFlowWorker.ts', import.meta.url), { type: 'module' }),
  ) {
    this.onResult = onResult;
    try {
      this.worker = createWorker();
      this.worker.onmessage = (event: MessageEvent<FlowResponse>) => {
        const response = event.data, request = this.running;
        if (!request || response.id !== request.id || this.closed) return;
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = null;
        this.running = null;
        if (response.error) { this.dispose(); return; }
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
      this.worker.onerror = () => this.dispose();
      this.worker.onmessageerror = () => this.dispose();
    } catch { this.closed = true; }
  }

  submit(input: LiveDepthFlowInput): void {
    if (this.closed || !this.worker) return;
    if (this.running) { this.pending = input; return; }
    const request = { id: ++this.sequence, generation: this.generation, input };
    this.running = request;
    // A hung worker cannot retain frame arrays forever; model inference continues.
    this.timeout = setTimeout(() => this.dispose(), 1500);
    try { this.worker.postMessage(request); } catch { this.dispose(); }
  }

  reset(): void { this.generation++; this.pending = null; }

  dispose(): void {
    this.closed = true;
    this.reset();
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    this.running = null;
    this.worker?.terminate();
    this.worker = null;
  }
}
