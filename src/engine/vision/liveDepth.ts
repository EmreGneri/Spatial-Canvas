import {
  applyDetail,
  applyForegroundStretch,
  yeniStretchAraligi,
  applySobelRelief,
  DETAIL_STRENGTH_DEFAULT,
  gpuSirasinaGir,
  limitDepthSlope,
  loadTransformers,
  onceRetry,
  smoothDepthSteps,
  SOBEL_RELIEF_DEFAULT,
  trimmedRange,
  webgpuKullanilabilir,
  type DepthResult,
} from '../../depth.ts';
import { resampleBilinear } from '../reconstruction/silhouette.ts';
import { localInference, localInferenceAvailable, type RawTensor } from '../sidecarClient.ts';

/**
 * CANLI VİDEO DERİNLİĞİ — düz video yükleme yolunun (sürükle-bırak → canlı 3B)
 * derinlik kaynağı.
 *
 * NEDEN AYRI MODÜL: `depth.ts` tek kare FOTOĞRAF yolunun sahibidir — kalite
 * öncelikli, `-base` modeli, özne kırpma çıkarımı, stretch, sobel rölyefi,
 * eğim sınırlayıcı; ve zaten 1200+ satır. Canlı yolun öncelikleri tersidir
 * (tempo öncelikli, `-small`, tek geçiş, son işlem yok). İkisini tek dosyada
 * tutmak iki farklı bütçeyi aynı yerde tartıştırırdı.
 */

/**
 * Canlı yolun model girdi kenarı (piksel). Ölçüm — 2026-08-22, Intel UHD
 * (gen-12lp) iGPU, `depth-anything-v2-small` fp16 WebGPU, `AutoModel` DOĞRUDAN
 * (`pipeline()` atlanmış), kaynak 384×288, ısınma hariç medyan:
 *
 *   girdi 154 →  64 ms (15.6 Hz)   girdi 252 → 106 ms (9.4 Hz)
 *   girdi 378 → (ölçülmedi)        girdi 518 → 263 ms (3.8 Hz)
 *
 * ── 2026-08-24: 252 → 154 (tempo kararı, ölçümle) ────────────────────────
 * Uygulamanın KENDİ turu içeriden ölçüldü (geçici kayıtla, dışarıdan
 * kirletmeden): tur medyanı 285.9 ms = 3.5 Hz; bunun ~228 ms'i çıkarım,
 * 56.3 ms'i `Engine.setDepth`, 1.4 ms'i sürüklenme ölçümü. CPU aşamaları ucuz
 * çıktı (son-işleme 16.5 ms, maske örnekleme 1.4 ms, zamansal filtre 0.2 ms) —
 * darboğaz çıkarımdır.
 *
 * 154 seçildi çünkü canlı yolun ASIL tüketicisi kabuktur ve kabuk ızgarası
 * `MESH_GRID_SIZE_LIVE` = 96: girdi 154'te derinlik haritası 266×154 olur, yani
 * kabuğun örneklediğinden hâlâ fazladır. Ölçülen sonuç:
 *
 *   tur medyanı 285.9 → 173.2 ms (−%39) · uygulama logu 4.1-4.3 Hz
 *
 * BEDELİ nokta bulutundadır: 384² konum ızgarası artık 266×154'lük bir
 * haritadan yukarı örnekler, yüzey biraz daha yumuşak. Kabuk (solid) ve splat
 * yolları etkilenmez.
 *
 * NOT: aynı ölçüm `pipeline()` ile girdiden BAĞIMSIZ ~300 ms veriyordu — fark
 * pipeline'ın ham çıktıyı kaynak boyuta JS'te geri interpole etmesi. Bize
 * gerekmiyor: `Engine.setDepth` kendi boyutunu kabul eder.
 */
export const LIVE_INPUT_SIZE = 154;

/**
 * OYNATMA TAVANI — video OYNARKEN izin verilen en buyuk girdi kenari.
 *
 * Kalite secicisi uc boyut sunuyor; olculen kare basina cikarim sureleri:
 *
 *   154 -> 128-330 ms  (3.0-7.8 Hz)
 *   252 -> 677 ms      (1.5 Hz)
 *   378 -> 1877 ms     (0.53 Hz)
 *
 * SECIM ILKESI (sayidan once): canli bir ayar, video oynarken saniyede en az
 * BIR derinlik guncellemesi uretmelidir. Bunun altinda geometri kullanicinin
 * gordugu kareyi takip etmez — 378'de surekli ~2 saniye geride kalir ve mod
 * "canli" olmaktan cikar. Olcume gore kosulu 154 ve 252 saglar, 378 saglamaz.
 *
 * DURAKLATILMIS karede tavan YOKTUR: tek kare icin 1877 ms kabul edilebilir
 * bir bekleme ve yuksek detay tam da orada anlamlidir. Secenek silinmiyor,
 * baglamina tasiniyor.
 */
export const LIVE_PLAYBACK_MAX_INPUT = 252;

/**
 * Secilen kalitenin O ANDA kullanilacak hali.
 *
 * Kapi burada, cagiranin iyi niyetinde degil: girdi boyutunu ureten TEK yer
 * burasidir, dolayisiyla tavan atlanamaz.
 */
export function canliGirdiBoyutu(secilen: number, duraklatildi: boolean): number {
  if (!Number.isFinite(secilen) || secilen <= 0) return LIVE_INPUT_SIZE;
  return duraklatildi ? secilen : Math.min(secilen, LIVE_PLAYBACK_MAX_INPUT);
}

/**
 * Kare yakalama tuvalinin boyutu: en-boy KORUNUR, uzun kenar sabitlenir.
 *
 * Processor girdiyi zaten `LIVE_INPUT_SIZE`'a ölçekleyecek; buradaki tek amaç
 * `getImageData` maliyetini videonun tam çözünürlüğünden kurtarmak. En-boyu
 * bozup kareye sıkıştırmak modele YANLIŞ geometri gösterirdi (dikey videoda
 * özne yayvan görünür).
 */
export function liveGrabSize(vw: number, vh: number, uzunKenar = 384): { w: number; h: number } {
  if (!(vw > 0) || !(vh > 0)) return { w: uzunKenar, h: uzunKenar };
  const k = uzunKenar / Math.max(vw, vh);
  return { w: Math.max(1, Math.round(vw * k)), h: Math.max(1, Math.round(vh * k)) };
}

