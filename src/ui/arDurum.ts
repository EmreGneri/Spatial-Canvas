/**
 * AR/VR ÖN KONTROLÜ — DOM'suz, Node'dan test edilir.
 *
 * `egitimOnKontrol.ts` ile aynı desen ve aynı sebep: WebXR desteği cihaz ve
 * tarayıcıya göre değişiyor, kullanıcı düğmeye basıp "hiçbir şey olmadı"
 * görmemeli. Ne olacağı BASMADAN ÖNCE söylenir; desteklenmiyorsa sebep ve —
 * varsa — o cihazın gerçek yolu yazılır.
 *
 * İKİ OTURUM TÜRÜ: `immersive-ar` (telefon, geçirgen görüntü) ve
 * `immersive-vr` (başlık). Sahne ikisinde de aynı; hangisi varsa o açılır.
 * "AR yok" demek bir masaüstü başlığı kullanıcısına yanlış bilgi olurdu.
 */

export type ArKipi = 'immersive-ar' | 'immersive-vr';

export interface ArDurum {
  /** Oturum açılabilir mi. */
  acilabilir: boolean;
  /** Açılacak oturum türü — `acilabilir` false ise null. */
  kip: ArKipi | null;
  /** Düğme etiketi: cihazın gerçekten yapacağı şey. */
  etiket: string;
  /** Bir cümle durum. */
  baslik: string;
  /** Yapılabilecekler — desteklenmiyorsa gerçek yol, destekliyorsa kullanım. */
  adimlar: string[];
}

export interface ArGirdi {
  /** `navigator.xr` var mı. */
  xrVar: boolean;
  /** `isSessionSupported('immersive-ar')` — null = sorulmadı/hata. */
  arDestekli: boolean | null;
  /** `isSessionSupported('immersive-vr')`. */
  vrDestekli: boolean | null;
  /** Gösterilecek bir sahne var mı (splat/nokta bulutu dolu). */
  sahneVar: boolean;
  ua: string;
}

/** Güvenli bağlam uyarısı: WebXR yalnız https (ve localhost) üzerinde açılır. */
export function guvensizBaglam(protokol: string, host: string): boolean {
  if (protokol === 'https:') return false;
  return !(host === 'localhost' || host.startsWith('localhost:') || host.startsWith('127.0.0.1'));
}

function tarayiciYolu(ua: string): string[] {
  const u = ua.toLowerCase();
  // iOS: WebKit'te WebXR yok — Chrome/Firefox da aynı motoru kullandığı için
  // "başka tarayıcı dene" demek YANLIŞ bilgi olur.
  if (/iphone|ipad|ipod/.test(u) || (/macintosh/.test(u) && /mobile/.test(u))) {
    return [
      'iOS/iPadOS tarayıcılarında WebXR yok: Safari de, Chrome da aynı motoru kullanıyor.',
      'Bu cihazda sahneyi görmek için .ply çıktısını indirip bir 3DGS görüntüleyicide aç.',
    ];
  }
  if (/android/.test(u)) {
    return [
      'Android Chrome/Edge güncel olmalı (WebXR oradan gelir).',
      '"Google Play AR Hizmetleri" (ARCore) kurulu ve güncel olmalı; Play Store’dan güncelle.',
      'Sayfa https üzerinden açılmalı; http’de WebXR izin vermez.',
    ];
  }
  if (/firefox/.test(u)) {
    return [
      'Firefox masaüstünde WebXR varsayılan kapalıdır.',
      'Başlık kullanıyorsan Chrome/Edge ya da başlığın kendi tarayıcısını dene.',
    ];
  }
  return [
    'Masaüstünde AR yok; bağlı bir VR başlığı varsa Chrome/Edge onu bulur.',
    'Başlık yoksa sahneyi telefonda aç (Android Chrome) ya da .ply çıktısını indir.',
  ];
}

export function arDurum(g: ArGirdi): ArDurum {
  if (!g.sahneVar) {
    return {
      acilabilir: false,
      kip: null,
      etiket: 'AR’da gör',
      baslik: 'Gösterilecek sahne yok.',
      adimlar: [
        'Bir fotoğraf/video yükle ya da 3D eğitimi tamamla.',
        'Sahne hazır olduğunda bu düğme etkinleşir.',
      ],
    };
  }
  if (!g.xrVar) {
    return {
      acilabilir: false,
      kip: null,
      etiket: 'AR’da gör',
      baslik: 'Bu tarayıcıda WebXR yok.',
      adimlar: tarayiciYolu(g.ua),
    };
  }
  if (g.arDestekli) {
    return {
      acilabilir: true,
      kip: 'immersive-ar',
      etiket: 'AR’da gör',
      baslik: 'Sahne kameranın gördüğü ortama yerleştirilecek.',
      adimlar: [
        'Telefonu yavaşça gezdir; sahne odanın içinde duruyormuş gibi görünür.',
        'Post-efektler (bloom, grain, chromatic) AR’da KAPALI: sahne doğrudan çizilir.',
        'Çıkmak için tarayıcının kendi "çık" düğmesini kullan.',
      ],
    };
  }
  if (g.vrDestekli) {
    return {
      acilabilir: true,
      kip: 'immersive-vr',
      etiket: 'başlıkta gör',
      baslik: 'Cihazda AR yok, VR başlığı var; sahne başlıkta açılacak.',
      adimlar: [
        'Başlığı tak, sonra düğmeye bas.',
        'Post-efektler (bloom, grain, chromatic) başlıkta KAPALI: sahne doğrudan çizilir.',
        'Çıkmak için başlığın kendi menüsünü kullan.',
      ],
    };
  }
  // XR var ama iki kip de yok — ya sorgu hata verdi ya cihaz yetmiyor.
  const sorulamadi = g.arDestekli === null && g.vrDestekli === null;
  return {
    acilabilir: false,
    kip: null,
    etiket: 'AR’da gör',
    baslik: sorulamadi
      ? 'WebXR desteği sorulamadı.'
      : 'WebXR var ama bu cihazda ne AR ne VR oturumu açılabiliyor.',
    adimlar: tarayiciYolu(g.ua),
  };
}
