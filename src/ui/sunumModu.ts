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
 * URL sorgusundan okur. `?sunum`, `?sunum=1`, `?sunum=true` açar;
 * `?sunum=0` ve `?sunum=false` KAPATIR (yanlışlıkla açık kalmasın diye açık
 * bir kapatma yolu var).
 *
 * `URLSearchParams` burada kullanılmaz: bu modül DOM'suz test edilebilsin
 * diye düz dize alır ve Node'da da aynı sonucu verir.
 */
export function sunumAcikMi(search: string): boolean {
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
  return false;
}

/**
 * SOĞUK AÇILIŞ — sunum modunda sahne KENDİLİĞİNDEN yüklenir.
 *
 * Normal modda açılış boş siyah tuval: geliştirici ne yapacağını bilir.
 * Sunumda ise ilk iki saniye en pahalı saniyelerdir; izleyici bir şey
 * dönerken dinlemeye başlar, boş ekrana bakarken "bozuk mu?" diye düşünür.
 *
 * Yalnız BİR KEZ ve yalnız motor hazırken tetiklenir; kullanıcı o sırada
 * kendi dosyasını seçtiyse (`kaynakVar`) sahne EZİLMEZ.
 */
export function soganAcilisGerekliMi(
  sunum: boolean, motorHazir: boolean, zatenTetiklendi: boolean, kaynakVar: boolean,
): boolean {
  return sunum && motorHazir && !zatenTetiklendi && !kaynakVar;
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
