/**
 * ÇEKİM ÖN NOTLARI — eğitim BAŞLAMADAN önce, videonun kendisi hakkında.
 * DOM'suz, Node'dan test edilir.
 *
 * ── NEDEN ──────────────────────────────────────────────────────────────────
 * Ön ayar ekranı bugüne kadar videoyu hiç AÇMIYORDU: `egitimOnKontrol` yalnız
 * cihaza (WebGPU) bakıyor, klibin kendisi hakkında tek kelime yok. Kullanıcı
 * 854×480'lik bir klibi "[4K]" adıyla yükleyip beş dakika bekledikten sonra
 * sonucun neden yumuşak olduğunu hiçbir yerde göremiyordu.
 * (`assets/test-clips/[4K] 5 minute quick walk … NYU …mp4` gerçekten
 * 854×480'dir — ölçüldü.)
 *
 * ── NEYİ KULLANMIYORUZ, NEDEN ──────────────────────────────────────────────
 * Vendor'ın kare tarayıcısı keskinlik (`focus`), parlaklık (`lum`) ve kırpılma
 * (`clip`) skorları üretiyor. ÜÇÜ DE EŞİK OLARAK KULLANILAMAZ, ölçüldü
 * (dört gerçek klip, vendor'ın kendi fonksiyonlarıyla):
 *
 *   klip                      çözünürlük   focus medyan   lum med   clip p95
 *   7578546-uhd               3840×2160          322       0.435      0.035
 *   [4K] … NYU …               854×480           600       0.469      0.019
 *   yay-100derece-stgeorge    4096×1974          609       0.388     0.0001
 *   yay-210derece-mariatheresa 3840×2160         931       0.410      0.084
 *
 *  - `focus` KESKİNLİĞİ DEĞİL SAHNE DOKUSUNU ölçüyor: gerçek 4K klip en DÜŞÜK
 *    (322), 480p yürüyüş klibi %86 daha yüksek (600). Kar, sis, düz cephe,
 *    beyaz duvar hep düşük çıkar ve hepsi tamamen nettir. Vendor da mutlak
 *    eşik kullanmıyor; `markOutliers` komşu medyanına GÖRECELİ çalışıyor.
 *  - `clip`: mariatheresa p95 %8,4 — meşru güneşli cephe. %5-8 bandındaki bir
 *    eşik o klibi haksız uyarırdı.
 *  - `lum`: ölçülen dört klip de gündüz (0,39-0,47). Bu repoda DÜŞÜK parlaklık
 *    bandında hiç ölçüm yok; eşik koymak uydurma olurdu. Gece çekimi meşrudur.
 *
 * Bu yüzden burada YALNIZCA fiziksel/nesnel alanlar var: çözünürlük, süre,
 * fps. Üçü de ~ms'de, tek kare bile decode etmeden okunur.
 *
 * ── UYARI DEĞİL, NOT ───────────────────────────────────────────────────────
 * Hiçbir not eğitimi ENGELLEMEZ. Engelleme yalnız cihaz yapamıyorsa
 * (`egitimOnKontrol`, WebGPU) — o bir YETENEK kararı. Çekim kalitesi ise
 * belirsizliği yüksek bir tahmin; engellemek kullanıcının meşru gece/makro/
 * düz-cephe çekimini reddetmek olurdu (`docs/tasarim-kurallari.md`, kapalı
 * düğme kuralı).
 *
 * Sorun yoksa dizi BOŞ döner ve ekranda HİÇBİR ŞEY çizilmez — `yetenekGorunum`
 * ile aynı kural: "çalışan kurulumda 'her şey yolunda' rozeti, sonraki gerçek
 * uyarının okunmamasına yol açar".
 */

export interface CekimNotu {
  /** Kısa başlık — ne saptandı. */
  baslik: string;
  /** Ölçülen GERÇEK sayıyı içerir; genel laf etmez. */
  sebep: string;
  /** Kullanıcının yapabileceği somut şey. */
  eylem: string;
}