/** Normalize kadraj koordinatında kırpma dikdörtgeni (0..1). */
export interface KirpmaKutusu {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Özne kadrajın bu kadarını zaten kaplıyorsa kırpmak yeni çözünürlük vermez.
 *  Fotoğraf yolundaki `CROP_SKIP_AREA` ile aynı ilke ve aynı değer. */
export const KIRPMA_ATLAMA_ALANI = 0.75;
/**
 * Kırpmanın uygulandığı ALT sınır — kutu bundan darsa kırpma YOK.
 *
 * ÖLÇÜLEN GERİLEME (test-yakin.mp4 t=1, kutu alanı 0.277): kırpma rölyefin
 * %30'unu kaybettiriyor (0.5907 → 0.4121). O karede özne, kadrajın alt
 * kenarından KESİK bir baş parçası; kırpınca modelin derinlik referansı olan
 * sahne bağlamı (ağaç, duvar, pencere) tamamen gidiyor ve model öznenin
 * derinlik dağılımını farklı üretiyor.
 *
 * Tavan hipotezi ÖLÇÜLDÜ VE ÇÜRÜDÜ: `KIRPMA_IZGARA_TAVANI` 384 → 1024
 * yapılınca ızgara 384×338'den 598×338'e çıkıyor ama rölyef değişmiyor
 * (0.4121 → 0.4107). Gerileme tavandan gelmiyor.
 *
 * ── BU EŞİK BİR KORUMA, AYARLANMIŞ OPTİMUM DEĞİL ──────────────────────────
 * Ölçülen KAZANÇLI kutular: 0.490 (×1.43), 0.518 (×1.16), 0.548 (×1.06).
 * Ölçülen KAYIPLI kutu: 0.277 (×0.70). Eşik ikisinin arasına kondu.
 *
 * Sınırlar açıkça söylenmeli: negatif gözlem n=1, ve kırpmanın fiilen
 * çalıştığı TÜM ölçümler tek sahneden geliyor (test-canli ve test-yakin aynı
 * çekim; heykel karesinde kırpma zaten atlanıyor). 0.35'in ALTINDA kazanç
 * gösteren tek bir ölçüm YOK — oradaki ×3.16 yalnız bir örnekleme sayımıydı,
 * rölyef olarak hiç doğrulanmadı. Bu yüzden bilinmeyen bölge açık
 * bırakılmıyor, kapatılıyor: kanıtsız kazanç için ölçülmüş kayıp riski
 * alınmaz. Daha çok sahneyle yeniden ölçülünce gevşetilebilir.
 */
export const KIRPMA_MIN_ALAN = 0.35;
/**
 * Kutunun özne çevresinde bıraktığı pay (kadraj oranı).
 *
 * SÜPÜRÜLDÜ (2026-09-10, test-canli.mp4 t=3.0s, girdi 154, aynı maske;
 * rölyef = maske içi p25–p75, |∇| = maske içi ortalama gradyan):
 *
 *   pay    kutu alanı   rölyef    |∇|
 *   0.00     0.4353     0.2687   7.7461
 *   0.02     0.4759     0.3154   7.6625
 *   0.04     0.5180     0.3427   7.5882   ← en iyi, DEĞİŞTİRİLMEDİ
 *   0.06     0.5617     0.2720   7.0976
 *   0.08     0.6070     0.2806   6.6687
 *
 * KAZANÇ YOK: mevcut değer zaten tepede. Kutuyu daraltarak kazanç aramak bu
 * klipte ölçüldü ve çıkmaz. Tekrar denenmesin.
 *
 * PAY YALNIZ KENAR KORUMASI DEĞİL: sıfır payla rölyef kırpmasız tabanın
 * (0.2963) bile ALTINA düşüyor, ve tepe dar — ±0.02'lik değişim rölyefi %20+
 * oynatıyor.
 *
 * ── SEBEP: İKİ HİPOTEZ KURDUM, İKİSİ DE ÖLÇÜMLE ÇÜRÜDÜ ────────────────────
 *
 * Önce "maske-duyarlı `applyForegroundStretch` kutuda arka plan olmasına
 * ihtiyaç duyuyor" diye yazmıştım. YANLIŞTI. İzole deney (öznenin kendi
 * derinlik dağılımı sabit, yalnız doluluk oranı değişiyor):
 *
 *   doluluk   %20    %35    %50    %65    %80    %90    %97   %100
 *   çıktı     0.5401 hepsinde AYNI
 *
 * Stretch doluluk oranına tamamen duyarsız — koda bakınca zaten aşikâr: her
 * döngüsü `mask[i] >= STRETCH_MASK_LO` ile korumalı, arka planı hiç görmüyor.
 *
 * İkinci hipotez: payın gerçekte değiştirdiği şey ızgara çözünürlüğü
 * (189×244 … 236×315), belki son-işleme zinciri çözünürlüğe duyarlıdır.
 * O DA YANLIŞTI. Aynı sürekli sahne farklı ızgaralarda örneklendiğinde:
 *
 *   ızgara    154×210  189×244  210×278  236×315  320×420
 *   rölyef     0.5152   0.5381   0.5246   0.5350   0.5335
 *   |∇|        4.1945   4.1651   4.2067   4.1960   4.2168
 *
 * Sistematik eğilim yok; kalan oynama sentetik örnekleme gürültüsü.
 *
 * ── GERİYE KALAN AÇIKLAMA ─────────────────────────────────────────────────
 * Duyarlılık BİZİM son-işlememizde değil, MODELDE. Derinlik modeli özneyi
 * saran bağlam miktarına göre öznenin derinlik dağılımını farklı ŞEKİLDE
 * üretiyor. Bu bir kusur değil, model davranışı — düzeltilecek bir kod yok.
 *
 * Sonuç: 0.04 "kanıtlanmış optimum" DEĞİL, tek karede "ölçülen en iyi".
 * Değiştirmek için de bir sebep çıkmadı.
 *
 * Kutunun kendisi zaten dar: uç-değerler şişirmiyor (ham bbox 0.652×0.665,
 * uçtan %0.1 atınca 0.641×0.660 — fark %2.5). Daha fazla daraltmak ancak
 * gerçek anatomiyi keserek olur (kafanın tepesi, parmak uçları) — bu projenin
 * hedefiyle çelişir ve kapı [3]'ü ihlal eder.
 */
const KIRPMA_PAY = 0.04;
/** Kutunun oynaması için gereken en küçük değişim (kadraj oranı).
 *  Altında kutu SABİT kalır — bkz. `canliKirpmaKutusu` docstring'i. */
const KIRPMA_HISTEREZIS = 0.05;
/** Geri gömme ızgarasının tavanı — örnekleyicinin kendi ızgarası (384²,
 *  `POSITION_TEXTURE_SIZE`). Üstüne çıkmak render'a hiçbir şey taşımaz,
 *  yalnız son-işleme geçişlerini pahalılaştırır. */
const KIRPMA_IZGARA_TAVANI = 384;

/**
 * ÖZNE KIRPMA KUTUSU — modelin özneyi YAKINDAN görmesi için.
 *
 * Canlı derinlik tüm kareyi model girdisine sıkıştırır. Özne kadrajın küçük
 * bir parçasıysa gövde modele birkaç düzine piksel gider ve modelin gövdenin
 * KENDİ yüzey rölyefini (burun çıkıntısı, göğüs eğrisi) çözecek çözünürlüğü
 * kalmaz: sahne sıralaması doğru çıkar, yüzey düz çıkar.
 *
 * Fotoğraf yolu bunu `mergeSubjectDetail` ile çözer ama İKİNCİ bir model
 * koşusuyla (+133 ms) — canlı tempoyu ikiye böler. Canlıda ikinci koşu
 * GEREKMEZ: global sahne sıralamasına ihtiyaç yoktur, çünkü arka plan zaten
 * RMBG maskesiyle atılıyor. Bu yüzden TEK koşunun GİRDİSİ kırpılır.
 *
 * ── ÖLÇÜM (2026-09-10, test-canli.mp4, 540×720, ön plan %30.6, girdi 154) ──
 * Aynı kare, aynı maske; tek değişen kırpma:
 *
 *   kırpma KAPALI  ızgara 154×210   rölyef 0.2963   |∇| 6.5485   227–250 ms
 *   kırpma AÇIK    ızgara 210×278   rölyef 0.3427   |∇| 7.5882   342–428 ms
 *
 * (rölyef = maske içi p25–p75, fotoğraf yolunun kendi ölçütü; |∇| = maske içi
 * ortalama gradyan büyüklüğü, normalize kadraj birimine çevrilmiş.)
 *
 * Bu kare için kazanç ×1.16, iki ölçütte de aynı — AMA GENELLENEMEZ. 5 kare ×
 * 3 klip üstünde tekrarlandığında rölyef oranı ×0.70 ile ×1.43 arasında
 * saçılıyor ve `test-yakin` karesinde kırpma rölyefin %30'unu KAYBETTİRİYOR
 * (tablo: CHANGELOG 2026-09-10, "Çok kareli doğrulama"). Aşağıdaki tek kare
 * ölçümü örnektir, vaat değildir.
 *
 * MALİYET SIFIR DEĞİL: model
 * koşusu aynı kalıyor ama geri gömme ızgarası büyüdüğü için son-işleme
 * geçişleri pahalılaşıyor — kare başına +%37 (4.0 Hz → 2.9 Hz). Bu, canlı
 * yolun ≥1 Hz kuralının hâlâ çok üstünde.
 *
 * Kazanç sahneye bağlıdır: kutu ne kadar küçükse kazanç o kadar büyük. Özne
 * kadrajı dolduruyorsa kutu hiç üretilmez (`KIRPMA_ATLAMA_ALANI`).
 *
 * KUTU KAREYE ZORLANMAZ. İlk tasarımda kareye zorluyordum (kırpım yakalama
 * tuvaline eziksiz otursun diye); ölçtüm, yanlıştı: kadrajın %28'ini kaplayan
 * ayakta bir insanda kare kutu ×1.29, öznenin kendi en-boyundaki kutu ×3.15
 * örnekleme kazancı veriyor. Eziklik korkusu da yersizdi — DPT işlemcisi
 * `keep_aspect_ratio: true` ile çalışır, kare olmayan girdiyi en-boyu
 * koruyarak işler.
 *
 * HİSTEREZİS neden gerekli: kutu her karede oynarsa modelin gördüğü kadraj her
 * karede değişir, göreli derinlik bandı kayar ve bulut z'de nefes alır.
 * `kararliNormalize`'ın uçları EMA ile taşıması bunu gizlemez — kayan şey
 * uçlar değil, modelin gördüğü İÇERİKtir.
 */
export function canliKirpmaKutusu(
  maske: Float32Array,
  mw: number,
  mh: number,
  onceki: KirpmaKutusu | null,
): KirpmaKutusu | null {
  let x0 = mw;
  let x1 = -1;
  let y0 = mh;
  let y1 = -1;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      if (maske[y * mw + x] < 0.5) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0 || y1 < y0) return null; // maske boş

  const nx = Math.max(0, x0 / mw - KIRPMA_PAY);
  const ny = Math.max(0, y0 / mh - KIRPMA_PAY);
  const nx1 = Math.min(1, (x1 + 1) / mw + KIRPMA_PAY);
  const ny1 = Math.min(1, (y1 + 1) / mh + KIRPMA_PAY);
  const kutu: KirpmaKutusu = { x: nx, y: ny, w: nx1 - nx, h: ny1 - ny };
  const alan = kutu.w * kutu.h;
  // ÜST sınır: özne kadrajı zaten dolduruyor, kırpmanın verecek çözünürlüğü yok.
  if (alan >= KIRPMA_ATLAMA_ALANI) return null;
  // ALT sınır: ölçülmüş gerileme bölgesi — bkz. `KIRPMA_MIN_ALAN`.
  if (alan < KIRPMA_MIN_ALAN) return null;

  if (
    onceki
    && Math.abs(kutu.x - onceki.x) < KIRPMA_HISTEREZIS
    && Math.abs(kutu.y - onceki.y) < KIRPMA_HISTEREZIS
    && Math.abs(kutu.w - onceki.w) < KIRPMA_HISTEREZIS
    && Math.abs(kutu.h - onceki.h) < KIRPMA_HISTEREZIS
  ) {
    return onceki;
  }
  return kutu;
}

/**
 * Kırpılmış ızgarayı TAM KARE ızgarasına geri gömer.
 *
 * Geri gömme ŞART: kırpımı olduğu gibi bırakmak öznenin dünyadaki yerini ve
 * ölçeğini değiştirirdi — `verify-kadraj-degismezligi` sözleşmesi canlı yol
 * için de geçerlidir (nesne ayırma açılıp kapanınca özne zıplamaz).
 *
 * Izgara kırpma oranınca BÜYÜR (`cw / kutu.w`), aksi halde model yakından
 * gördüğü yapıyı üretir ve geri gömme onu hemen aşağı örnekleyip siler —
 * kazanç geri gömmede ölür.
 *
 * BÜYÜTMEYİ KISMAYI DENEDİM, ÖLÇÜM REDDETTİ. Son-işleme maliyetini taban
 * seviyesinde tutmak için ızgarayı kırpmasız boyutta (154×210) bırakmayı
 * denedim. Maske içi p25–p75 rölyefi bunu neredeyse hiç görmedi (0.3427 →
 * 0.3373) — çünkü o ölçüt DEĞER dağılımına bakar, küçültme ise UZAMSAL
 * detayı siler. Gradyan ölçütü farkı gösterdi:
 *
 *   kırpma kapalı      |∇| 6.5485   ← taban
 *   kırpma açık, tam   |∇| 7.5882   ← +%16
 *   kırpma açık, kısık  |∇| 6.3486   ← TABANIN ALTINDA
 *
 * Kısılmış ızgara kazancı silmekle kalmıyor, hiç kırpmamaktan da kötü
 * (kırpma çıktısını iki kez yeniden örnekliyor). Tavan yalnız üst sınır
 * olarak durur (`KIRPMA_IZGARA_TAVANI`), maliyet ayarı olarak DEĞİL.
 *
 * Kutu DIŞI kenar-kelepçe ile doldurulur, sabitle değil: sabit bir dolgu
 * (ör. 0) ızgaranın min/max'ını çiviler ve `kararliNormalize`'ın bandını
 * bozarak öznenin derinlik aralığını sıkıştırırdı.
 */
