// Görev 2 (Gezinme Parça 2) — yenilik/paralaks tabanlı kare seçimi.
//
// SAF ÇEKİRDEK (`yenilikSec`): DOM/canvas YOK, Node'da test edilir
// (scripts/verify-kare-secimi.mjs). `hareket` çağrıcıdan gelir (soyut
// 0..1 paralaks/yenilik ölçüsü) — çekirdek NASIL hesaplandığını bilmez.
//
// TARAYICI TARAFI (`yenilikIncelemesi`): `src/vendor/splat.js/io/video.js`
// `extractSharpFrames`'in `review` kancasına takılır; DOM/canvas/optik akış
// kodu TAMAMEN bu fonksiyonun içinde kalır — saf çekirdek etkilenmez.
import { computeOpticalFlow } from '../vision/flow.ts';

// ---------------------------------------------------------------------------
// Saf çekirdek
// ---------------------------------------------------------------------------

/** Bir aday kare: tarama zamanı (s) ve vendor'ın odak/netlik skoru. */
export interface YenilikAday {
  t: number;
  netlik: number;
}

export interface YenilikSecAyarlari {
  /** hareket(son, aday) bu eşiği geçince aday (penceresiyle) seçilir (0..1, kare genişliğinin kesri). */
  esik: number;
  /** Sonuç bunun altında kalırsa eşik ×0.7 azaltılır (≤ 8 deneme). */
  enAz: number;
  /** Sonuç bunu aşarsa eşik ×1.25 artırılır (≤ 12 deneme). */
  enCok: number;
  /** Son seçilenden bu kadar saniye sonra, hareket eşiği beklenmeden seçim yapılır. */
  enUzunAralikSn: number;
}

/** Eşiğin geçildiği adaydan başlayan pencere boyutu (kendisi + sonraki 2 = 3
 *  aday) — bu pencere içindeki EN NET aday seçilir, tetikleyicinin kendisi
 *  değil (plan: "eşiği geçen ilk adayı değil, ... ilk pencerede netliği en
 *  yüksek adayı seç"). Pencerenin tetikleyiciyi İÇERMESİ gerekir, aksi halde
 *  tetikleyicinin kendisi hiçbir zaman en net aday olarak değerlendirilmez. */
const PENCERE_BOYU = 3;
const ARTIRMA_CARPANI = 1.25;
const ARTIRMA_DENEME_TAVANI = 12;
const AZALTMA_CARPANI = 0.7;
const AZALTMA_DENEME_TAVANI = 8;

/** `hareket`i (a,b) anahtarlı bir önbellekle sarar. Tarayıcı sürümünde
 *  optik akış PAHALI olabilir ve çekirdek eşik-adaptasyon döngüleri boyunca
 *  aynı çifti birden fazla kez sorabilir (her deneme baştan taranır) — bu
 *  sarmalayıcı olmadan her deneme aynı erken çiftleri yeniden hesaplardı. */
function memoizeHareket(hareket: (a: number, b: number) => number): (a: number, b: number) => number {
  const onbellek = new Map<string, number>();
  return (a: number, b: number): number => {
    const anahtar = `${a},${b}`;
    const onceki = onbellek.get(anahtar);
    if (onceki !== undefined) return onceki;
    const deger = hareket(a, b);
    onbellek.set(anahtar, deger);
    return deger;
  };
}

/** Tek bir eşik değeriyle tam bir geçiş: ilk adayı al, ardından son seçilene
 *  göre `hareket` eşiği geçince (ya da `enUzunAralikSn` aşılınca) bir sonraki
 *  seçimi yap. Eşiği geçen İLK aday değil, pencere (tetikleyici + sonraki 2)
 *  içindeki EN NET aday seçilir. Saf ve deterministik — yalnızca verilen
 *  eşikle bir kez tarar (adaptasyon döngüsü `yenilikSec`'te). */
