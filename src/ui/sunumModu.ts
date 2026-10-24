/**
 * SUNUM MODU — enstrümanı sergiden ayıran tek anahtar. DOM'suz, Node'dan
 * test edilir.
 *
 * ── NEDEN ──────────────────────────────────────────────────────────────────
 * Arayüz bir ARAŞTIRMA ENSTRÜMANI olarak büyüdü: graf editörü, eval raporu,
 * kuvvet kaydırıcıları, ham log. Her panel bir GELİŞTİRİCİNİN sorusunu
 * cevaplıyor. Ekranda İZLEYİCİNİN sorusunu ("bu ne, ne yapmalıyım, neden
 * önemli") cevaplayan hiçbir şey yok.
 *
 * Ölçüldü (1440×900, 2026-10-17): ilk ekranda **44** kontrol, sayfada toplam
 * **77** (52 düğme, 15 kaydırıcı), sayfa **2,3 ekran** boyunda ve açılışta
 * tuval **boş siyah**. `docs/tasarim-kurallari.md`'nin Hick maddesi ilk
 * ekranda ≤ 12 birincil kontrol diyor — kendi kuralımızın 3,7 katındayız.
 *
 * ── NE YAPMAZ ──────────────────────────────────────────────────────────────
 * Bu mod HİÇBİR ŞEY SİLMEZ ve hiçbir davranışı değiştirmez; yalnız bir
 * alt kümeyi MOUNT ETMEZ. Parametre kalkınca arayüz bit bit eski hâlinde.
 * Gizlenen panellerin durumu da yok olmaz — zaten mount edilmedikleri için
 * hiç kurulmazlar (TrackerOverlay deseni).
 *
 * ── NEDEN URL PARAMETRESİ ──────────────────────────────────────────────────
 * Kalıcı bir ayar (localStorage) değil: sunumdan sonra "kapatmayı unutma"
 * diye bir durum kalmasın. Bağlantıyı aç, mod açık; sekmeyi kapat, bitti.
 * Aynı sebeple ekranda bir "sunum modu" rozeti de YOK — rozet, saklamaya
 * çalıştığımız kalabalığın kendisi olurdu.
 */

/** Sunum modunda MOUNT EDİLMEYENLER ve her birinin gerekçesi. */
export const SUNUM_DISI = {
  nodeGraph: 'düğüm grafiği: boru hattının iç yapısı, izleyicinin sorusu değil',
  capture: 'capture paneli: ayrı bir video akışı, demo senaryosunda yok',
  metrics: 'eval raporu: AbsRel/RMSE/IoU duvarı; ölçüm tek satıra indirildi',
  presets: 'preset kaydet/yükle: oturum yönetimi, gösterilecek bir şey değil',
  forces: 'kuvvet kaydırıcıları: 5 kol, sahnenin görünüşünü değiştirmez',
  log: 'ham log şeridi: tanı çıktısı',
  kamera: 'kamera: canlı demoda izin diyaloğu riski',
  videoUc3B: 'video → 3B: 3D eğit ile aynı vuruş, ikisi birden kafa karıştırır',
  nesneAyirma: 'nesne ayırma / maskeyi göster / tracker: durum okuması, fiil değil',
  orijinalRenkler: 'orijinal renkler: tek bir render kolu',
  duzVideo: 'düz video: tracker HUD’u için tanı görünümü, tracker zaten gizli',
} as const;

/**
 * Sunum modunda KALANLAR — dört vuruşluk demo senaryosunun gerektirdiği
 * asgari küme. Her biri senaryodaki bir adıma karşılık gelir.
 */
export const SUNUM_ICI = {
  sentetik: '1. vuruş: düz görüntüden hacim',
  dosya: '1./3. vuruş: kendi fotoğrafı ya da videosu',
  egit: '3. vuruş: 3DGS eğitimi + canlı PSNR eğrisi',
  modlar: '2. vuruş: altı render modu (en görsel kısım)',
  temizle: '4. vuruş: elle temizleme + "ince engelleri göremez"',
  cikti: 'kapanış: PNG/WebM/PLY',
} as const;

/**
 * Adres yerel geliştirme sunucusu mu?
 *
 * ÖZEL AĞ ADRESLERİ DE YEREL SAYILIR. Başlangıçta yalnız localhost/127.0.0.1
 * vardı ve `vite --host` ile LAN üzerinden (örn. 192.168.1.5:5173) açan
 * geliştirici kendini SUNUM modunda buluyordu — tanı düğmeleri (nesne
 * ayırma, maske, tracker) kaybolmuş görünüyordu (Emre'nin bildirimi,
 * 2026-10-24). Telefondan yerel sunucuyu denemek de aynı duruma düşüyordu.
 *
 * Sınır dar tutulur: yalnız RFC1918 özel aralıkları ve mDNS `.local`.
 * `localhost.evil.com` gibi adresler yerel SAYILMAZ — verify bunu denetler.
 */
