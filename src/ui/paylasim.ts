/**
 * PAYLAŞIM KÜNYESİ — Z1'in ikinci yarısı (3DGS sonucunu paylaşılabilir
 * kılmak). DOM'suz: `scripts/verify-paylasim.mjs` doğrular.
 *
 * ── "TEK LİNK" NEDEN YOK ──────────────────────────────────────────────────
 * Yol haritası "3DGS sonucunu tek linkle paylaşma" istiyor. Link, sonucu
 * BARINDIRMAK demektir: 11 MB'lık `.ply` + görüntüleyici, kullanıcının
 * videosundan türemiş veri, bir sunucuda. Proje ücretsiz ve YEREL kalma
 * kararında (README) — bu kararı arayüz tek başına bozamaz.
 *
 * Bu yüzden akış "paylaşılabilir DOSYA + künye" olarak kuruldu: dönen kısa
 * klip (WebM, imzalı) doğrudan sosyal mecraya yüklenebilir, `.ply` harici
 * görüntüleyicide (SuperSplat) açılır, künye de sonucun nasıl üretildiğini
 * yanında taşır. Barındırma kararı verilirse künye aynen link açıklaması
 * olur.
 */

export interface KunyeGirdi {
  surum: string;
  dosyaAdi: string;
  splats: number | null;
  /** Ayrılmış karelerde ölçülen PSNR (dB). */
  psnr: number | null;
  gpu: string | null;
  sureSn: number | null;
  /** Yalnız özne modu açıkken eğitildi mi. */
  yalnizOzne: boolean;
}

/**
 * Tek satırlık künye. Eksik alan UYDURULMAZ, atlanır — ölçülmeyen değeri
 * yazmak projenin dürüstlük kuralına aykırı.
 */
export function kunyeMetni(g: KunyeGirdi): string {
  const parcalar: string[] = [`spatial-canvas v${g.surum}`, `3D Gaussian Splatting · ${g.dosyaAdi}`];
  if (g.splats !== null) parcalar.push(`${g.splats.toLocaleString('tr-TR')} Gaussian`);
  if (g.psnr !== null) parcalar.push(`ayrılmış kare PSNR ${g.psnr.toFixed(1)} dB${g.yalnizOzne ? ' (yalnız özne)' : ''}`);
  if (g.sureSn !== null) parcalar.push(`${Math.round(g.sureSn)} sn eğitim`);
  if (g.gpu) parcalar.push(g.gpu);
  return parcalar.join(' · ');
}

/** Paylaşım klibinin uzunluğu (sn) ve tam turu tamamlayan dönüş hızı. */
export const PAYLASIM_KLIP_SN = 8;

/**
 * Klip TAM BİR TUR dönsün: başı ve sonu aynı kadraj olduğu için döngüye
 * alındığında sıçrama görünmez (sosyal mecralar kısa klipleri döngüler).
 *
 * Dönüş ZAMANA bağlanır (rad/saniye), kare sayısına DEĞİL. Kare başına sabit
 * açı denendi ve ölçüldü: 60 fps varsayımıyla hesaplanan adım, sekme
 * yavaşlayınca turu tamamlamıyordu (8 sn hedeflenen klip 5,96 sn'lik kadar
 * döndü). Açı `dt` ile çarpılınca kare hızı ne olursa olsun tur kapanır.
 */
export function turHizi(sureSn = PAYLASIM_KLIP_SN): number {
  return (2 * Math.PI) / sureSn;
}

/**
 * Kaydın başından beri geçen süreye karşılık gelen TOPLAM açı (0..2π).
 *
 * Kare başına artış (`hız · dt`) ölçüldü ve yetmedi: sekme yavaşlayınca dt
 * büyüyor, ama sıçrayan kamerayı engelleyen `dt` sınırı (0,1 sn) fazlalığı
 * kırpıyor ve tur kapanmıyordu (ölçüm: klip başı ile sonu arasındaki piksel
 * farkı 87, yarım turdaki fark 59 — yani son kare başa dönmemişti).
 *
 * Mutlak açı bunu yapısal olarak çözer: kaç kare düşerse düşsün, süre dolduğu
 * anda toplam açı tam 2π olur; `min` de fazla dönmeyi keser.
 */
export function turAcisi(gecenSn: number, sureSn = PAYLASIM_KLIP_SN): number {
  if (!(gecenSn > 0)) return 0;
  return Math.min(2 * Math.PI, turHizi(sureSn) * gecenSn);
}
