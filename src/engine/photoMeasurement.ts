// Yalnız ?olcum=1: yerel tanı raporu; ağ isteği veya otomatik dosya yazımı yapmaz.
export interface PhotoMeta { generation: number; width: number; height: number }
export interface PhotoSpan {
  name: string; startedAt: number; endedAt: number; durationMs: number;
  status: 'ok' | 'failed' | 'cancelled';
}
export interface PhotoDownload {
  url: string; label: string; source: 'cache-storage' | 'fetch'; bodyBytes: number;
  startedAt: number; endedAt: number; status: 'ok' | 'failed';
}
export interface PhotoResource {
  url: string; initiatorType: string; startedAt: number; durationMs: number;
  transferBytes: number | null; encodedBodyBytes: number; decodedBodyBytes: number;
}
export interface PhotoReport {
  id: number; meta: PhotoMeta; startedAt: number; endedAt: number; totalMs: number;
  status: 'ready' | 'failed' | 'cancelled'; metadata: Record<string, unknown>;
  spans: PhotoSpan[]; downloads: PhotoDownload[]; resources: PhotoResource[];
  downloadBytes: { cacheStorageBodyBytes: number; fetchBodyBytes: number };
  resourceBytes: { observedTransferBytes: number; unknownTransferCount: number };
  resourceScope: string;
}
export interface OutputReport {
  format: string; startedAt: number; endedAt: number; wallMs: number;
  status: 'ok' | 'failed'; lastPhotoId: number | null; metadata: Record<string, unknown>;
}