export interface CekimOlcusu {
  /** `video.videoWidth` — döndürme uygulanmış görüntü genişliği. */
  genislik: number;
  /** `video.videoHeight`. */
  yukseklik: number;
  /** Saniye. Canlı akışta `Infinity` gelebilir. */
  sureSn: number;
  /** Bilinmiyorsa `null` — bilinmemek kötü DEĞİLDİR, not üretmez. */
  fps: number | null;
}

/**
 * Eğitimin gerçekten kullanabileceği en büyük kenar. `io/frames.js`:
 * SfM özniteliği 960 px, eğitim 1600 px ile sınırlı ve girdi bu tavanlara
 * YUKARI ÖRNEKLENMEZ. 1280 eşiği "1600'lük tavanın belirgin altında" demek;
 * 1080p ve üstü not almaz.
 */
export const EN_AZ_UZUN_KENAR = 1280;

/**
 * KISA kenara değil UZUN kenara bakılır. Dikey telefon videosu (1080×1920)
 * kısa kenara bakan bir kuralda haksız düşerdi — oysa eğitim uzun kenarı
 * kullanır.
 */
export function uzunKenar(o: Pick<CekimOlcusu, 'genislik' | 'yukseklik'>): number {
  return Math.max(o.genislik, o.yukseklik);
}

/**
 * SfM'in kamera çözebilmesi için gereken en kısa sürekli hareket. Altında
 * paralaks tabanı oluşmuyor; `sfm.js` bu hâlde "need more parallax/overlap"
 * ile düşüyor ve kullanıcı bunu ancak dakikalar sonra görüyor.
 */
export const EN_AZ_SURE_SN = 3;

/**
 * Yumuşak eşik: bu repoda süre→kalite eğrisi ÖLÇÜLMEDİ;
 * 20 sn bir kapsama hatırlatmasıdır, kalite garantisi değildir.
 */
export const ONERILEN_SURE_SN = 20;

/**
 * Bunun altında ara kare kalmıyor: bulanıklık çukuruna düşen bir kareyi
 * kurtaracak komşu aday yok (`markOutliers` komşuya bakar).
 */
export const EN_AZ_FPS = 20;

/**
 * Notları üretir. SIRALAMA: en çok kısıtlayandan en aza — çözünürlük bir
 * TAVAN'dır (sonradan düzeltilemez), süre ve fps yeniden çekimle düzelir.
 *
 * Geçersiz/bilinmeyen alan NOT ÜRETMEZ: `videoWidth` bazı tarayıcılarda
 * metadata gelmeden 0'dır, `duration` canlı akışta `Infinity`'dir. "Bilmiyorum"
 * ile "kötü" karıştırılırsa ilk gerçek not da güvenilirliğini kaybeder.
 */
export function cekimNotlari(o: CekimOlcusu): CekimNotu[] {
  const notlar: CekimNotu[] = [];
  const kenar = uzunKenar(o);

  if (Number.isFinite(kenar) && kenar > 0 && kenar < EN_AZ_UZUN_KENAR) {
    notlar.push({
      baslik: 'Çözünürlük düşük',
      sebep: `Klip ${o.genislik}×${o.yukseklik}. Eğitim uzun kenarı 1600 px'e kadar kullanabiliyor, `
        + 'kamera çözümü 960 px\'e kadar; bu klip ikisini de dolduramıyor ve görüntü yukarı örneklenmez.',
      eylem: 'Aynı sahneyi 1080p ya da üstünde yeniden çekersen detay tavanı yükselir.',
    });
  }

  if (Number.isFinite(o.sureSn) && o.sureSn > 0 && o.sureSn < EN_AZ_SURE_SN) {
    notlar.push({
      baslik: 'Klip çok kısa',
      sebep: `Klip ${o.sureSn.toFixed(1)} sn. Kamera pozları kareler arası yer değiştirmeden (paralaks) çözülüyor; `
        + 'bu sürede yeterli taban oluşmayabilir.',
      eylem: 'Nesnenin ETRAFINDA 8-10 sn yürüyerek çek; yerinde dönmek paralaks üretmez.',
    });
  }

  if (Number.isFinite(o.sureSn) && o.sureSn >= EN_AZ_SURE_SN && o.sureSn < ONERILEN_SURE_SN) {
    notlar.push({
      baslik: 'Klip kısa',
      sebep: `Klip ${o.sureSn.toFixed(1)} sn. ${ONERILEN_SURE_SN} sn altındaki bir çekim sahneyi yeterince `
        + 'farklı açıdan göstermeyebilir.',
      eylem: 'Sonuç yamalı ya da yan bakışta bozuk çıkarsa sahnenin etrafında 20-60 sn yavaşça yürüyerek yeniden çek.',
    });
  }

  if (o.fps !== null && Number.isFinite(o.fps) && o.fps > 0 && o.fps < EN_AZ_FPS) {
    notlar.push({
      baslik: 'Kare hızı düşük',
      sebep: `Klip ${o.fps.toFixed(0)} fps. Bulanık bir kare çıktığında onun yerine seçilecek komşu aday kalmıyor.`,
      eylem: 'Mümkünse 30 fps ve üstünde çek.',
    });
  }

  return notlar;
}