export function kirpmaIzgarasi(
  kirpim: Float32Array,
  cw: number,
  ch: number,
  kutu: KirpmaKutusu,
): { data: Float32Array; width: number; height: number } {
  const width = Math.min(KIRPMA_IZGARA_TAVANI, Math.max(cw, Math.round(cw / kutu.w)));
  const height = Math.min(KIRPMA_IZGARA_TAVANI, Math.max(ch, Math.round(ch / kutu.h)));
  const out = new Float32Array(width * height);
  for (let Y = 0; Y < height; Y++) {
    // Tam kare → kutu içi normalize → kırpım pikseli (kenara kelepçeli).
    const v = ((Y + 0.5) / height - kutu.y) / kutu.h;
    const sy = Math.min(ch - 1, Math.max(0, v * ch - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(ch - 1, y0 + 1);
    const fy = sy - y0;
    for (let X = 0; X < width; X++) {
      const u = ((X + 0.5) / width - kutu.x) / kutu.w;
      const sx = Math.min(cw - 1, Math.max(0, u * cw - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(cw - 1, x0 + 1);
      const fx = sx - x0;
      const a = kirpim[y0 * cw + x0];
      const b = kirpim[y0 * cw + x1];
      const c = kirpim[y1 * cw + x0];
      const d = kirpim[y1 * cw + x1];
      out[Y * width + X] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return { data: out, width, height };
}

/**
 * ZAMANSAL KARARLI NORMALİZASYON — uçlar kareler arasında EMA ile taşınır.
 *
 * Sorun: her kare KENDİ min/max'ına normalize edilince sahnedeki en ufak
 * değişim (özne yaklaşır, kadraja bir şey girer, model bir karede farklı bir
 * uç üretir) TÜM bulutun z eşlemesini kaydırır — bulut nefes alır. Parlaklık
 * yolunda bunun için `stableRange`/`lumLo`/`lumHi` vardı; model yolu ilk
 * sürümde bunu devralmamıştı.
 *
 * Uçlar EMA ile taşınır (α = 0.15, luminance yolundaki ölçülmüş değerle aynı);
 * kaynak değişiminde `resetLiveDepthState()` ile sıfırlanır.
 */
const LIVE_RANGE_ALPHA = 0.15;
let liveLo: number | null = null;
let liveHi: number | null = null;

/**
 * ÖN PLAN STRETCH ARALIĞI — kareler arası taşınır (2026-08-30).
 *
 * `kararliNormalize` yalnız GLOBAL uçları taşıyordu; `applyForegroundStretch`
 * kendi `lo`/`hi`'sini her karede ÖZNENİN maskeli piksellerinden yeniden
 * hesaplıyor ve `zamansalYumusat`'tan SONRA çalıştığı için temporal filtre onu
 * sönümleyemiyordu. Öznenin kendi min/max'ı oynadığı anda (el öne gelir, kafa
 * döner, maske kayar) tüm özne z'de yeniden ölçekleniyordu — "bulut nefes
 * alıyor" kusurunun ikinci, bağımsız kaynağı. Ölçüm ve α seçimi:
 * `depth.ts` · `STRETCH_RANGE_ALPHA` docstring'i.
 */
let canliStretchAralik = yeniStretchAraligi();

/** Kaynak değişiminde çağrılır — yeni klip eski karenin aralığını miras almasın. */
let liveStateGeneration = 0;

export function resetLiveDepthState() {
  liveStateGeneration++;
  liveLo = null;
  liveHi = null;
  // Kırpma kutusu da bırakılır: seek/döngü sonrası özne başka yerde olabilir
  // ve histerezis eski kutuyu inatla tutup modele yanlış bölgeyi gösterirdi.
  sonKirpmaKutusu = null;
  canliStretchAralik = yeniStretchAraligi();
  canliZamansal.onceki = null;
  canliZamansal.previousLuminance = null;
  canliZamansal.frameKey = undefined;
  canliZamansal.luminanceHistogram = undefined;
  // Havuzlar da bırakılır: yeni kaynağın kare boyutu farklıysa eskisi zaten
  // yeniden ayrılacaktı, aynı ise tutmanın da zararı yok — ama kaynak
  // kapandığında megabaytları asılı bırakmamak daha temiz.
  lumHavuz = null;
}

/**
 * HAM tensörü kararlı aralıkla 0..1'e taşır.
 *
 * Sınırlar ham veriden alınır (`trimmedRange`, %1 kırpma) ve EMA ile taşınır.
 * SIRA KRİTİK: önce `normalizeDepth` çağırıp SONRA EMA uygulamak işe yaramaz —
 * normalize edilmiş kare zaten 0..1'dir, EMA sabit uçları görür ve hiçbir şey
 * yapmaz. İlk sürümde tam bu hata yapıldı; `verify-live-depth [15]` yakaladı.
 */
function kararliNormalize(data: Float32Array): Float32Array {
  const { lo, hi } = trimmedRange(data, 1);
  liveLo = liveLo === null ? lo : liveLo + LIVE_RANGE_ALPHA * (lo - liveLo);
  liveHi = liveHi === null ? hi : liveHi + LIVE_RANGE_ALPHA * (hi - liveHi);
  const span = liveHi - liveLo || 1;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = Math.min(1, Math.max(0, (data[i] - liveLo) / span));
  }
  return out;
}

// ---------------------------------------------------------------------------
// ZAMANSAL (KARELER ARASI) FİLTRE
//
// `kararliNormalize` yalnız UÇLARI kararlı tutar — alanın KENDİSİ her karede
// yeniden çıkarılır ve monoküler derinlik kestirimi karesel olarak gürültülüdür:
// aynı yüzey ardışık karelerde farklı z alır. Ekranda bu "kaynama" olarak
// görünür ve tam olarak öznenin KATI okunmasını engelleyen şeydir; kullanıcının
// istediği "videodaki insan her saniye 3B'ye dönsün" hedefinde yüzeyin durağan
// durması, siluetin sabit kalması kadar önemli.
//
// NAİF EMA OLMAZ: sabit ağırlıklı zamansal ortalama hareket eden özneyi
// SÜRÜKLER (ghosting) — el hareketi arkasında derinlik izi bırakır. Bu yüzden
// filtre HAREKETE DUYARLIDIR: bir piksel az değiştiyse ağır yumuşatılır (o
// değişim gürültüdür), çok değiştiyse yeni değer olduğu gibi alınır (o değişim
// gerçek harekettir). Zamansal iki-taraflı (bilateral) filtrenin derinlik
// alanına uyarlanmış hâli.
// ---------------------------------------------------------------------------

/** Filtre hafızası. Durum AÇIKTAN taşınır ki Node'da tekrarlanabilir test edilsin. */
export interface ZamansalDurum {
  onceki: Float32Array | null;
  previousLuminance?: Float32Array | null;
  frameKey?: string;
  luminanceHistogram?: Uint32Array;
}

export interface TemporalAppearance {
  /** Capture-time luminance, resampled to the same coordinates as depth. */
  luminance: Float32Array | null;
  width: number;
  height: number;
  /** Crop padding is synthesized, so only the observed window may signal motion. */
  sourceWindow?: KirpmaKutusu | null;
  threshold?: number;
}

/**
 * Hiç hareket yokken tutulan yeni-kare ağırlığı. Küçük = daha durağan.
 *
 * ÖLÇÜLDÜ (2026-08-23, tarayıcı, gerçek DAv2-small, 252×336, alt piksel
 * kaydırmalı 8 karelik dizi — gerçek geometri sabit, dolayısıyla çıktıdaki tüm
 * zamansal değişim tanım gereği titreşim). Taban titreşim **0.00720**; bunun
 * 0.00696'sı piksel bazlı, yalnız 0.00258'i küresel — yani kaynak model
 * gürültüsü, normalizasyon değil. Süpürme (kalan titreşim / hızlı kaydırmada
 * bıraktığı iz):
 *
 *   taban  eşik 0.03      eşik 0.06      eşik 0.10      eşik 0.20
 *   0.20   .00507/.00258  .00379/.00599  .00315/.01105  .00267/.01867
 *   0.35   .00547/.00209  .00443/.00493  .00391/.00890  .00350/.01471
 *   0.50   .00587/.00160  .00508/.00384  .00467/.00683  .00434/.01105
 *
 * Seçim (0.20, 0.06): titreşim %47 düşüyor, iz 0.0060'ta kalıyor — taban
 * titreşimin altında. Eşiği 0.10'a çıkarmak 1 birim titreşim için 8 birim iz
 * aldırıyor (0.06 → 0.10: −0.00064 titreşim, +0.00506 iz), yani diz 0.06'da.
 * Tabanı 0.50'ye çıkarmak aynı iz bütçesinde DAHA ÇOK titreşim bırakıyor
 * ((0.50, 0.10) her iki ölçütte de (0.20, 0.06)'ya yeniliyor).
 */
export const ZAMANSAL_TABAN = 0.2;
/** Bu kadar (0..1 derinlik biriminde) değişen piksel HAREKET sayılır, yumuşatılmaz. */
export const ZAMANSAL_HAREKET_ESIGI = 0.06;

/** Luma threshold sweep and noise/trail tradeoff: verify-live-motion.mjs --sweep. */
export const LIVE_LUMA_MOTION_THRESHOLD = 0.04;
// Ignore two 8-bit luma levels, including histogram rounding and codec noise.
const LUMA_NOISE_FLOOR = 2 / 255;

function reliableLumaPair(previous: number, current: number): boolean {
  // Saturation destroys the photometric correspondence (especially when a
  // clipped bright region becomes visible again). Retain depth-only smoothing
  // there instead of interpreting missing appearance information as motion.
  return previous > LUMA_NOISE_FLOOR && previous < 1 - LUMA_NOISE_FLOOR
    && current > LUMA_NOISE_FLOOR && current < 1 - LUMA_NOISE_FLOOR;
}

/**
 * Canlı yolun filtre hafızası. Kaynak değişiminde `resetLiveDepthState()`
 * temizler — yeni klibin ilk karesi eskisiyle harmanlanmamalı.
 */
const canliZamansal: ZamansalDurum = { onceki: null };


export function zamansalDurumAc(): ZamansalDurum {
  return { onceki: null };
}

/**
 * Derinliği YERİNDE zamansal olarak yumuşatır ve durumu günceller.
 *
 * Karışım ağırlığı piksel başına: `a = taban + (1-taban)·min(1, hareket)`.
 * Hareket = max(derinlik farkı / eşikD, yerel luma farkı / eşikL).
 * Luma farkı küresel pozlama değişiminden arındırılır; luma yoksa eski filtre.
 *   |Δ| = 0      → a = taban  (ağır yumuşatma, gürültü bastırılır)
 *   |Δ| ≥ eşik   → a = 1      (yeni değer aynen alınır, iz bırakmaz)
 *
 * İlk kare (veya boyut değişimi) filtrelenmeden geçer — kıyaslanacak geçmiş yok.
 */
export function zamansalYumusat(
  depth: Float32Array,
  durum: ZamansalDurum,
  taban = ZAMANSAL_TABAN,
  hareketEsigi = ZAMANSAL_HAREKET_ESIGI,
  appearance?: TemporalAppearance,
): Float32Array {
  const onceki = durum.onceki;
  const width = appearance?.width ?? depth.length;
  const height = appearance?.height ?? 1;
  const window = appearance?.sourceWindow;
  const frameKey = `${width}x${height}:${window ? [window.x, window.y, window.w, window.h].join(',') : 'full'}`;
  const luminance = appearance?.luminance?.length === depth.length && width * height === depth.length
    ? appearance.luminance : null;
  const previousLuminance = durum.previousLuminance;
  const storeLuminance = () => {
    // The caller reuses capture buffers; history must own its storage.
    if (!luminance) durum.previousLuminance = null;
    else if (previousLuminance?.length === depth.length) previousLuminance.set(luminance);
    else durum.previousLuminance = Float32Array.from(luminance);
    durum.frameKey = frameKey;
  };
  if (!onceki || onceki.length !== depth.length || (durum.frameKey !== undefined && durum.frameKey !== frameKey)) {
    durum.onceki = Float32Array.from(depth);
    storeLuminance();
    return depth;
  }

  const x0 = window ? Math.max(0, Math.ceil(window.x * width - 0.5)) : 0;
  const y0 = window ? Math.max(0, Math.ceil(window.y * height - 0.5)) : 0;
  const x1 = window ? Math.min(width, Math.ceil((window.x + window.w) * width - 0.5)) : width;
  const y1 = window ? Math.min(height, Math.ceil((window.y + window.h) * height - 0.5)) : height;
  const hasAppearance = luminance !== null && previousLuminance?.length === depth.length;
  let exposureShift = 0;
  let exposureGain = 1;
  if (hasAppearance) {
    // A uniform lighting change is not evidence of local motion. Estimate its
    // signed offset robustly; moving foreground must not pull the whole frame.
    const histogram = durum.luminanceHistogram ??= new Uint32Array(511);
    histogram.fill(0);
    let samples = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * width + x;
      if (!reliableLumaPair(previousLuminance![i], luminance![i])) continue;
      const delta = luminance![i] - previousLuminance![i];
      histogram[Math.max(0, Math.min(510, Math.round(delta * 255) + 255))]++;
      samples++;
    }
    if (samples) {
      let cumulative = 0;
      for (let bin = 0; bin < histogram.length; bin++) {
        cumulative += histogram[bin];
        if (cumulative >= samples / 2) { exposureShift = (bin - 255) / 255; break; }
      }
    }
    // Offset alone mistakes exposure GAIN for motion in a textured scene.
    // Two trimmed least-squares refits tolerate minority moving pixels. Accept
    // the fit only if >=80% of observed pairs agree within the SAME noise floor
    // used by the motion cue. Otherwise retain the robust median-offset path.
    // This is photometric compensation, not optical flow: local lighting and
    // motion with indistinguishable appearance remain inherently ambiguous.
    let gain = 1, offset = exposureShift, trim = Infinity, stable = false;
    for (let pass = 0; pass < 3; pass++) {
      let n = 0, sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * width + x, a = previousLuminance![i], b = luminance![i];
        if (!reliableLumaPair(a, b) || Math.abs(b - (gain * a + offset)) > trim) continue;
        n++; sumX += a; sumY += b; sumXX += a * a; sumXY += a * b;
      }
      const variance = n ? sumXX / n - (sumX / n) ** 2 : 0;
      // A near-flat field cannot identify a reliable scale; offset is enough.
      if (n < 3 || variance <= LUMA_NOISE_FLOOR ** 2) { stable = false; break; }
      gain = (sumXY / n - sumX * sumY / (n * n)) / variance;
      offset = (sumY - gain * sumX) / n;
      stable = Number.isFinite(gain + offset) && gain > 0;
      if (!stable) break;
      histogram.fill(0);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * width + x;
        if (!reliableLumaPair(previousLuminance![i], luminance![i])) continue;
        const residual = Math.abs(luminance![i] - (gain * previousLuminance![i] + offset));
        if (Number.isFinite(residual)) histogram[Math.min(510, Math.round(residual * 255))]++;
      }
      let cumulative = 0;
      for (let bin = 0; bin < histogram.length; bin++) {
        cumulative += histogram[bin];
        if (cumulative >= samples / 2) { trim = Math.max(LUMA_NOISE_FLOOR, 2.5 * bin / 255); break; }
      }
    }
    if (stable) {
      let consensus = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * width + x;
        if (reliableLumaPair(previousLuminance![i], luminance![i])
          && Math.abs(luminance![i] - (gain * previousLuminance![i] + offset)) <= LUMA_NOISE_FLOOR) consensus++;
      }
      if (samples > 0 && consensus >= samples * 0.8) { exposureGain = gain; exposureShift = offset; }
    }
  }
  const threshold = appearance?.threshold ?? LIVE_LUMA_MOTION_THRESHOLD;
  const lumaThreshold = Number.isFinite(threshold) && threshold > 0 ? threshold : LIVE_LUMA_MOTION_THRESHOLD;
  const esik = hareketEsigi > 0 ? hareketEsigi : 1e-6;
  for (let i = 0; i < depth.length; i++) {
    const p = onceki[i];
    const fark = Math.abs(depth[i] - p);
    let motion = fark / esik;
    if (hasAppearance) {
      const x = i % width, y = (i - x) / width;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        const delta = luminance![i] - exposureGain * previousLuminance![i];
        if (reliableLumaPair(previousLuminance![i], luminance![i])) {
          const localChange = Math.max(0, Math.abs(delta - exposureShift) - LUMA_NOISE_FLOOR);
          motion = Math.max(motion, localChange / lumaThreshold);
        }
      }
    }
    const a = motion >= 1 ? 1 : taban + (1 - taban) * motion;
    const yeni = p + a * (depth[i] - p);
    depth[i] = yeni;
    onceki[i] = yeni;
  }
  storeLuminance();
  return depth;
}

