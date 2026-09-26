import { useState, type CSSProperties, type ReactNode } from 'react';
import { bosluk, dugme, led, MONO, renk, SANS, yaricap, yazi } from './tema';

/**
 * TRANSPORT ŞERİDİ — sahnenin altındaki tek kumanda çubuğu.
 *
 * NEDEN: mod seçici, çıktı düğmeleri, "canlı fotoğraf" ve "düz video" sayfaya
 * dağılmış üç ayrı satırdaydı; hangi düğmenin sahneyi, hangisinin dosyayı
 * etkilediği okunmuyordu. Referans arayüzdeki gibi hepsi tek şeritte toplandı
 * ve ROL'e göre ayrıldı:
 *
 *   sol   — sahnenin durumu (oynat/duraklat, fps)
 *   orta  — ne çizildiği (render modu)
 *   sağ   — ne dışarı çıktığı (PNG · WebM · PLY)
 *
 * Şerit sayfanın altına YAPIŞIR (sticky): uzun sayfada kaydırırken kumanda
 * kaybolmasın. Sahnenin üstüne binmez, akışın parçasıdır.
 */
export function TransportSerit({
  engine,
  fps,
  mod,
  modlar,
  cikti,
  araclar,
  altSatir,
}: {
  engine: { setSuspended: (s: boolean) => void } | null;
  fps: number;
  /** Aktif render modunun adı — sol blokta durum olarak da görünür. */
  mod: string;
  /** Orta blok: mod seçici (ModeSelector). */
  modlar: ReactNode;
  /** Sağ blok: çıktı şeridi (ExportBar). */
  cikti: ReactNode;
  /** Sol bloğa eklenen sahne araçları (splat temizleme düğmesi gibi). */
  araclar?: ReactNode;
  /**
   * Şeridin ALTINA gelen tam genişlikte satır (3D eğitim ilerleme grafiği).
   * Şeridin İÇİNE değil ALTINA: grafik bir kumanda değil, DURUM — kumandaların
   * arasına girerse hangi düğmenin neyi yaptığı yine okunmaz olur.
   */
  altSatir?: ReactNode;
}) {
  const [durdu, setDurdu] = useState(false);

  function oynatDurdur() {
    if (!engine) return;
    const next = !durdu;
    setDurdu(next);
    engine.setSuspended(next);
  }

  return (
    <div style={serit}>
      <div style={blok}>
        <button
          type="button"
          onClick={oynatDurdur}
          disabled={!engine}
          title={durdu ? 'sahneyi sürdür' : 'sahneyi duraklat (GPU boşa çalışmaz)'}
          style={{ ...dugme(durdu), minWidth: 40, display: 'grid', placeItems: 'center' }}
        >
          {durdu ? '▶' : '❚❚'}
        </button>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={led(!durdu, durdu ? renk.uyari : renk.iyi)} />
          <span style={{ fontSize: yazi.kucuk, color: renk.metinSolgun }}>
            {durdu ? 'duraklatıldı' : mod}
          </span>
        </span>
        <span style={{ fontFamily: MONO, fontSize: yazi.kucuk, color: fps >= 30 ? renk.metinSolgun : renk.uyari }}>
          {durdu ? '—' : `${fps} fps`}
        </span>
        {araclar}
      </div>

      {/* `minWidth: 0` DENENDİ VE KALDIRILDI. Flex ona sıfıra kadar küçülme
          izni veriyordu: mod seçici 47 px'lik bir sütuna çöküp altı düğmeyi
          alt alta diziyor, şerit 432 px yüksekliğe çıkıyordu (ölçüldü).
          `1 1 auto` ile blok kendi içeriğinden dar olmaz; sığmazsa şeridin
          kendi `flexWrap`'i devreye girer ve blok BÜTÜN olarak alt satıra iner. */}
      <div style={{ ...blok, flex: '1 1 auto' }}>{modlar}</div>

      <div style={blok}>{cikti}</div>

      {altSatir && <div style={{ flexBasis: '100%', minWidth: 0 }}>{altSatir}</div>}
    </div>
  );
}

const serit: CSSProperties = {
  // Canvas'ın HEMEN ALTINDA, onunla aynı sütunda: kumanda kontrol ettiği
  // şeyin yanında durur. (Sticky denendi ve kaldırıldı — sayfa kayarken
  // kütüphanenin üstüne biniyordu.)
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: bosluk.m,
  width: '100%',
  boxSizing: 'border-box',
  padding: bosluk.s,
  fontFamily: SANS,
  // Şerit sahnenin üstünden geçerken okunur kalsın diye tek cam yüzey.
  background: 'rgba(18,21,28,0.86)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: renk.kenar,
  borderRadius: yaricap.panel,
  boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
};

const blok: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: bosluk.s,
  flexWrap: 'wrap',
};
