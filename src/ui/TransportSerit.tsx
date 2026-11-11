import { useState, type CSSProperties, type ReactNode } from 'react';
import { bosluk, dugme, led, MONO, renk, SANS, yazi } from './tema';

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
  maxWidth,
  fps,
  mod,
  modlar,
  cikti,
  ciktiKatlanir = false,
  desktop = false,
  advancedTools,
  araclar,
  altSatir,
}: {
  engine: { setSuspended: (s: boolean) => void } | null;
  maxWidth?: CSSProperties['maxWidth'];
  fps: number;
  /** Aktif render modunun adı — sol blokta durum olarak da görünür. */
  mod: string;
  /** Orta blok: mod seçici (ModeSelector). */
  modlar: ReactNode;
  /** Sağ blok: çıktı şeridi (ExportBar). */
  cikti: ReactNode;
  /**
   * Çıktı bloğunu TEK düğmenin arkasına katlar.
   *
   * NEDEN: PNG · WebM · 5/10/20sn · PLY · imza · AR = 8 kontrol, ilk
   * ekrandaki birincil kontrollerin 8/22'si. Hepsi KAPANIŞ vuruşuna ait;
   * ilk kez giren biri hiçbirine dokunmaz ama hepsini sayar. Katlanınca
   * sayı 8'den 1'e iner, eylem bir tık uzakta kalır.
   */
  ciktiKatlanir?: boolean;
  desktop?: boolean;
  advancedTools?: ReactNode;
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
  const [ciktiAcik, setCiktiAcik] = useState(false);

  function oynatDurdur() {
    if (!engine) return;
    const next = !durdu;
    setDurdu(next);
    engine.setSuspended(next);
  }

  return (
    <div className={desktop ? 'scene-footer' : undefined} style={desktop ? { fontFamily: SANS, gap: bosluk.s } : serit}>
      <div className={desktop ? 'scene-footer-controls' : undefined} style={desktop ? { ...serit, maxWidth, gap: bosluk.xs } : { display: 'contents' }}>
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
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
      </div>

      {desktop ? (
        <div className="scene-footer-tools">
          <details name="desktop-scene-tools" className="scene-hud-export">
            <summary>çıktı</summary>
            <div style={blok}>{cikti}</div>
          </details>
          {advancedTools}
        </div>
      ) : ciktiKatlanir && !ciktiAcik ? (
        <div style={blok}>
          <button
            type="button"
            style={dugme(false)}
            title="PNG · WebM · PLY · AR"
            aria-expanded={false}
            onClick={() => setCiktiAcik(true)}
          >
            ↓ çıktı
          </button>
        </div>
      ) : (
        <div style={blok}>{cikti}</div>
      )}

      {altSatir && <div className={desktop ? 'scene-footer-progress' : undefined} style={{ flexBasis: '100%', minWidth: 0 }}>{altSatir}</div>}
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
  // Kutu yok (üstteki kaynak satırı gibi): düğmeler doğrudan sahnenin üstünde
  // durur. İçeriği kadar geniş — boş kalan şerit sahne sürüklemesini kesmesin.
  width: 'fit-content',
  maxWidth: '100%',
  boxSizing: 'border-box',
  fontFamily: SANS,
};

const blok: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: bosluk.s,
  flexWrap: 'wrap',
};
