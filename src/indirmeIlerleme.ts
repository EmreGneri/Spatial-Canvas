/**
 * İNDİRME İLERLEMESİ — model indirmelerini TEK satırda bildirir.
 * DOM'suz, Node'dan test edilir.
 *
 * ── NEDEN ──────────────────────────────────────────────────────────────────
 * Açılış artık modelsiz (ui/acilisSahnesi.ts), ama ziyaretçi KENDİ görüntüsünü
 * yüklediğinde hâlâ ~131 MB iniyor ve ekranda yazan tek şey "işleniyor…".
 * Ölçüldü (2026-10-23): o indirme iyi bir bağlantıda bile onlarca saniye.
 * Hiçbir şeyin değişmediği bir ekran, insana "bozuldu" dedirtir — hoca geri
 * bildirimi de zaten "ne yapacağını bilemedi" idi.
 *
 * Sayıyı göstermek indirmeyi hızlandırmaz; BEKLEMEYİ AÇIKLAR. Beklenen bir
 * bekleme ile sebebi bilinmeyen bir bekleme aynı süre değildir.
 *
 * ── İKİ AYRI KAYNAK, TEK SATIR ─────────────────────────────────────────────
 * Derinlik modeli transformers.js `pipeline()` ile gelir ve `progress_callback`
 * sunar. Nesne ayırma ise doğrudan `ort.InferenceSession.create(yol)` ile
 * yüklenir — geri çağrısı YOKTUR, baytları elle akıtmak gerekir. İkisi de
 * buraya rapor eder; kullanıcı iki ayrı mekanizma olduğunu bilmez, tek bir
 * satır görür.
 */

import { currentPhotoMeasurement } from './engine/photoMeasurement.ts';

export interface IndirmeDurumu {
  /** Kullanıcıya görünen ad: "derinlik modeli", "nesne ayırma" gibi. */
  ad: string;
  /** İnen bayt. */
  inen: number;
  /**
   * Toplam bayt. Sunucu `Content-Length` vermezse (gzip/chunked) BİLİNMEZ
   * olur; o durumda yüzde uydurulmaz, yalnız inen boyut yazılır.
   */
  toplam?: number;
}

/** Bayt → okunur boyut. Binlik ayracı tr-TR, ondalıkta nokta (projenin düzeni). */
export function boyut(bayt: number): string {
  if (bayt < 1024) return `${Math.round(bayt)} B`;
  const kb = bayt / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Göstergede duran tek cümle. Toplam bilinmiyorsa YÜZDE YAZILMAZ — künye
 * kuralıyla aynı: eksik alan uydurulmaz (`paylasim.ts`, `olcumSatiri`).
 */
export function ilerlemeSatiri(d: IndirmeDurumu | null): string | null {
  if (!d) return null;
  if (typeof d.toplam === 'number' && d.toplam > 0) {
    const yuzde = Math.min(100, Math.round((d.inen / d.toplam) * 100));
    return `${d.ad} iniyor · %${yuzde} · ${boyut(d.toplam)}`;
  }
  if (d.inen > 0) return `${d.ad} iniyor · ${boyut(d.inen)}`;
  return `${d.ad} iniyor`;
}

/**
 * Birden çok dosya aynı anda inebilir (model + config + tokenizer). Kullanıcı
 * için önemli olan BÜYÜK olandır; satır onu gösterir, küçükleri saymaz.
 * Eşit toplamda daha çok inmiş olan seçilir ki satır geri sıçramasın.
 */
export function baskinDurum(hepsi: Iterable<IndirmeDurumu>): IndirmeDurumu | null {
  let en: IndirmeDurumu | null = null;
  for (const d of hepsi) {
    if (!en) { en = d; continue; }
    const a = d.toplam ?? d.inen;
    const b = en.toplam ?? en.inen;
    if (a > b || (a === b && d.inen > en.inen)) en = d;
  }
  return en;
}

type Dinleyici = (satir: string | null) => void;

const dinleyiciler = new Set<Dinleyici>();
/** Dosya adı → o dosyanın durumu. Biten dosya listeden düşer. */
const akis = new Map<string, IndirmeDurumu>();

function yayinla() {
  const satir = ilerlemeSatiri(baskinDurum(akis.values()));
  for (const d of dinleyiciler) d(satir);
}

/** Arayüz buradan dinler. Dönen fonksiyon aboneliği bırakır. */
export function indirmeDinle(geriCagri: Dinleyici): () => void {
  dinleyiciler.add(geriCagri);
  return () => dinleyiciler.delete(geriCagri);
}

/** Yükleyiciler ilerlemeyi buradan bildirir. */
export function indirmeBildir(anahtar: string, d: IndirmeDurumu): void {
  akis.set(anahtar, d);
  yayinla();
}

/** Dosya bitti (ya da hata aldı): satırdan düşsün, takılı kalmasın. */
export function indirmeBitti(anahtar: string): void {
  if (!akis.delete(anahtar)) return;
  yayinla();
}

/** Yeni bir işe başlarken artakalan durumları temizler. */
export function indirmeSifirla(): void {
  if (akis.size === 0) return;
  akis.clear();
  yayinla();
}

/**
 * `Content-Length` bilinen bir yanıtı okurken ilerleme bildirir ve baytları
 * toplar. `ort.InferenceSession.create` bir ArrayBuffer kabul ettiği için
 * dosyayı önce buradan geçirip sonra ona vermek, tek ilerleme yolu.
 */
export const MODEL_ONBELLEGI = 'spatial-canvas-modeller-v1';
const COMPLETE_MODEL_CACHE_FORMAT = 'complete-200-v2';

/**
 * Gelen her parçayla yenilenen hareketsizlik sınırı: bağlantı açılıp veri akışı durursa (`fetch` ya da
 * `reader.read()` hiç dönmezse) indirme bu sürede kontrollü bir hatayla biter; arayüz sonsuz beklemez ve
 * çağıranın mevcut hata/kurtarma yolu çalışır. Yavaş ama ilerleyen indirme (parça geliyorsa) kesilmez.
 */
export const INDIRME_HAREKETSIZLIK_MS = 30_000;

async function storageDeadline<T>(operation: Promise<T>, limitMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Model cache read timed out')), limitMs);
    })]);
  } finally { clearTimeout(timer); }
}