/**
 * CANLI DERİNLİK SON-İŞLEMESİ — fotoğraf yolunun kalite aşamaları, canlı
 * bütçeye sığan alt kümesi.
 *
 * NEDEN: canlı yol ilk sürümde YALNIZ çıkarım + normalize yapıyordu; fotoğraf
 * yolundaki aşamalar "tempo bütçesini yer" diye atlanmıştı. ÖLÇÜLDÜ
 * (2026-08-23, Node, 252×322 = 81k piksel, medyan):
 *
 *   applyForegroundStretch  0.42 ms
 *   smoothDepthSteps        5.28 ms
 *   limitDepthSlope ×2      7.84 ms
 *   ──────────────────────────────
 *   toplam                 13.54 ms  → 133 ms'lik çıkarımın yalnız %10'u
 *
 * Karşılığında (aynı ölçüm, sıkıştırılmış özneli sentetik sahne): öznenin
 * kütle yayılımı (p10-p90) 0.038 → 0.844, yani **×22**. "Video düz görünüyor"
 * şikayetinin asıl kaynağı buydu — model özneyi dar bir banda sıkıştırıyor ve
 * `applyForegroundStretch` o bandı açıyor (fotoğraf yolunda ölçülen kazanç
 * ×7.26, CHANGELOG Gün E bulgu 8).
 *
 * SIRA fotoğraf yolundakiyle aynı: yumuşat → detay (λ) → genişlet → sobel (β)
 * → eğim sınırla. Sınırlayıcı EN SON çalışır çünkü önceki aşamalar da yerel
 * sıçrama ekler; sobel stretch'ten SONRA çünkü stretch'in yeniden dağıtımı
 * rölyefi ezerdi.
 *
 * ATLANAN: `mergeSubjectDetail` (özne kırpma çıkarımı) — İKİNCİ bir model
 * koşusu, +133 ms; canlı tempoyu ikiye böler.
 *
 * Maske YOKSA yalnız yumuşatma + maskesiz eğim sınırlaması uygulanır (stretch
 * maskesiz anlamsızdır: aralık sahnenin tamamına açılır ve özne yine sıkışır —
 * Gün E bulgu 1'de ölçülmüştü).
 */