function birGecisSec(
  adaylar: YenilikAday[],
  hareket: (a: number, b: number) => number,
  esik: number,
  enUzunAralikSn: number,
): number[] {
  const n = adaylar.length;
  if (n === 0) return [];
  const secilenler: number[] = [0];
  let son = 0;
  let i = 1;
  while (i < n) {
    const zamanAsti = adaylar[i].t - adaylar[son].t >= enUzunAralikSn;
    // zamanAsti ise hareket'i sormaya gerek yok — hareket() pahalı olabilir,
    // ve maks. aralık kuralı zaten koşulsuz seçim gerektiriyor.
    const esikGecti = zamanAsti || hareket(son, i) >= esik;
    if (esikGecti) {
      const pencereSonu = Math.min(n, i + PENCERE_BOYU);
      let enIyi = i;
      for (let j = i + 1; j < pencereSonu; j++) {
        if (adaylar[j].netlik > adaylar[enIyi].netlik) enIyi = j;
      }
      secilenler.push(enIyi);
      son = enIyi;
      i = enIyi + 1;
    } else {
      i++;
    }
  }
  return secilenler;
}

/**
 * Yenilik/paralaks tabanlı kare seçimi (saf çekirdek).
 *
 * İlk adayı al; ardından son seçilene göre `hareket(son, aday)` (0..1, kare
 * genişliğinin kesri) `esik`'i geçen ilk adayı değil, eşiğin geçildiği
 * penceredeki (tetikleyici + sonraki 2 aday) NETLİĞİ en yüksek adayı seç.
 * `enUzunAralikSn` aşılırsa hareket beklemeden seç. Sonuç `enCok`'u aşarsa
 * eşiği ×1.25 artırıp yeniden dene (≤ 12 kez); ardından `enAz`'ın altındaysa
 * ×0.7 azaltıp yeniden dene (≤ 8 kez). Dönen indeksler `adaylar` içine,
 * artan sırada.
 *
 * `hareket` çağrıları (a,b) anahtarıyla önbelleklenir — adaptasyon
 * döngüsünde aynı çift birden fazla kez SORULMAZ.
 */
export function yenilikSec(
  adaylar: YenilikAday[],
  hareket: (a: number, b: number) => number,
  ayarlar: YenilikSecAyarlari,
): number[] {
  if (adaylar.length === 0) return [];
  const { esik, enAz, enCok, enUzunAralikSn } = ayarlar;
  const hareketOnbellekli = memoizeHareket(hareket);

  let esikSu = esik;
  let secim = birGecisSec(adaylar, hareketOnbellekli, esikSu, enUzunAralikSn);

  for (let deneme = 0; deneme < ARTIRMA_DENEME_TAVANI && secim.length > enCok; deneme++) {
    esikSu *= ARTIRMA_CARPANI;
    secim = birGecisSec(adaylar, hareketOnbellekli, esikSu, enUzunAralikSn);
  }

  const enAzHedef = Math.min(enAz, adaylar.length);
  for (let deneme = 0; deneme < AZALTMA_DENEME_TAVANI && secim.length < enAzHedef; deneme++) {
    esikSu *= AZALTMA_CARPANI;
    secim = birGecisSec(adaylar, hareketOnbellekli, esikSu, enUzunAralikSn);
  }

  return secim;
}

// ---------------------------------------------------------------------------
// Tarayıcı tarafı — extractSharpFrames'in review kancasına takılır
// ---------------------------------------------------------------------------

export interface YenilikIncelemesiAyarlari {
  /** Küçük resim genişliği (px) — hareket hesabının çözünürlüğü ve akış
   *  büyüklüğünün normalize edildiği payda (kare genişliğinin kesri). */
  genislik?: number;
  esik?: number;
  enUzunAralikSn?: number;
}

/** Vendor'ın taradığı tek bir kare (video.js `frames[i]`). */
interface VendorTaramaKaresi {
  t: number;
  focus: number;
  blur?: boolean;
}

/** Vendor'ın tarama sırasında topladığı küçük resim (video.js `thumbs[i]`). */
interface VendorKucukResim {
  t: number;
  index: number;
  canvas: OffscreenCanvas | HTMLCanvasElement;
}

/** `extractSharpFrames`'in `review` kancasına verdiği bağlam — yalnızca
 *  burada kullanılan alanlar (gerçek `VideoReview` çok daha fazlasını taşır:
 *  shots, budget, suggested, plan, ... — bkz. video.js). */
interface VideoIncelemeBaglami {
  frames: VendorTaramaKaresi[];
  picks: number[];
  cap: number;
  thumbs?: VendorKucukResim[];
}