export function yerelHostMu(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (h.endsWith('.localhost') || h.endsWith('.local')) return true;
  // RFC1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * URL sorgusundan okur. `?sunum`, `?sunum=1`, `?sunum=true` açar;
 * `?sunum=0` ve `?sunum=false` KAPATIR (yanlışlıkla açık kalmasın diye açık
 * bir kapatma yolu var).
 *
 * ── AÇIK SEÇİM YOKSA: ADRES KARAR VERİR ──────────────────────────────────
 * Yayındaki sitede VARSAYILAN AÇIK, localhost'ta KAPALI.
 *
 * Sebep ölçüldü: çıplak adres açıldığında ekranda 52 düğme ve boş siyah
 * tuval vardı — yani bağlantıyı tıklayan kişi geliştirici enstrümanını
 * görüyordu. Bağlantıyı paylaşan kişinin `?sunum=1` eklemeyi hatırlamasına
 * güvenmek, unutulduğu anda ziyaretçiyi kaybetmek demek.
 *
 * Bu, `sidecarAcikMi`'nin deseninin aynısı: açık istek varsa o, yoksa adres.
 * Geliştiricinin akışı DEĞİŞMEZ — localhost'ta her şey eskisi gibi; yayında
 * tam arayüz gerekirse `?sunum=0`.
 *
 * `URLSearchParams` burada kullanılmaz: bu modül DOM'suz test edilebilsin
 * diye düz dize alır ve Node'da da aynı sonucu verir.
 */
export function sunumAcikMi(search: string, yerel = false): boolean {
  const q = search.startsWith('?') ? search.slice(1) : search;
  for (const parca of q.split('&')) {
    if (!parca) continue;
    const esit = parca.indexOf('=');
    const ad = decodeURIComponent(esit < 0 ? parca : parca.slice(0, esit));
    if (ad !== 'sunum') continue;
    if (esit < 0) return true; // çıplak `?sunum`
    const deger = decodeURIComponent(parca.slice(esit + 1)).toLowerCase();
    return deger !== '0' && deger !== 'false' && deger !== 'kapali';
  }
  return !yerel;
}

/**
 * SOĞUK AÇILIŞ — örnek sahne HER İKİ MODDA kendiliğinden yüklenir.
 *
 * Eskiden yalnız sunum modundaydı; gerekçe "normal modda boş tuval olur,
 * geliştirici ne yapacağını bilir" idi. İkİ ŞEY DEĞİŞTİ:
 *
 *  1. Boş tuval kimseye yaramıyordu. Çıplak adreste ekran siyahtı ve üstünde
 *     52 düğme duruyordu — geliştirici için de "önce bir şey yükle" adımı.
 *  2. Sahne artık BEDAVA. Derinliği analitik (`acilisSahnesi.ts`), model
 *     indirmiyor: ölçüldü, açılışta 131,4 MB → 0. Eskiden otomatik yükleme
 *     geliştirici moduna da 131 MB maliyet bindirirdi; şimdi bindirmiyor.
 *
 * Yalnız BİR KEZ ve yalnız motor hazırken tetiklenir; kullanıcı o sırada
 * kendi dosyasını seçtiyse (`kaynakVar`) sahne EZİLMEZ.
 */
export function soganAcilisGerekliMi(
  motorHazir: boolean, zatenTetiklendi: boolean, kaynakVar: boolean,
): boolean {
  return motorHazir && !zatenTetiklendi && !kaynakVar;
}

/**
 * Ölçüm satırı: eval duvarının yerine geçen TEK cümle. Sayılar saklanmaz —
 * tezin kanıtı onlar — ama tablo hâlinde değil.
 *
 * Eksik alan ATLANIR, uydurulmaz (künye kuralıyla aynı: `paylasim.ts`).
 * Hiçbir alan yoksa `null` döner ve satır hiç çizilmez.
 */
export function olcumSatiri(o: {
  kare?: number | null;
  splat?: number | null;
  psnr?: number | null;
  bilinmeyenOran?: number | null;
}): string | null {
  const p: string[] = [];
  if (typeof o.kare === 'number' && o.kare > 0) p.push(`${o.kare} kare`);
  if (typeof o.splat === 'number' && o.splat > 0) p.push(`${o.splat.toLocaleString('tr-TR')} Gaussian`);
  if (typeof o.psnr === 'number' && Number.isFinite(o.psnr)) p.push(`test PSNR ${o.psnr.toFixed(1)} dB`);
  // SINIR BEYANI en sonda ve her zaman son söz: ölçümün ne kadarının
  // ölçülemediğini söylemek bu projenin tezi.
  if (typeof o.bilinmeyenOran === 'number' && Number.isFinite(o.bilinmeyenOran)) {
    p.push(`hacmin %${Math.round(o.bilinmeyenOran * 100)}'ü görülmedi`);
  }
  return p.length ? p.join(' · ') : null;
}