export function postProcessLiveDepth(
  depth: Float32Array,
  width: number,
  height: number,
  mask: Float32Array | null,
  lum: Float32Array | null = null,
): Float32Array {
  smoothDepthSteps(depth, width, height);
  // RGB GÜDÜMLÜ MİKRO RÖLYEF (λ) — model yüz detayını (göz çukuru, burun, dudak
  // çizgisi) yumuşatır; kaynağın luminance yüksek frekansı onu geri getirir.
  // Fotoğraf yolundaki `applyDetail` ile AYNI fonksiyon; canlı yolda ilk
  // sürümde atlanmıştı çünkü derinlikle hizalı luminance yoktu. Artık kare
  // RGB'si zaten renk grid'i için çıkarılıyor, luminance ondan türetilip
  // derinlik ızgarasına örnekleniyor (bkz. estimateDepthLive).
  const detayVar = lum !== null && lum.length === depth.length;
  if (detayVar) applyDetail(depth, lum!, width, height, DETAIL_STRENGTH_DEFAULT);
  if (!mask || mask.length !== depth.length) {
    return limitDepthSlope(depth, width, height, null);
  }
  // Aralık KARELER ARASI taşınır (`canliStretchAralik`) — foto yolu bu
  // argümanı geçirmez ve orada davranış birebir eskisidir.
  applyForegroundStretch(depth, mask, width, height, undefined, canliStretchAralik);
  // Sobel mikro kabartma stretch'ten SONRA: önce uygulansaydı stretch'in
  // yeniden dağıtımı rölyefi ezerdi (fotoğraf yolundaki sıranın aynısı).
  if (detayVar) applySobelRelief(depth, lum!, mask, width, height, SOBEL_RELIEF_DEFAULT);
  // İKİ BÖLGELİ sınırlama (fotoğraf yoluyla aynı gerekçe): tek maskesiz geçişte
  // özne↔arka plan sıçraması "aşırı eğim" sayılır ve siluetin dış halkası arka
  // plan seviyesine çekilir — kenar 3B'de arkaya çöker.
  const icerisi = limitDepthSlope(depth, width, height, mask);
  const disarisi = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) disarisi[i] = mask[i] >= 0.5 ? 0 : 1;
  return limitDepthSlope(icerisi, width, height, disarisi);
}

// ---------------------------------------------------------------------------
// MASKE BAYATLIĞI. Özne maskesi klip başına BİR KEZ üretiliyor (RMBG canlı yük
// altında ~2.5 sn — App.tsx · MASKE_MIN_ARALIK_MS ölçümü);
// özne kadrajda kayarsa siluet yanlış yerde kalır. Zamanlayıcıyla tazelemek
// kötü çözüm: her tazeleme ~2.5 sn GPU yer ve derinliği aç bırakır. Bunun yerine
// GEREKTİĞİNDE tazelenir — maskenin gösterdiği yer ile derinliğin gösterdiği
// yakın kütle ayrışınca.
// ---------------------------------------------------------------------------

/** Kadraj oranı cinsinden ağırlık merkezi (0..1). Eşiği geçen piksel yoksa null. */
export interface KutleMerkezi {
  x: number;
  y: number;
  /** Eşiği geçen piksel oranı — dejenere ölçümü ayıklamak için. */
  oran: number;
}

/**
 * `pct` yüzdelik ÜST eşiği (256 kovalı histogram, sıralama yok — `trimmedRange`
 * ile aynı teknik). Sabit eşik yerine yüzdelik kullanılır çünkü son-işleme
 * sonrası derinliğin mutlak seviyesi sahneye göre oynar; "en yakın %25" her
 * sahnede aynı şeyi ifade eder.
 */
