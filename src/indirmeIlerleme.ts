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
const MODEL_ONBELLEGI = 'spatial-canvas-modeller-v1';

export async function ilerlemeliGetir(
  url: string,
  ad: string,
  getir: typeof fetch = fetch,
): Promise<ArrayBuffer> {
  // Sabit revizyonlu uzak modeller (Hugging Face) Cache Storage'da tutulur: ikinci ziyarette
  // yeniden inmez. HTTP önbelleği yüzlerce MB'lık dosyaları güvenilir tutmuyor. Önbellek yoksa
  // (gizli pencere, kota, eski tarayıcı) sessizce normal indirmeye düşülür.
  const onbellekli = /^https:\/\//.test(url) && typeof caches !== 'undefined';
  if (onbellekli) {
    try {
      const kayit = await (await caches.open(MODEL_ONBELLEGI)).match(url);
      if (kayit) return await kayit.arrayBuffer();
    } catch { /* önbellek erişilemez: indirmeye devam */ }
  }
  const yanit = await getir(url);
  if (!yanit.ok) throw new Error(`${ad}: ${yanit.status} ${yanit.statusText}`);
  const uzunluk = Number(yanit.headers.get('content-length') ?? 0);
  // Gövde akıtılamıyorsa (eski tarayıcı, önbellekten dönen yanıt) ilerleme
  // yok ama indirme ÇALIŞMALI: sessizce tam okumaya düşülür.
  if (!yanit.body) return yanit.arrayBuffer();

  const okuyucu = yanit.body.getReader();
  const parcalar: Uint8Array[] = [];
  let inen = 0;
  try {
    for (;;) {
      const { done, value } = await okuyucu.read();
      if (done) break;
      if (!value) continue;
      parcalar.push(value);
      inen += value.byteLength;
      indirmeBildir(url, { ad, inen, toplam: uzunluk > 0 ? uzunluk : undefined });
    }
  } finally {
    indirmeBitti(url);
  }

  const hepsi = new Uint8Array(inen);
  let konum = 0;
  for (const p of parcalar) {
    hepsi.set(p, konum);
    konum += p.byteLength;
  }
  if (onbellekli) {
    try { await (await caches.open(MODEL_ONBELLEGI)).put(url, new Response(hepsi.slice())); } catch { /* kota dolu: sorun değil */ }
  }
  return hepsi.buffer;
}