/** Cache Storage is optional and has no AbortSignal; a late lookup must not block network recovery. */
export async function readModelCacheResponse(url: string, limitMs = INDIRME_HAREKETSIZLIK_MS): Promise<Response | undefined> {
  if (typeof caches === 'undefined') return undefined;
  try {
    return await storageDeadline(caches.open(MODEL_ONBELLEGI).then(cache => cache.match(url)), limitMs);
  } catch { return undefined; }
}

export interface ModelIntegrity { size: number; sha256: string }

export async function ilerlemeliGetir(
  url: string,
  ad: string,
  getir: typeof fetch = fetch,
  hareketsizlikMs: number = INDIRME_HAREKETSIZLIK_MS,
  integrity?: ModelIntegrity,
): Promise<ArrayBuffer> {
  const control = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => control.abort(new Error(`${ad}: indirme ilerlemedi; check the connection and retry`)), hareketsizlikMs);
  };
  const aborted = new Promise<never>((_, reject) => control.signal.addEventListener('abort', () => reject(control.signal.reason), { once: true }));
  aborted.catch(() => {});
  const fetchResponse = (init?: RequestInit) => Promise.race([getir(url, { ...init, signal: control.signal }), aborted]);
  const trace = currentPhotoMeasurement(), startedAt = trace ? performance.now() : 0;
  const record = (source: 'cache-storage' | 'fetch', bodyBytes: number, status: 'ok' | 'failed') =>
    trace?.recordDownload({ url, label: ad, source, bodyBytes, startedAt, endedAt: performance.now(), status });
  // An HTTPS scheme alone is not a revision. Immutable reuse needs both a pinned URL and trusted bytes.
  const immutable = !!integrity && /\/(?:resolve|models\/microsoft-david)\/[a-f0-9]{40}\//i.test(url);
  const cacheable = typeof caches !== 'undefined' && (/^https:\/\//.test(url) || /^\/[^/]/.test(url)
    || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//.test(url));
  const removeCached = async () => {
    if (!cacheable) return;
    try { await storageDeadline(caches.open(MODEL_ONBELLEGI).then(c => c.delete(url)), Math.min(hareketsizlikMs, 1500)); } catch {}
  };
  const digest = async (buffer: ArrayBuffer, source: string) => {
    const work = async () => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), b => b.toString(16).padStart(2, '0')).join('');
    return trace ? trace.measure(`download.integrity.${source}`, work) : work();
  };
  const readCached = async (response: Response) => {
    // Old writers hashed partial 206 bodies too; only a trusted manifest can validate those entries.
    if (!integrity && response.headers?.get('x-model-cache-format') !== COMPLETE_MODEL_CACHE_FORMAT)
      throw new Error('Cached model completeness is unknown; download the complete model once');
    const buffer = await storageDeadline(response.arrayBuffer(), hareketsizlikMs);
    const size = integrity?.size ?? Number(response.headers?.get('x-model-byte-length') ?? 0);
    const hash = integrity?.sha256 ?? response.headers?.get('x-model-sha256');
    // An ETag/304 cannot certify local bytes; legacy entries must be downloaded once to gain integrity metadata.
    if (!Number.isSafeInteger(size) || size <= 0 || !hash || !/^[a-f0-9]{64}$/.test(hash))
      throw new Error('Cached model has no integrity metadata');
    if (size !== buffer.byteLength) throw new Error('Cached model byte length mismatch');
    if (await storageDeadline(digest(buffer, 'cache'), hareketsizlikMs) !== hash) throw new Error('Cached model checksum mismatch');
    return buffer;
  };
  let stored = cacheable ? await readModelCacheResponse(url, Math.min(hareketsizlikMs, 1500)) : undefined;
  if (immutable && stored) {
    try { const buffer = await readCached(stored); record('cache-storage', buffer.byteLength, 'ok'); return buffer; }
    catch { record('cache-storage', 0, 'failed'); await removeCached(); stored = undefined; }
  }
  const etag = stored?.headers?.get('etag');
  let received = 0;
  try {
    reset();
    let response = await fetchResponse(etag ? { headers: { 'If-None-Match': etag }, cache: 'no-store' } : undefined);
    if (response.status === 304 && stored) {
      clearTimeout(timer);
      try { const buffer = await readCached(stored); record('cache-storage', buffer.byteLength, 'ok'); return buffer; }
      catch {
        record('cache-storage', 0, 'failed'); await removeCached(); reset();
        response = await fetchResponse({ cache: 'no-store' });
      }
    }
    // No Range request is sent: a partial representation cannot establish complete-model integrity.
    if (response.status === 206) {
      try { void response.body?.cancel().catch(() => {}); } catch {}
      throw new Error(`${ad}: Partial model response (206); reload and retry the complete download`);
    }
    if (!response.ok) throw new Error(`${ad}: ${response.status} ${response.statusText}`);
    const length = Number(response.headers.get('content-length') ?? 0);
    let buffer: ArrayBuffer;
    if (!response.body) {
      buffer = await Promise.race([response.arrayBuffer(), aborted]); received = buffer.byteLength;
    } else {
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const { done, value } = await Promise.race([reader.read(), aborted]);
          if (done) break;
          if (!value) continue;
          reset(); chunks.push(value); received += value.byteLength;
          indirmeBildir(url, { ad, inen: received, toplam: length > 0 ? length : undefined });
        }
      } catch (error) {
        try { void Promise.resolve(reader.cancel?.()).catch(() => {}); } catch {}
        throw error;
      } finally { indirmeBitti(url); }
      const bytes = new Uint8Array(received); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      chunks.length = 0; buffer = bytes.buffer;
    }
    // Content-Length describes compressed bytes when Content-Encoding is present; compare only identity bodies.
    const encoding = response.headers.get('content-encoding');
    if (length > 0 && (!encoding || encoding === 'identity') && length !== received)
      throw new Error(`${ad}: Incomplete model byte length; reload and retry`);
    if (integrity && received !== integrity.size) throw new Error(`${ad}: Model byte length mismatch; check deployed assets`);
    const responseEtag = response.headers.get('etag');
    const persist = response.status === 200 && cacheable && (immutable || !!responseEtag);
    const hash = integrity || persist ? await Promise.race([digest(buffer, 'fetch'), aborted]) : null;
    if (integrity && hash !== integrity.sha256) throw new Error(`${ad}: Model checksum mismatch; check deployed assets`);
    if (persist && hash) {
      const headers: Record<string, string> = {
        'x-model-byte-length': String(received), 'x-model-sha256': hash,
        'x-model-cache-format': COMPLETE_MODEL_CACHE_FORMAT,
      };
      if (responseEtag) headers.etag = responseEtag;
      // Response copies the bytes synchronously; cache writes never hold up GPU setup or inference.
      const cached = new Response(buffer, { headers });
      void Promise.resolve().then(() => caches.open(MODEL_ONBELLEGI)).then(c => c.put(url, cached)).catch(() => {});
    }
    record('fetch', received, 'ok'); return buffer;
  } catch (error) { record('fetch', received, 'failed'); throw error; }
  finally { clearTimeout(timer); indirmeBitti(url); }
}
