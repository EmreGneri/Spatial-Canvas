import { imzaMetni, imzaYerlesimi } from './ciktiImza';

/**
 * İMZAYI CANVAS'A ÇİZ — Z1. Yerleşim hesabı `ciktiImza.ts`'te (DOM'suz,
 * Node'dan doğrulanır); burada yalnız çizim var. İki çağıran paylaşır:
 * `ExportBar` (PNG/WebM) ve `Egitim3D` (3DGS paylaşım klibi).
 */
/**
 * Sağ alt köşeye küçük imza. Yazı boyutu kare yüksekliğine oranlı: 2x PNG'de
 * de, 640×420 kayıtta da aynı görünür büyüklükte kalır.
 */
export function imzaCiz(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const metin = imzaMetni(__APP_VERSION__);
  // Yazı tipi metriği yalnız tarayıcıda bilinir: ölçümü burada yapıp
  // yerleşimi saf modüle bırakıyoruz (ciktiImza.ts, Node'dan doğrulanır).
  const boy = imzaYerlesimi(w, h, 0).boy;
  ctx.save();
  ctx.font = `${boy}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  ctx.textBaseline = 'bottom';
  const y = imzaYerlesimi(w, h, ctx.measureText(metin).width);
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#000';
  ctx.fillRect(y.kutuX, y.kutuY, y.kutuW, y.kutuH);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = '#c8c8d4';
  ctx.fillText(metin, y.metinX, y.metinY);
  ctx.restore();
}