export function ustPercentilEsigi(depth: Float32Array, pct: number): number {
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < depth.length; i++) {
    const v = depth[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const span = mx - mn || 1;
  const bins = new Int32Array(256);
  for (let i = 0; i < depth.length; i++) {
    bins[Math.min(255, Math.max(0, Math.floor(((depth[i] - mn) / span) * 256)))]++;
  }
  const hedef = (depth.length * pct) / 100;
  let acc = 0;
  for (let b = 255; b >= 0; b--) {
    acc += bins[b];
    if (acc >= hedef) return mn + (b / 256) * span;
  }
  return mn;
}

/** Eşiği geçen piksellerin ağırlık merkezi, kadraj oranı olarak. */
export function kutleMerkezi(
  alan: Float32Array,
  width: number,
  height: number,
  esik: number,
): KutleMerkezi | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    const satir = y * width;
    for (let x = 0; x < width; x++) {
      if (alan[satir + x] >= esik) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  if (n === 0) return null;
  return { x: sx / n / width, y: sy / n / height, oran: n / alan.length };
}

/**
 * Maske bayat mı?
 *
 * İki ağırlık merkezi arasındaki kadraj-oranlı mesafe eşiği aşarsa maske artık
 * özneyi göstermiyor demektir. Eşik `MASK_DRIFT_LIMIT` = 0.12: kadrajın kısa
 * kenarının ~%12'si. Daha küçük seçilirse normal kıpırdanma sürekli tazeleme
 * tetikler (her tazeleme ~2.5 sn GPU); daha büyük seçilirse özne maskeden çıkar.
 *
 * Dejenere ölçüm ayıklanır: eşiği geçen piksel oranı çok küçükse (%2 altı)
 * merkez gürültüdür ve karar verilmez — bayat DEĞİL sayılır (yanlış tazeleme
 * yapmaktansa eski maskeyle devam etmek ucuzdur).
 */
export const MASK_DRIFT_LIMIT = 0.12;

/**
 * MASKEYİ KAYDIR — yeniden üretmek yerine ÖTELE.
 *
 * NEDEN: maskeyi yenilemek RMBG koşusu demek ve o koşu UCUZLATILAMIYOR — modelin
 * ONNX girdisi 1024×1024'e SABİT (ölçüldü: 768/512/384 denendi, üçü de
 * "Got invalid dimensions for input" ile reddetti). Maliyet tarayıcıda boşta
 * ~1.35 sn, canlı döngü koşarken (aynı `gpuSirasinaGir` kuyruğunda çekişme)
 * ~2.5 sn. Yani her tazeleme geometriyi 2.5 sn dondurur.
 *
 * Ama sürüklenmenin BASKIN hâli öznenin kadrajda ÖTELENMESİDİR (yürüme, kamera
 * kaydırması) — bunda siluetin ŞEKLİ değişmez, yalnız YERİ değişir. Sürüklenme
 * ölçümü zaten iki ağırlık merkezi arasındaki farkı veriyor; maskeyi o kadar
 * kaydırmak şekli korur ve ~1 ms sürer.
 *
 * SINIRI: dönme, ölçek ve poz değişimini DÜZELTMEZ. Bu yüzden kaydırma birikimi
 * çağıran tarafta sınırlanır (`MASKE_MAX_KAYMA`) ve taban aralık dolunca gerçek
 * tazeleme yine koşar. Kaydırma, tazelemenin YERİNE değil ARASINA girer.
 *
 * Kadrajdan çıkan kenar ARKA PLANLA (0) doldurulur: bilinmeyen bölgeyi ön plan
 * saymak siluetı kadraj kenarına yapıştırırdı.
 */
export function maskeKaydir(
  mask: Float32Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
): Float32Array {
  if (mask.length !== width * height) {
    throw new RangeError(`maskeKaydir: ${mask.length} değer ${width}x${height} ile uyuşmuyor`);
  }
  const sx = Math.round(dx);
  const sy = Math.round(dy);
  if (sx === 0 && sy === 0) return mask;
  const out = new Float32Array(mask.length);
  // Hedef (x, y) kaynağın (x − sx, y − sy) pikselini alır.
  const y0 = Math.max(0, sy);
  const y1 = Math.min(height, height + sy);
  const x0 = Math.max(0, sx);
  const x1 = Math.min(width, width + sx);
  for (let y = y0; y < y1; y++) {
    const kaynakSatir = (y - sy) * width;
    const hedefSatir = y * width;
    for (let x = x0; x < x1; x++) out[hedefSatir + x] = mask[kaynakSatir + (x - sx)];
  }
  return out;
}
const MIN_KUTLE_ORANI = 0.02;

/**
 * MASKE KAÇIRMA ORANI — yakın kütlenin ne kadarı maskenin DIŞINDA?
 *
 * ── NEDEN YENİ BİR ÖLÇÜT (2026-08-30) ─────────────────────────────────────
 * Tazeleme kararı `maskeBayatMi` ile veriliyordu: derinliğin "en yakın %25"
 * ağırlık merkezinin, son maske olayından beri ne kadar KAYDIĞI. O büyüklük
 * maskenin hizasını ÖLÇMEZ — özne kolunu kaldırdığında da, kameraya
 * yaklaştığında da zıplar. Gerçek klip logunda sonucu görüldü: RMBG her
 * 8 saniyede bir yeniden koşuyor (koşu başına 1100–2165 ms) ve canlı tempo
 * temiz aralıktaki 6–7.8 Hz'den 1.6–3.3 Hz'e düşüyordu.
 *
 * Aynı logdaki KESİN kanıt: her yeniden üretimde maske BİREBİR aynı çıkıyordu
 * — `1024x576, ön plan %57` on beş kez üst üste. Maske bayat değildi; ölçüt
 * yanlış şeyi ölçüyordu.
 *
 * Bu ölçüt doğrudan sorulan soruyu sorar: maske hâlâ özneyi örtüyor mu?
 * Eşiği geçen (yakın) piksellerin kaçta kaçı maskenin dışında kalıyor.
 * Maske hizalıyken yakın kütle öznenin ön yüzeyidir ve maskenin İÇİNDEDİR;
 * maske kaydıkça dışarı taşar. Uzuv hareketi maskenin içinde kaldığı sürece
 * bu oranı DEĞİŞTİRMEZ — istenen tam da budur.
 *
 * Maske ve derinlik farklı çözünürlüktedir (ör. 1024×576 vs 280×154); maske
 * normalize koordinattan en yakın komşuyla örneklenir.
 *
 * `null` = yakın kütle karar verilemeyecek kadar küçük (`MIN_KUTLE_ORANI`).
 */
export function maskeKacirmaOrani(
  depth: Float32Array,
  dw: number,
  dh: number,
  mask: Float32Array,
  mw: number,
  mh: number,
  esik: number,
): number | null {
  let yakin = 0;
  let disarida = 0;
  for (let y = 0; y < dh; y++) {
    const satir = y * dw;
    // Normalize satır → maske satırı (en yakın komşu).
    const my = Math.min(mh - 1, Math.max(0, Math.round(((y + 0.5) / dh) * mh - 0.5)));
    const mSatir = my * mw;
    for (let x = 0; x < dw; x++) {
      if (depth[satir + x] < esik) continue;
      yakin++;
      const mx = Math.min(mw - 1, Math.max(0, Math.round(((x + 0.5) / dw) * mw - 0.5)));
      if (mask[mSatir + mx] < 0.5) disarida++;
    }
  }
  if (yakin / (dw * dh) < MIN_KUTLE_ORANI) return null;
  return disarida / yakin;
}

/**
 * Kaçırma oranı bu değeri aşarsa maske gerçekten özneyi bırakmıştır.
 *
 * SEÇİM İLKESİ (sayıdan önce): ÖTELEME zaten `maskeKaydir` ile ~1 ms'de
 * düzeltiliyor. Pahalı olan RMBG tazelemesi (gerçek klipte 1100–2165 ms,
 * canlı tempoyu 6–7.8 Hz'den 1.6–3.3 Hz'e düşürüyor) yalnız kaydırmanın
 * DÜZELTEMEDİĞİ hâller için ayrılmalı: dönme, ölçek, poz değişimi. Ölçüt
 * bu yüzden "maske yakın kütlenin ÇOĞUNLUĞUNU artık örtmüyor" çizgisine
 * konur — yarısı.
 *
 * ÖLÇÜLDÜ (`verify-maske-kacirma`, gradyanlı özne, maske yakın kütleyi
 * açıkta bırakacak yönde kaydırılıyor): hizalı 0.000 · %10 kayma 0.323 ·
 * %20 kayma 0.613 · %30 kayma 0.935. Eşik 0.5, %10'u kaydırma koluna
 * bırakır, %20 ve üstünü tazelemeye gönderir.
 */
export const MASK_MISS_LIMIT = 0.5;

/**
 * Kacirma oraninin TABANIN uzerinde kabul edilebilir artisi.
 *
 * ── NEDEN TABAN-GORELI (2026-09-09, gercek klipte olculdu) ────────────────
 * Mutlak esik (`MASK_MISS_LIMIT`) sentetik sahnede dogruydu ama gercek klipte
 * TUTMADI: TAZE uretilmis maskede bile oran %55-60 cikiyor ve esigi surekli
 * asiyordu — 32 saniyede 6 RMBG kosusu, her biri ~1.2 sn.
 *
 * Sebep olcutun ortuk varsayimi: "ozne en yakin seydir". Kalibrasyon
 * sahnesinde ozne kadrajin %40'iydi ve arka plan uzakti; olculen klipte ozne
 * %29 ve "en yakin %25" bol bol arka plan iceriyor. Mutlak sayi bu yuzden
 * klipten klibe kayar ve tek bir esik her sahneye uymaz.
 *
 * Karar artik KLIBE GORE kalibre edilir: taze maske o klip icin bir TABAN
 * belirler (kurulumdan sonraki ilk olcum), tazeleme yalniz oran o tabanin
 * BELIRGIN uzerine ciktiginda tetiklenir. Boylece olcut "maske ne kadar kotu"
 * yerine "maske kurulduguna gore ne kadar KOTULESTI" sorusunu sorar — asil
 * sorulmak istenen buydu.
 *
 * 0.2 = yakin kutlenin bestebiri kadar ek kacak. Kaydirma kolu (~1 ms) daha
 * kucuk sapmalari zaten kapatir; pahali RMBG bunun uzerine ayrilir.
 */
export const MASK_MISS_RISE = 0.2;

/**
 * Maske YENIDEN URETILMELI mi?
 *
 * `taban` yoksa (klibin ilk olcumu) mutlak esige duser — geriye donuk davranis.
 * `oran` olculemediyse (yakin kutle yok) karar VERILMEZ.
 */
export function maskeYenilenmeliMi(oran: number | null, taban: number | null): boolean {
  if (oran === null) return false;
  if (taban === null) return oran > MASK_MISS_LIMIT;
  return oran > taban + MASK_MISS_RISE;
}

export function maskeBayatMi(
  simdiki: KutleMerkezi | null,
  maskeninki: KutleMerkezi | null,
  limit = MASK_DRIFT_LIMIT,
): boolean {
  if (!simdiki || !maskeninki) return false;
  if (simdiki.oran < MIN_KUTLE_ORANI || maskeninki.oran < MIN_KUTLE_ORANI) return false;
  const dx = simdiki.x - maskeninki.x;
  const dy = simdiki.y - maskeninki.y;
  return Math.hypot(dx, dy) > limit;
}

/**
 * Model tensöründen `DepthResult`.
 *
 * EKSEN SIRASI: `predicted_depth.dims` `[1, H, W]` düzenindedir — 4:3 kaynakta
 * 252 girdi `252×336` verir, yani **height = 252, width = 336**. Ters okumak
 * sahneyi devirir ve bu hata DERLEMEDEN GEÇER; ekranda yalnız "garip" görünür.
 * Bu yüzden sözleşme testle kapıya bağlı (verify-live-depth [6]).
 *
 * Normalizasyon `depth.ts`'in `normalizeDepth`'idir (%1 histogram kırpması):
 * ikinci bir uygulama yazılmaz, fotoğraf ve video yolu aynı hesabı kullanır.
 */
export function depthResultFromTensor(
  dims: number[],
  data: Float32Array,
  mask: Float32Array | null = null,
  lum: Float32Array | null = null,
  sourceWindow: KirpmaKutusu | null = null,
): DepthResult {
  const height = dims[dims.length - 2];
  const width = dims[dims.length - 1];
  if (!(width > 0) || !(height > 0) || data.length !== width * height) {
    throw new RangeError(
      `liveDepth: tensör boyutu tutmuyor — dims [${dims.join(', ')}], veri ${data.length}`,
    );
  }
  // %1 histogram kırpması + kareler arası KARARLI aralık TEK adımda (ham veri
  // üzerinde — bkz. kararliNormalize), sonra kalite aşamaları.
  const kararli = kararliNormalize(data);
  // ZAMANSAL FİLTRE ZİNCİRİN BAŞINDA — ölçümle seçilen yer. Titreşimin
  // %87'si (varyans payı) piksel bazlı, yani model çıktısının KENDİSİNDEN
  // geliyor; kaynağında bastırılırsa sonraki aşamalar temiz alan üzerinde
  // çalışır. Sona konsaydı `limitDepthSlope`'un eğim garantisi filtrenin
  // piksel başına değişen ağırlığıyla delinirdi (son aşama artık kısıt
  // uygulayan aşama olmazdı).
  zamansalYumusat(kararli, canliZamansal, undefined, undefined, {
    luminance: lum, width, height, sourceWindow,
  });
  return { data: postProcessLiveDepth(kararli, width, height, mask, lum), width, height };
}

/** Sürücünün ihtiyaç duyduğu her şey — çıkarım ENJEKTE edilir (model olmadan
 *  test edilebilsin diye: scripts/verify-live-depth.mjs). */
export interface LiveDepthDriverOptions {
  /** Bir tur: kare yakala + çıkarım. `null` → kaynak hazır değil, tur atlanır. */
  infer: () => Promise<DepthResult | null>;
  /** Başarılı turun sonucu (üretimde `Engine.setDepth`). */
  onDepth: (d: DepthResult) => void;
  /** Hata bildirimi; `ardisik` = üst üste kaçıncı hata. */
  onError?: (err: unknown, ardisik: number) => void;
  /** Kaç ARDIŞIK hatadan sonra döngü teslim olur. Varsayılan 3. */
  maxErrors?: number;
  /** `infer` null döndüğünde beklenecek süre (ms) — sıcak döngü olmasın. */
  bosBeklemeMs?: number;
}

const gecikme = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * `grab → infer → onDepth → tekrar` döngüsü.
 *
 * ── NEDEN `while` + `await`, `setInterval` DEĞİL ─────────────────────────────
 * Çıkarım süresi sahneye ve cihaza göre 60-300 ms arasında oynar. Sabit
 * aralıklı zamanlayıcı, çıkarım aralıktan uzun sürdüğünde çağrıları ÜST ÜSTE
 * bindirir; iki çıkarım aynı GPU'yu bölüşür ve ikisi birden yavaşlar (kaçak
 * geri besleme — aynı desen keyframe seçicisinde bir kez yaşandı, bkz.
 * seekCapture.ts TRACK_RATIO_MIN gerekçesi). `await` zinciri tanım gereği tek
 * uçuş tutar ve cihazın verebildiği tempoya kendiliğinden oturur.
 *
 * ── NEDEN HER TURDA MAKRO GÖREV ─────────────────────────────────────────────
 * Yalnız mikro görev bırakmak (`await Promise.resolve()`) rAF'ı aç bırakabilir:
 * mikro görev kuyruğu boşalmadan tarayıcı kare çizmez. `setTimeout(0)` bir
 * makro görev sınırı koyar — render döngüsü ve olay işleyicileri araya girer.
 * Maliyeti ~4 ms; 66-106 ms'lik tur süresinin yanında önemsiz.
 *
 * Dönen fonksiyon döngüyü durdurur. UÇUŞTAKİ sonuç da YAZILMAZ: kaynak
 * değiştiğinde (yeni video, kamera kapandı) eski karenin derinliği yeni sahneye
 * basılırsa görüntü karışır.
 */
