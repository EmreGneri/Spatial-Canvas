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
   * NEON — modun esprisi bloom AMA bu mod artık kendi başına zaten parlak.
   *
   * İLK PROFİL AGRESİFTİ VE ÖLÇÜMDE DÜŞTÜ. Emre'nin nesne-ayırma kırpması
   * (2026-09-26) ızgarayı özneye yoğunlaştırınca neon kenarları siluetin
   * İÇİNİ de dolduruyor; üstüne güçlü bloom binince kadraj beyazlıyor.
   * Ölçüldü (thumbnail.jpg, kırpma sonrası, aynı temiz oturumda arka arkaya):
   *
   *   post-FX kapalı        kapsam 0.610 · doyg 0.592 · kırpılan %0.350
   *   eski profil (1.15)    kapsam 0.915 · doyg 0.550 · kırpılan %0.402
   *   ara aday   (0.55)     kapsam 0.890 · doyg 0.556 · kırpılan %0.247
   *   BU PROFİL  (0.40)     kapsam 0.477 · doyg 0.606 · kırpılan %0.022
   *
   * Yani doğru yön GÜÇLENDİRMEK değil DİZGİNLEMEKTİ: yüksek eşik + düşük
   * şiddet + koyu vignette + 0.95 pozlama, ham moddan bile AZ kırpıyor
   * (%0.350 → %0.022, on altıda bir) ve doygunluğu yükseltiyor. Hafif
   * chromatic cam kırılmasının karşılığı.
   *
   * AÇIK KALAN (veri katmanıyla ortak karar): yakın plan öznede neon artık
   * tel kafes değil dolu bir kütle çiziyor. Asıl kol post-FX değil modun
   * KENDİ `uEdgeThreshold`'u (varsayılan 0.10); onu yükseltmek çizgileri geri
   * inceltir ama mevcut her sahnenin neon görünümünü değiştirir, o yüzden
   * tek taraflı değiştirilmedi.
   */
  neon: {
    bloom: { uBloomStrength: 0.4, uBloomRadius: 0.75, uBloomThreshold: 0.62 },
    chromatic: { uAmount: 0.0022, uRadial: 1 },
    grain: { uGrainAmount: 0.02, uVignette: 0.8, uContrast: 1, uSaturation: 1.3 },
    look: { uExposure: 0.95 },
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
