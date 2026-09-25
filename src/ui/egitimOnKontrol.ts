/**
 * 3D EĞİTİM ÖN KONTROLÜ — Z2'nin ikinci yarısı (yol haritası madde 1).
 *
 * NEDEN VAR: `3D eğit` ön ayar ekranı yalnız dosya adını ve özne seçeneğini
 * gösteriyordu. WebGPU olmayan tarayıcıda kullanıcı "eğitimi başlat"a basıyor,
 * kare çıkarma başlıyor ve ancak `ayarSec()` içinde patlıyordu — hata mesajı
 * doğruydu ama ZAMANI yanlıştı: kullanıcı beklemeyi baştan bilmiyordu, ne
 * yapacağını da öğrenmiyordu. Intel iGPU dışındaki cihazlarda hiçbir
 * yönlendirme yoktu.
 *
 * Burada karar DOM'suz verilir ki Node'dan doğrulanabilsin
 * (`scripts/verify-egitim-onkontrol.mjs`); `Egitim3D.tsx` yalnız çizer.
 */

export interface OnKontrolGirdi {
  /** `navigator.gpu` adapter alınabildi mi (yetenek raporundan). */
  webgpu: boolean;
  /** Tarayıcı kimliği — kurtarma adımları buna göre yazılır. */
  ua: string;
}

export interface OnKontrol {
  /** Eğitim başlatılabilir mi (buton etkin mi). */
  calisir: boolean;
  /** Tek satır durum: ekranın en üstünde görünür. */
  baslik: string;
  /** Çalışmıyorsa ne yapılacağı — sırayla denenecek adımlar. Boş olabilir. */
  adimlar: string[];
}

/**
 * Kurtarma adımları tarayıcıya göre ayrışır: Safari/Firefox'ta WebGPU ya yok
 * ya bayrak arkasında, Chrome/Edge'de genelde donanım hızlandırma kapalıdır.
 * Yanlış tarayıcıya "bayrağı aç" demek kullanıcıyı boşa yorar.
 */
export function egitimOnKontrol({ webgpu, ua }: OnKontrolGirdi): OnKontrol {
  if (webgpu) {
    return { calisir: true, baslik: 'WebGPU hazır — 3D eğitim bu cihazda çalışabilir.', adimlar: [] };
  }

  const safari = /Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua);
  const firefox = /Firefox/i.test(ua);
  const baslik = 'WebGPU açılamadı — 3D eğitim bu tarayıcıda çalışmaz.';

  if (safari) {
    return {
      calisir: false,
      baslik,
      adimlar: [
        'Safari 18+ sürümüne güncelleyin (WebGPU bu sürümde varsayılan açıktır).',
        'Güncelleyemiyorsanız Ayarlar > Gelişmiş > Özellik Bayrakları altından WebGPU’yu açın.',
        'Alternatif: aynı videoyu güncel Chrome veya Edge ile açın.',
      ],
    };
  }

  if (firefox) {
    return {
      calisir: false,
      baslik,
      adimlar: [
        'Firefox’ta WebGPU henüz tüm platformlarda açık değil; güncel sürüme geçin.',
        'about:config adresinde dom.webgpu.enabled değerini true yapıp tarayıcıyı yeniden başlatın.',
        'Alternatif: aynı videoyu güncel Chrome veya Edge ile açın.',
      ],
    };
  }

  return {
    calisir: false,
    baslik,
    adimlar: [
      'Tarayıcıyı güncelleyin (Chrome/Edge 113+ WebGPU’yu destekler).',
      'Ayarlar > Sistem bölümünde "Kullanılabilir olduğunda donanım hızlandırmayı kullan" açık olmalı; sonra tarayıcıyı yeniden başlatın.',
      'Uzak masaüstü / sanal makine kullanıyorsanız GPU erişimi kapalı olabilir; fiziksel makinede deneyin.',
    ],
  };
}

/** Seçilen ayar katmanının insan diliyle özeti (ön ayar ekranı + eğitim üstü). */
export function ayarOzeti(ayar: {
  gpu: string;
  tier: string;
  maxIters: number;
  maxFrames: number;
  zayifGpu: boolean;
}): string {
  const katman = ayar.zayifGpu ? 'hafif' : 'tam';
  return `${ayar.gpu} · ${katman} ayar (${ayar.tier}) · ${ayar.maxFrames} kare · ${ayar.maxIters.toLocaleString('tr-TR')} iterasyon`;
}
