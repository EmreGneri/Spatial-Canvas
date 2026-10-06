/**
 * HATA SINIRI METİNLERİ — DOM'suz, Node'dan test edilir.
 *
 * React ağacı çökerse ekran BEYAZ kalır ve konsolu açmayan kullanıcı ne
 * olduğunu hiç öğrenmez. Sınır ekranı bir yığın izi göstermez; hatayı
 * TANIDIĞI sınıfa oturtur ve o sınıfın KURTARMA YOLUNU verir.
 *
 * Sınıflar gerçek olaylardan çıkarıldı (hepsi bu projede yaşandı):
 *  - `onbellek`: transformers-cache'e HTML düşmüş, model JSON yerine sayfa
 *    okunuyor → "Unexpected token '<'". Tek çözüm Cache Storage'ı silmek;
 *    yenilemek TEK BAŞINA yetmez, o yüzden ayrı düğme var.
 *  - `webgl`: bağlam kaybı / shader derleme. Yenileme genelde yeter.
 *  - `bellek`: doku ya da dizi ayırması başarısız. Çözüm kaynağı küçültmek.
 *  - `bilinmeyen`: geri kalan her şey. Mesaj UYDURULMAZ, hatanın kendi
 *    metni gösterilir (kısaltılmış) — "bir şeyler ters gitti" tek başına
 *    kullanıcıyı kör bırakır.
 */

export type HataSinifi = 'onbellek' | 'webgl' | 'bellek' | 'bilinmeyen';

export interface HataGorunum {
  sinif: HataSinifi;
  baslik: string;
  /** Ne olduğu — tek cümle, teknik terim en aza indirilmiş. */
  aciklama: string;
  /** Kullanıcının yapabileceği adımlar, sırayla. */
  adimlar: string[];
  /** Önbellek temizleme düğmesi gösterilsin mi (yalnız `onbellek`). */
  onbellekTemizle: boolean;
  /** Hatanın kendi metni — katlanmış ayrıntıda gösterilir. */
  ham: string;
}

/** Ham metin kutuyu taşırmasın; teşhis için baş kısmı yeter. */
const HAM_SINIRI = 400;

function metin(hata: unknown): string {
  if (hata instanceof Error) return hata.message || hata.name;
  if (typeof hata === 'string') return hata;
  try {
    return JSON.stringify(hata) ?? String(hata);
  } catch {
    return String(hata);
  }
}

export function hataSinifla(hata: unknown): HataSinifi {
  const m = metin(hata).toLowerCase();
  // "Unexpected token '<'" ya da "<!doctype" — JSON beklenen yerde HTML.
  if (
    (m.includes('unexpected token') && (m.includes("'<'") || m.includes('<')))
    || m.includes('<!doctype')
    || m.includes('is not valid json')
  ) return 'onbellek';
  if (m.includes('context lost') || m.includes('webgl') || m.includes('shader')
    || m.includes('framebuffer') || m.includes('gl_invalid')) return 'webgl';
  if (m.includes('out of memory') || m.includes('allocation')
    || m.includes('array buffer allocation') || m.includes('invalid array length')) return 'bellek';
  return 'bilinmeyen';
}

export function hataGorunum(hata: unknown): HataGorunum {
  const ham = metin(hata).slice(0, HAM_SINIRI);
  const sinif = hataSinifla(hata);
  if (sinif === 'onbellek') {
    return {
      sinif,
      baslik: 'Model önbelleği bozuk',
      aciklama:
        'Model dosyası yerine bir web sayfası önbelleğe düşmüş; uygulama onu model sanıp okumaya çalıştı.',
      adimlar: [
        'Aşağıdaki "önbelleği temizle ve yenile" düğmesine bas.',
        'Sayfa açıldıktan sonra modeli gerektiren işi (derinlik, nesne ayırma) tekrar dene.',
        'Sorun sürerse ağ bağlantını kontrol et; model indirmesi yarıda kesilmiş olabilir.',
      ],
      onbellekTemizle: true,
      ham,
    };
  }
  if (sinif === 'webgl') {
    return {
      sinif,
      baslik: 'Grafik bağlamı düştü',
      aciklama:
        'Tarayıcının WebGL bağlamı kayboldu ya da bir shader derlenemedi; sahne çizilemiyor.',
      adimlar: [
        'Sayfayı yenile; bağlam yeniden kurulur.',
        'GPU kullanan başka sekmeleri (video, oyun, 3D eğitim) kapat.',
        'Tekrarlıyorsa ekran kaydı/donanım ivmesi ayarlarını kontrol et.',
      ],
      onbellekTemizle: false,
      ham,
    };
  }
  if (sinif === 'bellek') {
    return {
      sinif,
      baslik: 'Bellek yetmedi',
      aciklama: 'Bu boyutta bir kaynak için ayrılacak bellek bulunamadı.',
      adimlar: [
        'Daha küçük bir fotoğraf/video ile dene.',
        'Açık sekmeleri kapat ve yenile.',
        '3D eğitim açıksa kapat — aynı GPU belleğini paylaşıyor.',
      ],
      onbellekTemizle: false,
      ham,
    };
  }
  return {
    sinif,
    baslik: 'Arayüz beklenmeyen bir hatayla durdu',
    aciklama: 'Hatanın kendi metni aşağıda; sahne ve ayarlar bellekte kaybolmuş olabilir.',
    adimlar: [
      '"yeniden dene" ile arayüzü sıfırla; sayfa yenilenmez, açık kaynak korunmaya çalışılır.',
      'Aynı adımda tekrar oluyorsa sayfayı yenile.',
      'Hatanın metnini kopyalayıp bildir (aşağıda).',
    ],
    onbellekTemizle: false,
    ham,
  };
}

/**
 * Cache Storage'daki model önbelleklerini siler. Adı `transformers-cache`
 * olmayan bir sürüm de olabildiği için "transformers" içeren HER anahtar
 * silinir; başka önbelleklere (vite, workbox) dokunulmaz.
 */
export function onbellekAnahtarlari(hepsi: string[]): string[] {
  return hepsi.filter((ad) => ad.toLowerCase().includes('transformers'));
}
