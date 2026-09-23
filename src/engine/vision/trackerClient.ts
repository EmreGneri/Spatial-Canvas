import {
  Tracker,
  TRACKER_DEFAULTS,
  TRACKER_HEIGHT,
  TRACKER_WIDTH,
  type DetectionStatus,
  type TrackedTarget,
  type TrackerModu,
  type TrackerOptions,
} from './tracker.ts';

interface WorkerResult {
  type: 'result';
  generation: number;
  targets: TrackedTarget[];
  status: DetectionStatus;
}

/** Keeps the HUD's synchronous read API while CV and detection run in a worker. */
export class TrackerClient {
  private worker: Worker | null = null;
  private fallback: Tracker | null = null;
  private readonly options: TrackerOptions;
  private readonly stride: number;
  private frameCount = 0;
  private busy = false;
  private currentGeneration = 0;
  private currentMode: TrackerModu;
  private currentTargets: TrackedTarget[] = [];
  private currentStatus: DetectionStatus = { phase: 'idle', error: null };
  private captureCanvas: HTMLCanvasElement | null = null;
  private captureContext: CanvasRenderingContext2D | null = null;

  constructor(options: TrackerOptions = {}, forceMainThread = false) {
    this.options = options;
    this.stride = options.everyNFrames ?? TRACKER_DEFAULTS.everyNFrames;
    this.currentMode = options.mod ?? TRACKER_DEFAULTS.mod;
    if (forceMainThread || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' ||
      typeof createImageBitmap === 'undefined' || typeof navigator === 'undefined' || !navigator.locks?.request) {
      this.fallback = new Tracker(options);
      return;
    }
    try {
      this.worker = new Worker(new URL('./trackerWorker.ts', import.meta.url), { type: 'module' });
      this.worker.postMessage({ type: 'init', options });
      this.worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        if (event.data.type !== 'result') return;
        this.busy = false;
        if (event.data.generation !== this.currentGeneration) return;
        this.currentTargets = event.data.targets;
        this.currentStatus = event.data.status;
      };
      this.worker.onerror = (event) => {
        console.error('[tracker] Worker failed; using main-thread fallback', event.message);
        this.worker?.terminate();
        this.worker = null;
        this.fallback = new Tracker({ ...this.options, mod: this.currentMode });
        this.busy = false;
        this.currentTargets = [];
        this.currentGeneration++;
      };
    } catch {
      this.fallback = new Tracker(options);
    }
  }

  get status(): DetectionStatus {
    return this.fallback?.status ?? this.currentStatus;
  }

  get generation(): number {
    return this.currentGeneration;
  }

  get mod(): TrackerModu {
    return this.currentMode;
  }

  setMod(mode: TrackerModu): void {
    if (mode === this.currentMode) return;
    this.currentMode = mode;
    this.currentGeneration++;
    this.currentTargets = [];
    this.currentStatus = { phase: 'idle', error: null };
    if (this.fallback) this.fallback.setMod(mode);
    else this.worker?.postMessage({ type: 'mode', mode });
  }

  reset(): void {
    this.currentGeneration++;
    this.frameCount = 0;
    this.currentTargets = [];
    this.currentStatus = { phase: 'idle', error: null };
    if (this.fallback) this.fallback.reset();
    else this.worker?.postMessage({ type: 'reset' });
  }

  step(source: HTMLCanvasElement): TrackedTarget[] {
    if (this.fallback) return this.fallback.step(source);
    if (!this.worker) return this.currentTargets;
    this.frameCount++;
    if (this.frameCount % this.stride !== 0 || this.busy) return this.currentTargets;

    this.busy = true;
    const generation = this.currentGeneration;
    if (!this.captureCanvas) {
      this.captureCanvas = document.createElement('canvas');
      this.captureContext = this.captureCanvas.getContext('2d');
    }
    const canvas = this.captureCanvas;
    const context = this.captureContext;
    if (!context) {
      this.busy = false;
      return this.currentTargets;
    }
    // Copy only the pixels the worker needs. A full-resolution WebGL bitmap
    // forced a costly GPU readback even for the 128x72 feature tracker.
    const scale = this.currentMode === 'nesne' ? 384 / Math.max(source.width, source.height) : 0;
    const width = this.currentMode === 'nesne'
      ? Math.max(1, Math.round(source.width * scale)) : TRACKER_WIDTH;
    const height = this.currentMode === 'nesne'
      ? Math.max(1, Math.round(source.height * scale)) : TRACKER_HEIGHT;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    // Engine calls this in the post-render task, while its drawing buffer is valid.
    context.drawImage(source, 0, 0, width, height);
    void createImageBitmap(canvas).then((frame) => {
      if (generation !== this.currentGeneration || !this.worker) {
        frame.close();
        this.busy = false;
        return;
      }
      this.worker.postMessage({ type: 'frame', frame, generation }, [frame]);
    }).catch((error: unknown) => {
      this.busy = false;
      console.error('[tracker] Frame capture failed', error);
    });
    return this.currentTargets;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