export function startLiveDepthDriver(opts: LiveDepthDriverOptions): () => void {
  const maxErrors = opts.maxErrors ?? 3;
  const bosBeklemeMs = opts.bosBeklemeMs ?? 50;
  let aktif = true;
  let ardisikHata = 0;

  void (async () => {
    while (aktif) {
      let sonuc: DepthResult | null = null;
      try {
        sonuc = await opts.infer();
        ardisikHata = 0;
      } catch (err) {
        if (!aktif) break;
        ardisikHata++;
        opts.onError?.(err, ardisikHata);
        if (ardisikHata >= maxErrors) {
          aktif = false;
          break;
        }
        await gecikme(bosBeklemeMs);
        continue;
      }
      // Durdurma kontrolü çıkarımdan SONRA tekrar: uçuşta durdurulduysa sonuç
      // yazılmaz (yukarıdaki gerekçe).
      if (!aktif) break;
      if (!sonuc) {
        await gecikme(bosBeklemeMs);
        continue;
      }
      opts.onDepth(sonuc);
      await gecikme(0);
    }
  })();

  return () => {
    aktif = false;
  };
}

// ---------------------------------------------------------------------------
// GERÇEK ÇIKARIM. Buradan aşağısı TARAYICI yoludur (WebGPU + model); Node
// tarafı (verify-live-depth.mjs) yalnız yukarıdaki saf parçaları kullanır ve
// bu bölümü hiç çalıştırmaz — modül import'u model yükü getirmez.
// ---------------------------------------------------------------------------

/**
 * Canlı model yolu açılabilir mi?
 *
 * WebGPU YOKSA KAPALIDIR: wasm'da ölçülen ~2 s/kare (small, q8, 252 girdi)
 * canlı video için kullanılamaz — çağıran parlaklık vekiline düşer. Bu bir
 * kalite tercihi değil, tempo eşiğidir.
 */
export async function liveDepthKullanilabilir(): Promise<boolean> {
  return await localInferenceAvailable() || webgpuKullanilabilir();
}

interface LiveModel {
  /** RawImage → normalize edilmiş tensör. */
  proc: (i: unknown) => Promise<{ pixel_values: unknown }>;
  /** Model çalıştırması (WebGPU). */
  net: (i: Record<string, unknown>) => Promise<{ predicted_depth: { data: unknown; dims: number[] } }>;
  /** `RawImage.fromCanvas` SENKRONDUR (Promise değil) — await'lemeye gerek yok. */
  fromCanvas: (c: HTMLCanvasElement) => unknown;
  /** Processor'ın hedef kenarını değiştirir (girdi boyu çalışma anında değişebilir). */
  setGirdi: (n: number) => void;
  /** Şu anki hedef kenar — gereksiz yazımı atlamak için. */
  girdi: number;
}

/**
 * `pipeline()` KULLANILMAZ. Ölçüldü (2026-08-22, Intel UHD iGPU, small/fp16/
 * WebGPU): pipeline girdi boyundan BAĞIMSIZ ~300 ms alıyordu, çünkü ham çıktıyı
 * kaynak görüntü boyutuna JS'te geri interpole ediyor. O adım bize gerekmiyor —
 * `Engine.setDepth` kendi boyutunu kabul eder. Atlanınca aynı model 154'te
 * 64 ms, 252'de 106 ms.
 *
 * `onceRetry`: eşzamanlı çağrılar tek yüklemeye birleşir, RED durumunda cache
 * DÜŞER (tek seferlik hata oturumu kalıcı bozmaz) — depth.ts'teki düzeltilmiş
 * desenin aynısı.
 */
const yukleLiveModel = onceRetry<LiveModel>(async () => {
  const tf = await loadTransformers();
  const proc = (await tf.AutoImageProcessor.from_pretrained(
    'onnx-community/depth-anything-v2-small',
  )) as unknown as { size?: unknown } & LiveModel['proc'];
  // Kurulum da GPU sırasından geçer: başka bir modelin çıkarımı uçuştayken
  // oturum açmak WebGPU bağlamını bozuyor (bkz. gpuSirasinaGir).
  const loadBrowserNet = onceRetry(async () => (await gpuSirasinaGir(() =>
    tf.AutoModel.from_pretrained('onnx-community/depth-anything-v2-small', {
      device: 'webgpu',
      dtype: 'fp16',
    }),
  )) as unknown as LiveModel['net']);
  const useSidecar = await localInferenceAvailable();
  const browserNet = useSidecar ? null : await loadBrowserNet();
  const net: LiveModel['net'] = useSidecar ? async (inputs) => ({
    predicted_depth: await localInference!.infer('small', inputs.pixel_values as RawTensor, async () => {
      const fallback = await loadBrowserNet();
      return (await gpuSirasinaGir(() => fallback(inputs))).predicted_depth as RawTensor;
    }),
  }) : inputs => gpuSirasinaGir(() => browserNet!(inputs));
  const model: LiveModel = {
    proc: proc as LiveModel['proc'],
    net,
    fromCanvas: (c: HTMLCanvasElement) => tf.RawImage.fromCanvas(c) as unknown,
    // Hedef kenar: DPTImageProcessor en-boyu koruyup 14'ün katına yuvarlar
    // (`ensure_multiple_of: 14` — ViT patch boyu), yani çıktı kare DEĞİLDİR.
    setGirdi(n: number) {
      proc.size = { height: n, width: n };
      model.girdi = n;
    },
    girdi: 0,
  };
  model.setGirdi(LIVE_INPUT_SIZE);
  return model;
});

/** Kare yakalama tuvali — kare başına yeni canvas/context açmak GC üretir. */
let grabCanvas: HTMLCanvasElement | null = null;
let grabCtx: CanvasRenderingContext2D | null = null;
/**
 * Luminance tamponu HAVUZLANIR: 384×491'lik yakalamada 188k float (~0.75 MB),
 * saniyede ~7 kare — havuzsuz hâli sürekli çöp üretir. `depth.ts`'in luminance
 * yolundaki `scratchData` deseninin aynısı.
 */
/** Son kabul edilen kırpma kutusu — histerezis buna bakar. */
let sonKirpmaKutusu: KirpmaKutusu | null = null;
let lumHavuz: Float32Array | null = null;
const havuz = (buf: Float32Array | null, n: number) =>
  buf && buf.length === n ? buf : new Float32Array(n);

/**
 * Tek karelik canlı derinlik.
 *
 * Fotoğraf yolundaki `estimateDepth`'in aksine özne kırpma çıkarımı, ön plan
 * stretch'i, sobel rölyefi ve eğim sınırlayıcı YOKTUR — hepsi tek kare kalitesi
 * için ve canlı yolun tempo bütçesini yerdi. Burada yalnız çıkarım + normalize.
 */
export interface LiveDepthOptions {
  /** Discard obsolete work before it can mutate temporal normalization. */
  isCurrent?: () => boolean;
  /** Model girdi kenarı (varsayılan `LIVE_INPUT_SIZE`). */
  girdi?: number;
  /**
   * Özne maskesi (RMBG çıktısı, kendi çözünürlüğünde). Verilirse son-işleme
   * maske-duyarlı koşar: stretch + iki bölgeli eğim sınırlaması. Maske depth
   * boyutuna burada yeniden örneklenir.
   */
  subjectMask?: { data: Float32Array; width: number; height: number } | null;
  /** RGB güdümlü mikro rölyef (detay + sobel). Varsayılan AÇIK. */
  detay?: boolean;
}

export interface LiveDepthResult extends DepthResult {
  /** End-to-end frame processing time, excluding initial model loading. */
  inferenceMs: number;
  mediaTime: number;
}

