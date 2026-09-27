import type { RenderMode } from '../ui/ModeSelector';

/**
 * RENDER MODU VARSAYILAN KALİTESİ — post-FX'in mod başına başlangıç değerleri.
 *
 * ── SORUN ──────────────────────────────────────────────────────────────────
 * Altı modun post-FX'i KOD VARSAYILANINDA duruyordu ve o varsayılanlar
 * pratikte KAPALI demekti: bloom 0, chromatic 0, grain 0, sis 0, pozlama 1.
 * Yani her mod aynı "işlenmemiş" görüntüyü veriyordu; preset kütüphanesinin
 * kapakları da bu yüzden birbirine benziyordu.
 *
 * ── ÖLÇÜM YÖNTEMİ ──────────────────────────────────────────────────────────
 * "Göz kararı" yerine her mod iki sahnede ölçüldü (sentetik sahne ve
 * `assets/thumbnail.jpg`), 320×200 kareden:
 *   konuOran   — L > 0.05 olan piksel oranı (konu kadrajın ne kadarını tutuyor)
 *   konuDoyg   — YALNIZ o piksellerde ortalama doygunluk (mx-mn)/mx
 *   p99, maks  — tepe taraf
 *   kırpılan   — L > 0.98 oranı; hiçbir profilde %0'dan büyük olmayacak
 * Arka plan hariç tutuldu: kadrajın ~%95'i siyah olduğu için genel ortalama
 * post-FX farkını gizliyordu.
 *
 * ── YOL BOYUNCA ÇIKAN İKİ BULGU ────────────────────────────────────────────
 * 1. `uContrast` LİNEER uzayda 0.5 etrafında dönüyor; sahnenin siyahı lineer
 *    ~0.003 olduğu için 1'in üstündeki her kontrast onu EKSİYE düşürüyordu ve
 *    kayan noktalı ara tamponda eksi değer hayatta kalıp OutputPass'in sRGB
 *    pow'unu tanımsız yapıyordu (ASCII'de zemin 0.035 → 0.34, yani kontrastı
 *    ARTIRMAK zemini AYDINLATIYORDU). `grainPass.ts`'e kelepçe eklendi.
 * 2. Kelepçeden sonra bile kontrast > 1 SÖNÜK KONU piksellerini siyaha
 *    düşürüyor. Ölçüldü (thumbnail.jpg): kontrast 1.08'de Point Cloud konu
 *    kapsamı 0.0060 → 0.0049, ASCII 1.18'de 0.0043 → 0.0036. Bu yüzden
 *    HİÇBİR PROFİLDE kontrast 1'in üstünde değil; istenen "daha güçlü
 *    görüntü" pozlama ve doygunlukla alındı.
 *
 * ── SONUÇ (thumbnail.jpg · kapalı → profil) ────────────────────────────────
 * DİKKAT: aşağıdaki sayılar Emre'nin nesne-ayırma kırpmasından SONRA, tek bir
 * temiz oturumda alındı. Kırpma özne ızgarasını ~3.7× yoğunlaştırdığı için
 * kırpma öncesi ölçülen değerler artık geçerli değil — tablo yenilendi.
 *
 *   mod          kapsam            doygunluk        kırpılan %
 *   Point Cloud  0.181 → 0.451     0.633 → 0.575    0.002 → 0.002
 *   ASCII        0.024 → 0.028     0.434 → 0.349    0     → 0
 *   Neon         0.610 → 0.477     0.592 → 0.606    0.350 → 0.022
 *   Solid        0.047 → 0.097     0.327 → 0.341    0     → 0
 *   Splat        0.027 → 0.040     0.445 → 0.505    0     → 0
 *   Crystal      0.026 → 0.036     0.112 → 0.131    0     → 0
 *
 * Beş modda kapsam ARTTI; Neon'da bilerek AZALDI (yukarıdaki gerekçe: mod
 * kırpmadan sonra kendi başına taşıyordu, profil onu dizginliyor). Kırpılan
 * piksel oranı HİÇBİR modda profille artmadı; Neon'da on altıda bire indi.
 * ASCII'nin doygunluğu bilerek düşük (terminal dili). Solid'in kazancı ölçüm
 * sınırına yakın — o modda post-FX'in yapabileceği az, dürüst kayıt bu.
 *
 * ── TASARIM KARARI ─────────────────────────────────────────────────────────
 * Her modun post-FX'i o modun KENDİ malzemesine göre ayarlandı. Ortak bir
 * "güzel" profil YOK, çünkü aynı bloom ASCII'de harfleri okunmaz yaparken
 * Neon'da modun bütün esprisini oluşturuyor.
 *
 * ── KULLANICININ AYARI KAYBOLMAZ ───────────────────────────────────────────
 * Profil mod değişiminde uygulanır, ama moddan ÇIKARKEN o modun o anki
 * değerleri hafızaya alınır (App · modHafizaYaz). Aynı moda dönüldüğünde
 * kullanıcının kendi ayarı geri gelir, profil değil. Hafıza OTURUMLUKTUR:
 * kalıcı olması istenirse preset kaydı zaten var.
 */