/** 2D çizim bağlamı alınabilen küçük resim tuvali — hem `OffscreenCanvas`
 *  hem `HTMLCanvasElement` için ortak minimum yüzey. */
type ContextAlinabilirTuval = OffscreenCanvas | HTMLCanvasElement;

/**
 * Tarayıcı tarafı: `extractSharpFrames({ ..., review: yenilikIncelemesi(), thumbs })`
 * şeklinde kullanılır. `thumbs` alanı `extractSharpFrames`'e `opts.thumbs`
 * olarak geçilecek ayar nesnesidir; `review` ise tarama bitince çağrılan
 * async fonksiyondur.
 *
 * ADAY SEÇİMİ KARARI: adaylar vendor'ın taradığı BULANIK OLMAYAN kareler
 * (`frames[i].blur !== true`) — vendor'ın otomatik `picks`'inin üst kümesi
 * DEĞİL, taramanın TAM zaman çözünürlüğü. Gerekçe: vendor `picks` yalnızca
 * hareket-penceresi kapanışlarını yansıtır (bkz. `selectByMotion`,
 * `minGapSec`/`maxGapSec` ile sınırlı); bu modülün netlik penceresi ve
 * `enUzunAralikSn` mantığının KENDİ zaman ölçeğinde çalışması için ham
 * (bulanık olmayan) tarama karelerine ihtiyacı var. Bulanık kareler
 * (`blur === true`) vendor'ın `markOutliers`'ı tarafından zaten işaretli —
 * bu modül onları asla aday yapmaz (netlik penceresi asla bulanık bir
 * kareyi seçmesin diye).
 *
 * HAREKET HESABI: iki adayın zamanına EN YAKIN küçük resimler arasında
 * `computeOpticalFlow` (bkz. `src/engine/vision/flow.ts`) çalıştırılır;
 * izlenen (status=1) noktaların akış büyüklüğünün 75. yüzdeliği / `genislik`
 * olarak döner. İzlenen nokta oranı %40'ın altındaysa (yeni görüş — LK
 * takip kaybetti) `hareket = 1` (kesin seçim tetiklenir). Aynı küçük resme
 * eşlenen aday çiftleri için (görüntü verisi özdeş) `hareket = 0` — gerçek
 * bir optik akış hesabı gerekmez.
 */