let current: PhotoMeasurement | null = null;
let sequence = 0;
let lastPhotoId: number | null = null;
const now = () => performance.now();
function enabled(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('olcum') === '1';
}
function cleanUrl(value: string): string {
  try {
    const url = new URL(value, typeof location === 'undefined' ? 'http://localhost/' : location.href);
    url.search = ''; url.hash = ''; url.username = ''; url.password = '';
    return url.href;
  } catch { return value.split(/[?#]/)[0]; }
}
function publish(key: '__photoMeasurements' | '__outputMeasurements', report: PhotoReport | OutputReport): void {
  if (typeof window !== 'undefined') {
    const host = window as unknown as Record<string, (PhotoReport | OutputReport)[]>;
    const history = host[key] ??= [];
    history.push(report);
    if (history.length > 10) history.splice(0, history.length - 10);
  }
  console.info(key === '__photoMeasurements' ? '[photo-measurement]' : '[output-measurement]', report);
}

export class PhotoMeasurement {
  readonly id = ++sequence;
  readonly startedAt = now();
  private spans: PhotoSpan[] = [];
  private downloads: PhotoDownload[] = [];
  private resources: PerformanceResourceTiming[] = [];
  private pending = new Set<{ name: string; startedAt: number }>();
  private observer: PerformanceObserver | null = null;
  private report: PhotoReport | null = null;
  private meta: PhotoMeta;

  constructor(meta: PhotoMeta) {
    this.meta = { ...meta };
    // Observer, resource tamponu dolsa bile bu oturumda görülen kayıtları korur.
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        this.observer = new PerformanceObserver(list => {
          if (!this.report) this.resources.push(...list.getEntries() as PerformanceResourceTiming[]);
        });
        this.observer.observe({ type: 'resource', buffered: true });
      } catch { this.observer?.disconnect(); this.observer = null; }
    }
  }

  async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (this.report) return fn();
    const span = { name, startedAt: now() };
    this.pending.add(span);
    let status: PhotoSpan['status'] = 'failed';
    try { const value = await fn(); status = 'ok'; return value; }
    finally { this.completeSpan(span, status); }
  }

  measureSync<T>(name: string, fn: () => T): T {
    if (this.report) return fn();
    const span = { name, startedAt: now() };
    this.pending.add(span);
    let status: PhotoSpan['status'] = 'failed';
    try { const value = fn(); status = 'ok'; return value; }
    finally { this.completeSpan(span, status); }
  }

  private completeSpan(span: { name: string; startedAt: number }, status: PhotoSpan['status']): void {
    this.pending.delete(span);
    if (this.report) return;
    const endedAt = now();
    this.spans.push({ ...span, endedAt, durationMs: Math.max(0, endedAt - span.startedAt), status });
  }

  recordDownload(download: PhotoDownload): void {
    if (this.report) return;
    this.downloads.push({ ...download, url: cleanUrl(download.url),
      bodyBytes: Number.isFinite(download.bodyBytes) ? Math.max(0, download.bodyBytes) : 0 });
  }

  finish(status: PhotoReport['status'], metadata: Record<string, unknown> = {}): PhotoReport {
    if (this.report) return this.report;
    const endedAt = now();
    if (this.observer) {
      this.resources.push(...this.observer.takeRecords() as PerformanceResourceTiming[]);
      this.observer.disconnect();
      this.observer = null;
    }
    this.resources.push(...performance.getEntriesByType('resource') as PerformanceResourceTiming[]);
    const seen = new Set<string>();
    const resources: PhotoResource[] = [];
    for (const entry of this.resources) {
      if (entry.startTime < this.startedAt || entry.startTime > endedAt) continue;
      const key = `${entry.name}|${entry.startTime}|${entry.responseEnd}|${entry.duration}`;
      if (seen.has(key)) continue;
      seen.add(key);
      resources.push({ url: cleanUrl(entry.name), initiatorType: entry.initiatorType,
        startedAt: entry.startTime, durationMs: entry.duration,
        // 0, TAO eksikliği de olabilir; özellikle cross-origin'de cache diye etiketlenmez.
        transferBytes: entry.transferSize > 0 ? entry.transferSize : null,
        encodedBodyBytes: entry.encodedBodySize, decodedBodyBytes: entry.decodedBodySize });
    }
    for (const span of this.pending) this.spans.push({ ...span, endedAt,
      durationMs: Math.max(0, endedAt - span.startedAt), status: 'cancelled' });
    this.pending.clear();
    this.report = { id: this.id, meta: { ...this.meta }, startedAt: this.startedAt, endedAt,
      totalMs: Math.max(0, endedAt - this.startedAt), status, metadata,
      spans: this.spans, downloads: this.downloads, resources,
      downloadBytes: { cacheStorageBodyBytes: 0, fetchBodyBytes: 0 },
      resourceBytes: { observedTransferBytes: 0, unknownTransferCount: 0 },
      resourceScope: 'Resource starts inside the photo window; background requests may be included. Download body bytes and Resource Timing transport bytes overlap: do not add them. Nested span durations overlap: do not sum them.' };
    for (const download of this.downloads) {
      if (download.source === 'cache-storage') this.report.downloadBytes.cacheStorageBodyBytes += download.bodyBytes;
      else this.report.downloadBytes.fetchBodyBytes += download.bodyBytes;
    }
    for (const resource of resources) {
      if (resource.transferBytes === null) this.report.resourceBytes.unknownTransferCount++;
      else this.report.resourceBytes.observedTransferBytes += resource.transferBytes;
    }
    this.resources = [];
    if (current === this) current = null;
    if (status === 'ready') lastPhotoId = this.id;
    publish('__photoMeasurements', this.report);
    return this.report;
  }
}

export function beginPhotoMeasurement(meta: PhotoMeta, forceEnabled?: boolean): PhotoMeasurement | null {
  if (!(forceEnabled ?? enabled())) return null;
  current?.finish('cancelled', { reason: 'superseded' });
  current = new PhotoMeasurement(meta);
  return current;
}
export function currentPhotoMeasurement(): PhotoMeasurement | null { return current; }

/** Dışa aktarım fotoğraf hazırlığından ayrı ölçülür; wallMs saf encoder süresi değildir. */
export function measureOutput<T>(format: string, task: () => Promise<T>, metadata: Record<string, unknown> = {}): Promise<T> {
  if (!enabled()) return task();
  const startedAt = now(), photoId = lastPhotoId;
  const complete = (status: OutputReport['status']) => {
    const endedAt = now();
    publish('__outputMeasurements', { format, startedAt, endedAt,
      wallMs: Math.max(0, endedAt - startedAt), status, lastPhotoId: photoId, metadata });
  };
  try {
    return task().then(value => { complete('ok'); return value; }, error => { complete('failed'); throw error; });
  } catch (error) { complete('failed'); throw error; }
}