export interface KaliteProfili {
  bloom?: { uBloomStrength?: number; uBloomRadius?: number; uBloomThreshold?: number };
  chromatic?: { uAmount?: number; uRadial?: number; uAngle?: number };
  grain?: {
    uGrainAmount?: number; uGrainSpeed?: number; uVignette?: number;
    uContrast?: number; uSaturation?: number;
  };
  look?: { uExposure?: number; uFogDensity?: number };
}

export const MOD_KALITE: Record<RenderMode, KaliteProfili> = {
  /**
   * POINT CLOUD — siyah üstünde seyrek parlak nokta. Eksik olan, noktaların
   * BİRBİRİNE bağlanması: geniş ama eşikli bloom onları yüzeye dönüştürür.
   * Ölçüldü: konu kapsamı 0.0060 → 0.0124 (iki katı), p99 0.0008 → 0.083.
   */
  points: {
    bloom: { uBloomStrength: 0.35, uBloomRadius: 0.75, uBloomThreshold: 0.6 },
    grain: { uVignette: 0.55, uContrast: 1, uSaturation: 1.12 },
    look: { uExposure: 1.05 },
  },

  /**
   * ASCII — bloom BİLEREK KAPALI. Denendi: 0.2 parlamada bile harf kenarları
   * birbirine akıyor; ASCII'nin tek görsel dayanağı glif kenarının
   * keskinliği. Güç pozlamadan alındı, doygunluk düşürüldü (terminal dili).
   * Ölçüldü: konu kapsamı 0.0043 → 0.0069.
   */
  ascii: {
    bloom: { uBloomStrength: 0, uBloomRadius: 0.5, uBloomThreshold: 0.85 },
    chromatic: { uAmount: 0 },
    grain: { uGrainAmount: 0, uVignette: 0.5, uContrast: 1, uSaturation: 0.85 },
    look: { uExposure: 1.08 },
  },

  /**
   * NEON — İKİ KEZ ÖLÇÜLDÜ, İKİ KEZ DEĞİŞTİ. Kaydı olduğu gibi bırakıyorum,
   * çünkü ikinci değişim birincinin GEREKÇESİNİ ortadan kaldırdı.
   *
   * 1. TUR (nesne ayırma kırpması geldikten sonra). Kırpma ızgarayı özneye
   *    sıkıştırınca neon kenarları siluetin İÇİNİ de dolduruyordu; mod kendi
   *    başına taşıyordu (kapsam 0.610, kırpılan %0.350) ve güçlü bloom kadrajı
   *    beyazlatıyordu. Profil DİZGİNLENDİ (bloom 0.40, eşik 0.62, pozlama
   *    0.95) ve kırpma on altıda bire indi.
   *
   * 2. TUR (veri katmanı Sobel eşiğini kırpmanın alan oranıyla telafi etti —
   *    `uCropDensity`). Mod tel kafese geri döndü: AYNI fotoğrafta ham kapsam
   *    0.610 → 0.0114, kırpılan %0.350 → %0. Yani dizginlemenin sebebi kalmadı;
   *    dizginlenmiş profil artık gereksiz temkinliydi.
   *
   * ÖLÇÜM (thumbnail.jpg, kırpma AÇIK, telafi sonrası). Doygunluk iki banda
   * ayrıldı — ortalama doygunluk hâleyi de sayıyor ve "renk soldu mu"
   * sorusunu gizliyordu; asıl soru TÜPÜN KENDİSİ canlı mı:
   *
   *   profil              çekirdek(L>0.30)      hâle        kırpılan
   *                       oran     doygunluk    oran
   *   post-FX kapalı      0.0060   0.340        0.0054      %0
   *   1. tur (0.40)       0.0083   0.462        0.0253      %0
   *   BU PROFİL (0.70)    0.0140   0.427        0.0517      %0
   *   denendi   (1.00)    0.0290   0.398        0.0867      %0
   *
   * Hepsi çekirdek doygunluğunu ham moddan YUKARI çekiyor (veri katmanının
   * bildirdiği "kırpılmışta doygunluk düşüyor" sorusunun cevabı bu). 0.40 en
   * yüksek doygunluğu veriyor ama ışıklı alan neredeyse ham mod kadar; 1.00
   * alanı büyütürken rengi düzleştiriyor. 0.70 ikisinin ortası: ışıklı
   * çekirdek ham modun 2.3 katı, doygunluk hâlâ %26 yukarıda, kırpma sıfır.
   *
   * Kırpmasız yolda da güvenli (sentetik sahne, aynı sweep): çekirdek
   * 0.0003 → 0.0014, doygunluk 0.280 → 0.327, kırpılan %0.
   *
   * Hafif chromatic cam kırılmasının karşılığı; doygunluk yukarı, renk bu
   * modda tek anlam taşıyıcısı.
   */
  neon: {
    bloom: { uBloomStrength: 0.7, uBloomRadius: 0.8, uBloomThreshold: 0.5 },
    chromatic: { uAmount: 0.0022, uRadial: 1 },
    grain: { uGrainAmount: 0.02, uVignette: 0.75, uContrast: 1, uSaturation: 1.3 },
    look: { uExposure: 1 },
  },

  /**
   * SOLID — ışıklı kapalı yüzey. Bloom orta eşikte: yüzeyin tamamı parlarsa
   * kabuk plastikleşir. Sis derinlik verir — solid, gerçek bir hacim gösteren
   * tek mod, mesafe okunmalı. DÜRÜST KAYIT: ölçülen kazanç sınırda
   * (konuDoyg 0.281 → 0.295, kapsam neredeyse sabit); bu modda post-FX'in
   * yapabileceği az.
   */
  solid: {
    bloom: { uBloomStrength: 0.4, uBloomRadius: 0.55, uBloomThreshold: 0.6 },
    grain: { uVignette: 0.5, uContrast: 1, uSaturation: 1.05 },
    look: { uExposure: 1, uFogDensity: 0.02 },
  },

  /**
   * SPLAT — Gaussian'lar zaten yumuşak ve örtüşük; bloom eklemek bulanıklığı
   * artırır. Kazanç asıl doygunluktan geliyor: 0.425 → 0.477. Vignette
   * kadrajın kenarındaki seyrek splat'ları saklar.
   */
  splat: {
    bloom: { uBloomStrength: 0.35, uBloomRadius: 0.65, uBloomThreshold: 0.55 },
    grain: { uVignette: 0.6, uContrast: 1, uSaturation: 1.15 },
    look: { uExposure: 1.05 },
  },

  /**
   * CRYSTAL — fresnel + specular. Bloom eşiği YÜKSEK (0.72) ki yalnız
   * parlamalar yakalansın; chromatic burada süs değil, cam dispersiyonunun
   * karşılığı. Altı mod içinde en büyük kazanç burada: konuDoyg 0.175 → 0.299.
   */
  crystal: {
    bloom: { uBloomStrength: 0.6, uBloomRadius: 0.7, uBloomThreshold: 0.72 },
    chromatic: { uAmount: 0.003, uRadial: 1 },
    grain: { uVignette: 0.55, uContrast: 1, uSaturation: 1.18 },
    look: { uExposure: 1.05 },
  },
};

