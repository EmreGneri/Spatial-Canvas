/**
 * GÖMÜLÜ MOD GÖRÜNÜMÜ — ortak parçalar. Sahiplik: Zeynep.
 *
 * İki tüketici var ve biri React değil:
 *   · `src/ui/EmbedView.tsx`  — React uygulaması içinde gömülü görünüm
 *   · `src/embed.ts`          — <spatial-canvas> custom element (Shadow DOM)
 *
 * Custom element ayrı bir rollup girişi ve İÇİNDE REACT YOK (vite.config
 * input.embed). Görünümü React bileşeninden almak React'i o bundle'a sokardı,
 * bu yüzden imza + iskelet burada framework'süz tanımlanır; iki taraf da
 * aynı CSS'i ve aynı ölçüleri kullanır, görünüm ayrışmaz.
 */

/** İmza: köşede çok küçük, saydam, tıklamayı engellemeyen. */
export const SIGNATURE_TEXT = 'spatial-canvas';
export const SIGNATURE_FONT_SIZE = 10;
export const SIGNATURE_OPACITY = 0.3;

/**
 * Yüklenirken siyah boşluk yerine nefes alan bir iskelet. Renkler sahnenin
 * kendi koyu paletinden; parlak bir flash yerine hafif bir nabız.
 */
export const EMBED_CHROME_CSS = /* css */ `
  .sc-embed-root {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #000;
  }
  .sc-embed-signature {
    position: absolute;
    right: 8px;
    bottom: 6px;
    margin: 0;
    font: ${SIGNATURE_FONT_SIZE}px/1 ui-monospace, "Cascadia Mono", Consolas, monospace;
    letter-spacing: 0.02em;
    color: #fff;
    opacity: ${SIGNATURE_OPACITY};
    /* Fare olaylarını yutmaz: hover kuvveti ve orbit imzanın üstünde de çalışır. */
    pointer-events: none;
    user-select: none;
  }
  .sc-embed-skeleton {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(180deg, #0d0d12 0%, #08080b 100%);
    animation: sc-embed-pulse 1.6s ease-in-out infinite;
  }
  @keyframes sc-embed-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.55; }
  }
  /* Hareketi azalt tercihi: nabız durur, düz zemin kalır. */
  @media (prefers-reduced-motion: reduce) {
    .sc-embed-skeleton { animation: none; }
  }
`;

/** Custom element (React yok) için: imza düğümü. */
export function createSignatureElement(doc: Document = document): HTMLElement {
  const el = doc.createElement('span');
  el.className = 'sc-embed-signature';
  el.textContent = SIGNATURE_TEXT;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** Custom element (React yok) için: iskelet düğümü. */
export function createSkeletonElement(doc: Document = document): HTMLElement {
  const el = doc.createElement('div');
  el.className = 'sc-embed-skeleton';
  el.setAttribute('aria-hidden', 'true');
  return el;
}