// ── EĞİTİM SIRASINDA: SfM SONRASI ÖLÇÜLER ──────────────────────────────────
//
// Bunlar videonun başlığından değil, kare taraması ve kamera çözümünden gelir;
// eğitim başladıktan sonra bilinir. Aynı kurallar: sorun yoksa boş dizi,
// bilinmeyen (NaN) not üretmez, hiçbir not eğitimi durdurmaz.

export interface CekimKalitesi {
  /** Taranan karelerin komşularına GÖRE bulanık işaretlenen oranı (vendor
   *  `markOutliers`: kare, ±7 komşusunun medyan netliğinin %70'inin altında).
   *  Göreli ölçü — mutlak netlik eşiği değil (yukarıdaki ölçüm notuna bkz.). */
  bulanikOran: number;
  /** En uzak iki kamera merkezi arası / medyan sahne derinliği. */
  tabanOrani: number;
  /** Kamera bakış yönleri arasındaki en büyük açı (derece). */
  donmeDerece: number;
}

/** Bu oranın altında kamera konumu sahne derinliğine göre neredeyse sabit.
 *  Gezinme güveni 0,02'de "çeşitlilik yetersiz" diyor; not daha erken uyarır. */
export const EN_AZ_TABAN_ORANI = 0.05;
/** Taban küçükken bakış yönü bundan fazla dönmüşse "yerinde dönme". */
export const YERINDE_DONME_DERECE = 20;
/** Taranan karelerin bundan fazlası bulanık işaretliyse. */
export const COK_BULANIK_ORAN = 0.25;

export function cekimKaliteNotlari(k: CekimKalitesi): CekimNotu[] {
  const notlar: CekimNotu[] = [];
  if (Number.isFinite(k.tabanOrani) && Number.isFinite(k.donmeDerece)
    && k.tabanOrani < EN_AZ_TABAN_ORANI && k.donmeDerece >= YERINDE_DONME_DERECE) {
    notlar.push({
      baslik: 'Kamera çoğunlukla yerinde dönüyor',
      sebep: `Kamera bakışı ${k.donmeDerece.toFixed(0)}° dönmüş ama konumu sahne derinliğinin yalnız `
        + `${k.tabanOrani.toFixed(2)} katı kadar yer değiştirmiş. Derinlik yer değiştirmeden (paralaks) çözülür; `
        + 'yan bakışlarda bozulma ve yüzen lekeler beklenir.',
      eylem: 'Telefonu çevirmek yerine sahnenin etrafında ya da boyunca yürüyerek çek.',
    });
  }
  if (Number.isFinite(k.bulanikOran) && k.bulanikOran > COK_BULANIK_ORAN) {
    notlar.push({
      baslik: 'Bulanık kare oranı yüksek',
      sebep: `Taranan karelerin %${Math.round(k.bulanikOran * 100)}'i komşularından belirgin bulanık. `
        + 'Seçici en net kareleri alıyor ama aday azaldıkça bulanık kare eğitime girebilir.',
      eylem: 'Daha yavaş hareket et, iyi ışıkta çek; mümkünse sabitleme (OIS/gimbal) aç.',
    });
  }
  return notlar;
}