export async function estimateDepthLive(
  source: HTMLVideoElement | HTMLCanvasElement,
  opts: LiveDepthOptions = {},
): Promise<LiveDepthResult> {
  const girdi = opts.girdi ?? LIVE_INPUT_SIZE;
  const generation = liveStateGeneration;
  const current = () => generation === liveStateGeneration && (opts.isCurrent?.() ?? true);
  const model = await yukleLiveModel();
  if (!current()) throw new Error('Obsolete live frame');
  const started = performance.now();
  const mediaTime = source instanceof HTMLVideoElement ? source.currentTime : 0;
  if (model.girdi !== girdi) model.setGirdi(girdi);

  const vw = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const vh = source instanceof HTMLVideoElement ? source.videoHeight : source.height;

  // ÖZNE KIRPMA — modelin özneyi yakından görmesi için (bkz. canliKirpmaKutusu).
  // Maske yoksa kutu da yoktur: kırpacak bilgi yok, tam kare çizilir.
  const sm = opts.subjectMask;
  const kutu = sm ? canliKirpmaKutusu(sm.data, sm.width, sm.height, sonKirpmaKutusu) : null;
  sonKirpmaKutusu = kutu;
  const kx = kutu ? kutu.x * vw : 0;
  const ky = kutu ? kutu.y * vh : 0;
  const kw = kutu ? Math.max(1, kutu.w * vw) : vw;
  const kh = kutu ? Math.max(1, kutu.h * vh) : vh;

  // Yakalama tuvali KUTUNUN en-boyunu alır; işlemci `keep_aspect_ratio` ile
  // çalıştığı için kare olmayan girdi ezilmeden işlenir.
  const { w, h } = liveGrabSize(kw, kh);
  if (!grabCanvas) {
    grabCanvas = document.createElement('canvas');
    grabCtx = grabCanvas.getContext('2d', { willReadFrequently: true });
  }
  const canvas = grabCanvas;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  grabCtx!.drawImage(source, kx, ky, kw, kh, 0, 0, w, h);

  // Mikro rölyef luminance'ı — kare zaten çizili, yalnız okuma + dönüşüm.
  let kareLum: Float32Array | null = null;
  if (opts.detay !== false) {
    const px = grabCtx!.getImageData(0, 0, w, h).data;
    // Rec.601 — videoPipe/seekCapture ile aynı katsayılar.
    kareLum = lumHavuz = havuz(lumHavuz, w * h);
    for (let i = 0, k = 0; i < px.length; i += 4, k++) {
      kareLum[k] = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
    }
  }

  const image = model.fromCanvas(canvas);
  const inputs = await model.proc(image);
  // TEK KUYRUK: maske (RMBG) aynı anda koşarsa ORT'nin WebGPU tamponu
  // geçersizleşiyor ve çıkarım patlıyor (gpuSirasinaGir docstring'i —
  // gerçek klipte ölçüldü, canlı kol teslim olup vekile dönüyordu).
  // The model adapter owns browser serialization; a sidecar request must not
  // hold the browser GPU queue while a separate mask request is in flight.
  const out = await model.net({ pixel_values: inputs.pixel_values });
  if (!current()) throw new Error('Obsolete live frame');
  const dims = out.predicted_depth.dims;
  const dh = dims[dims.length - 2];
  const dw = dims[dims.length - 1];
  // Luminance önce derinlik ızgarasına örneklenir — geri gömme İKİSİNİ de aynı
  // kırpım ızgarasından alsın diye (aksi halde farklı tam-kare boyutları çıkar).
  const kirpimLum =
    kareLum && (w !== dw || h !== dh) ? resampleBilinear(kareLum, w, h, dw, dh) : kareLum;

  // TAM KAREYE GERİ GÖMME — kırpım öznenin dünyadaki yerini değiştirmemeli
  // (`verify-kadraj-degismezligi` canlı yol için de geçerli).
  const gomulu = kutu
    ? kirpmaIzgarasi(out.predicted_depth.data as Float32Array, dw, dh, kutu)
    : { data: out.predicted_depth.data as Float32Array, width: dw, height: dh };
  const gw = gomulu.width;
  const gh = gomulu.height;
  const lum = kutu && kirpimLum ? kirpmaIzgarasi(kirpimLum, dw, dh, kutu).data : kirpimLum;

  // Maske RMBG çözünürlüğünde gelir (ör. 791×1024); son-işleme onu derinlikle
  // BİREBİR aynı ızgarada ister — aksi halde stretch/sınırlama yanlış piksellere
  // uygulanır ve siluet kenarı kayar. Kırpma sonrası hedef, geri gömülen TAM
  // KARE ızgarasıdır; maske zaten tam kare olduğu için kırpılmaz, ölçeklenir.
  const maske = sm
    ? sm.width === gw && sm.height === gh
      ? sm.data
      : resampleBilinear(sm.data, sm.width, sm.height, gw, gh)
    : null;
  return {
    ...depthResultFromTensor([gh, gw], gomulu.data, maske, lum, kutu),
    inferenceMs: performance.now() - started,
    mediaTime,
  };
}

/**
 * Video için canlı derinlik döngüsü — `startLiveDepthDriver`'ın üretim
 * sarmalayıcısı.
 *
 * Kare hazır değilken (`readyState < 2`) tur ATLANIR: `drawImage` çözülmemiş
 * videodan boş/bozuk kare çizer ve model onu ciddiye alır.
 *
 * `onVazgec` ardışık hata tavanına gelindiğinde çağrılır — çağıran parlaklık
 * koluna döner. Sessiz siyah ekran yok.
 */
export function startLiveDepth(
  video: HTMLVideoElement,
  onDepth: (d: LiveDepthResult) => void,
  opts: {
    girdi?: number;
    girdiAl?: () => number;
    /**
     * Güncel özne maskesini döndürür. GETİRİCİ olarak alınır çünkü maske
     * döngü başladıktan SONRA (ilk derinlikten sonra) geliyor — sabit bir
     * değer geçirmek onu hiç göremezdi.
     */
    maskeAl?: () => { data: Float32Array; width: number; height: number } | null;
    onError?: (err: unknown, ardisik: number) => void;
    onVazgec?: () => void;
    onDiscontinuity?: (reason: 'seek' | 'loop') => void;
  } = {},
): () => void {
  const maxErrors = 3;
  resetLiveDepthState();
  let active = true;
  let revision = 0;
  let frameTime = video.currentTime;
  let processedTime = Number.NaN;
  let processedSize = opts.girdiAl?.() ?? opts.girdi ?? LIVE_INPUT_SIZE;
  let processedMask = opts.maskeAl?.() ?? null;
  let frameCallback: number | null = null;
  const invalidate = (reason: 'seek' | 'loop') => {
    revision++;
    processedTime = Number.NaN;
    resetLiveDepthState();
    opts.onDiscontinuity?.(reason);
  };
  /**
   * BIR SARMAYI IKI SINYAL BIRDEN GOREBILIR ve siralari GARANTI DEGILDIR:
   * kare geri cagrisi `mediaTime = 0` sunar, element de `seeking` yayar.
   *
   * Kare geri cagrisi once gorurse izlenen kare zamani (`frameTime`) ~0'a
   * iner; ardindan gelen `seeking` o dusuk degeri gorup AYNI sarmayi
   * KULLANICI SARMASI sanar. Kullanici sarmasi kurulu maskeyi dusurdugu icin
   * kisa bir klipte her tur RMBG'yi bastan kosturuyordu — tarayicida olculdu:
   * 6 sn'lik dongulu klipte 30 saniyede 5 segmentasyon, her biri ~1.5 sn
   * (surenin ~%25'i). Bayrak, ayni sarmanin ikinci kez islenmesini engeller.
   */
  let wrapHandled = false;
  const seeking = () => {
    // Ayni sarma zaten 'loop' olarak islendi — ikinci sinyali yut.
    if (wrapHandled) {
      wrapHandled = false;
      return;
    }
    // HTML looping can emit seeking/seeked too. A running end-to-start
    // transition is a loop, not a request to rerun segmentation.
    const loop = video.loop && !video.paused && Number.isFinite(video.duration)
      && frameTime >= video.duration - 0.5 && video.currentTime < 0.5;
    invalidate(loop ? 'loop' : 'seek');
  };
  const seeked = () => { frameTime = video.currentTime; };
  video.addEventListener('seeking', seeking);
  video.addEventListener('seeked', seeked);
  const hasFrameCallback = typeof video.requestVideoFrameCallback === 'function';
  const presented: VideoFrameRequestCallback = (_now, metadata) => {
    if (!active) return;
    if (metadata.mediaTime < frameTime - 0.001) {
      invalidate('loop');
      wrapHandled = true;
    } else if (metadata.mediaTime > 0.5) {
      // Ileri ilerledik: bundan sonraki `seeking` YENI bir olaydir, yutulmaz.
      wrapHandled = false;
    }
    frameTime = metadata.mediaTime;
    frameCallback = video.requestVideoFrameCallback(presented);
  };
  if (hasFrameCallback) frameCallback = video.requestVideoFrameCallback(presented);
  const cleanup = () => {
    active = false;
    video.removeEventListener('seeking', seeking);
    video.removeEventListener('seeked', seeked);
    if (frameCallback !== null) {
      video.cancelVideoFrameCallback(frameCallback);
      frameCallback = null;
    }
  };
  const stopDriver = startLiveDepthDriver({
    infer: async () => {
      if (video.readyState < 2 || video.seeking) return null;
      if (!hasFrameCallback) {
        if (video.currentTime < frameTime - 0.001) {
          invalidate('loop');
          wrapHandled = true;
        } else if (video.currentTime > 0.5) {
          wrapHandled = false;
        }
        frameTime = video.currentTime;
      }
      const size = opts.girdiAl?.() ?? opts.girdi ?? LIVE_INPUT_SIZE;
      const mask = opts.maskeAl?.() ?? null;
      if (mask !== processedMask) {
        processedMask = mask;
        processedTime = Number.NaN;
        // A mask arriving while a model call is in flight changes the
        // post-processing contract. Invalidate that call instead of allowing
        // its maskless result to publish (or surface as a real GPU error).
        revision++;
      }
      if (size !== processedSize) {
        resetLiveDepthState();
        processedTime = Number.NaN;
        processedSize = size;
        // A quality change also changes processor dimensions and temporal
        // normalization. The previous-size result is obsolete, not a retryable
        // failure; the revision gate suppresses it at the model boundary.
        revision++;
      }
      if (frameTime === processedTime) return null;
      processedTime = frameTime;
      const capturedRevision = revision;
      // Settings can change while the awaited GPU request is running; the
      // loop cannot increment revision until that request has returned. Check
      // the live inputs at the result boundary too, before normalization can
      // mutate temporal state or an obsolete error can spend the retry budget.
      // Ordinary playback advancement still accepts completed depth frames.
      const isCurrent = () => active && capturedRevision === revision
        && size === (opts.girdiAl?.() ?? opts.girdi ?? LIVE_INPUT_SIZE)
        && mask === (opts.maskeAl?.() ?? null);
      try {
        return await estimateDepthLive(video, {
          girdi: size,
          subjectMask: mask,
          isCurrent,
        });
      } catch (error) {
        if (!isCurrent()) return null;
        // A failed frame may be retried even when playback is paused.
        processedTime = Number.NaN;
        throw error;
      }
    },
    onDepth: (result) => onDepth(result as LiveDepthResult),
    onError: (err, ardisik) => {
      opts.onError?.(err, ardisik);
      if (ardisik >= maxErrors) {
        cleanup();
        opts.onVazgec?.();
      }
    },
    maxErrors,
  });
  return () => {
    cleanup();
    stopDriver();
  };
}