/** Profilin dokunduğu post-FX grupları — hafıza da yalnız bunları tutar. */
export const KALITE_GRUPLARI = ['bloom', 'chromatic', 'grain', 'look'] as const;
export type KaliteGrubu = (typeof KALITE_GRUPLARI)[number];

/**
 * PROFİLİ TAM SÖZLÜĞE AÇAR. Profilde YAZILMAYAN kol, o grubun KOD
 * VARSAYILANINA döner — yazılmamış kolu "olduğu gibi bırakmak", önceki modun
 * ayarını sonrakine sızdırırdı (Neon'dan çıkınca chromatic açık kalması).
 */
export function profiliCoz(
  profil: KaliteProfili,
  varsayilan: Record<KaliteGrubu, Record<string, number>>,
): Record<KaliteGrubu, Record<string, number>> {
  const out = {} as Record<KaliteGrubu, Record<string, number>>;
  for (const g of KALITE_GRUPLARI) {
    out[g] = { ...varsayilan[g], ...(profil[g] ?? {}) };
  }
  return out;
}

/** Oturumluk hafıza: mod → kullanıcının o modda bıraktığı değerler. */
export type ModHafizasi = Partial<Record<RenderMode, Record<KaliteGrubu, Record<string, number>>>>;

/**
 * Moda girerken uygulanacak değerler: kullanıcı o modda daha önce ayar
 * yaptıysa ONUN değerleri, yoksa profil.
 */
export function girisDegerleri(
  mod: RenderMode,
  hafiza: ModHafizasi,
  varsayilan: Record<KaliteGrubu, Record<string, number>>,
): Record<KaliteGrubu, Record<string, number>> {
  return hafiza[mod] ?? profiliCoz(MOD_KALITE[mod], varsayilan);
}

/**
 * Bir profilin, koda göre GERÇEKTEN bir şey değiştirip değiştirmediği.
 * `false` dönen bir mod "ayarlanmamış" demektir — bu dosyanın var olma
 * sebebi tam olarak o durumdu.
 */
export function profilEtkili(
  profil: KaliteProfili,
  varsayilan: Record<KaliteGrubu, Record<string, number>>,
): boolean {
  for (const g of KALITE_GRUPLARI) {
    const p = profil[g];
    if (!p) continue;
    for (const [k, v] of Object.entries(p)) {
      if (varsayilan[g]?.[k] !== v) return true;
    }
  }
  return false;
}