export function yenilikIncelemesi(ayarlar: YenilikIncelemesiAyarlari = {}): {
  thumbs: { width: number; count: number };
  review: (ctx: VideoIncelemeBaglami) => Promise<{ picks: number[] }>;
} {
  const genislik = ayarlar.genislik ?? 320;
  const esik = ayarlar.esik ?? 0.06;
  const enUzunAralikSn = ayarlar.enUzunAralikSn ?? 1.0;

  return {
    // vendor varsayılanı (360) korunur — daha fazla küçük resim daha ince
    // hareket örneklemesi verir ama tarama belleğini artırır.
    thumbs: { width: genislik, count: 360 },

    async review(ctx: VideoIncelemeBaglami): Promise<{ picks: number[] }> {
      const kareler = ctx.frames ?? [];
      const kucukResimler = ctx.thumbs ?? [];
      if (kareler.length === 0 || kucukResimler.length === 0) {
        return { picks: ctx.picks };
      }

      // Aday indeksleri → gerçek `frames` indeksine geri eşleme (sonda picks
      // gerçek frame indeksleri olarak dönmeli).
      const adayFrameIndeksleri: number[] = [];
      for (let i = 0; i < kareler.length; i++) {
        if (!kareler[i].blur) adayFrameIndeksleri.push(i);
      }
      if (adayFrameIndeksleri.length === 0) return { picks: ctx.picks };

      const adaylar: YenilikAday[] = adayFrameIndeksleri.map((i) => ({
        t: kareler[i].t,
        netlik: kareler[i].focus,
      }));

      // Küçük resim zamanları artan sırada (vendor taramayı zaman sırasında
      // yapar) — ikili arama ile en yakını bulunur.
      const kucukResimZamanlari = kucukResimler.map((k) => k.t);
      const enYakinKucukResimIndeksi = (t: number): number => {
        let lo = 0;
        let hi = kucukResimZamanlari.length - 1;
        if (t <= kucukResimZamanlari[0]) return 0;
        if (t >= kucukResimZamanlari[hi]) return hi;
        while (lo < hi) {
          const orta = (lo + hi) >> 1;
          if (kucukResimZamanlari[orta] < t) lo = orta + 1;
          else hi = orta;
        }
        const sonraki = lo;
        const onceki = Math.max(0, lo - 1);
        return Math.abs(kucukResimZamanlari[onceki] - t) <= Math.abs(kucukResimZamanlari[sonraki] - t)
          ? onceki
          : sonraki;
      };

      // Küçük resim → lüminans (0..1), Tracker/videoPipe ile AYNI katsayılar
      // (0.299/0.587/0.114, /255). Her küçük resim yalnızca bir kez okunur.
      const lumOnbellek = new Map<number, { lum: Float32Array; w: number; h: number }>();
      const lumAl = (kucukIndex: number): { lum: Float32Array; w: number; h: number } => {
        const onbellekte = lumOnbellek.get(kucukIndex);
        if (onbellekte) return onbellekte;
        const tuval = kucukResimler[kucukIndex].canvas as ContextAlinabilirTuval;
        const w = tuval.width;
        const h = tuval.height;
        const baglam = tuval.getContext('2d');
        if (!baglam) throw new Error('yenilikIncelemesi: küçük resim 2d bağlamı alınamadı');
        const ham = baglam.getImageData(0, 0, w, h).data;
        const lum = new Float32Array(w * h);
        for (let p = 0; p < w * h; p++) {
          lum[p] = 0.299 * (ham[p * 4] / 255) + 0.587 * (ham[p * 4 + 1] / 255) + 0.114 * (ham[p * 4 + 2] / 255);
        }
        const sonuc = { lum, w, h };
        lumOnbellek.set(kucukIndex, sonuc);
        return sonuc;
      };

      // (küçükResimA, küçükResimB) çifti başına akış önbelleği: `yenilikSec`
      // yalnızca (aday-a, aday-b) anahtarıyla önbellekler; birden fazla aday
      // aynı küçük resme eşlenebildiğinden (tarama, küçük resimden çok daha
      // ince) burada da EK bir önbellek gerçek optik akış hesabını tekilleştirir.
      const akisOnbellek = new Map<string, number>();
      const hareket = (a: number, b: number): number => {
        const ka = enYakinKucukResimIndeksi(adaylar[a].t);
        const kb = enYakinKucukResimIndeksi(adaylar[b].t);
        if (ka === kb) return 0; // özdeş görüntü verisi — hareket yok
        const ilkK = Math.min(ka, kb);
        const sonK = Math.max(ka, kb);
        const anahtar = `${ilkK},${sonK}`;
        const onceki = akisOnbellek.get(anahtar);
        if (onceki !== undefined) return onceki;

        const prevBoyut = lumAl(ilkK);
        const currBoyut = lumAl(sonK);
        let deger: number;
        if (prevBoyut.w !== currBoyut.w || prevBoyut.h !== currBoyut.h) {
          // Boyut uyuşmazlığı (beklenmez — aynı tarama, aynı thumbPlan) →
          // güvenli taraf: yeni görüş say.
          deger = 1;
        } else {
          const akis = computeOpticalFlow(prevBoyut.lum, currBoyut.lum, prevBoyut.w, prevBoyut.h);
          const izlenen = akis.filter((p) => p.status === 1);
          if (akis.length === 0 || izlenen.length / akis.length < 0.4) {
            deger = 1; // izlenen nokta oranı %40 altı → yeni görüş
          } else {
            const buyukluk = izlenen.map((p) => Math.hypot(p.u, p.v)).sort((x, y) => x - y);
            const idx = Math.min(buyukluk.length - 1, Math.floor(0.75 * buyukluk.length));
            deger = Math.min(1, buyukluk[idx] / genislik);
          }
        }
        akisOnbellek.set(anahtar, deger);
        return deger;
      };

      const enCok = ctx.cap;
      const enAz = Math.min(12, ctx.cap);

      const adayIndeksSecimi = yenilikSec(adaylar, hareket, { esik, enAz, enCok, enUzunAralikSn });
      const picks = adayIndeksSecimi.map((ai) => adayFrameIndeksleri[ai]);
      return { picks };
    },
  };
}
