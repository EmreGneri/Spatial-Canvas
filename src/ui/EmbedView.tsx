import { useEffect, useRef, useState } from 'react';
import { Engine } from '../engine';
import { createPointCloudMaterial, POINTS_PARAMS } from '../shaders/pointCloudMaterial';
import { createAsciiMaterial, ASCII_PARAMS } from '../shaders/asciiMaterial';
import { createNeonWireMaterial, NEON_PARAMS } from '../shaders/neonWireMaterial';
import { createSolidMaterial, SOLID_PARAMS } from '../shaders/solidMaterial';
import { createSplatMaterial, SPLAT_PARAMS } from '../shaders/splatMaterial';
import { applyRenderState, type RenderState } from '../shaders/renderPreset';
import { EMBED_CHROME_CSS, SIGNATURE_TEXT } from './embedChrome';
import type { RenderMode } from './ModeSelector';

/**
 * GÖMÜLÜ GÖRÜNÜM — yalnızca sahne. Sahiplik: Zeynep.
 *
 * ControlPanel / ModeSelector / ForceControls / log — hiçbiri mount edilmez.
 * Etkileşim Engine'in kendi kancalarından gelir: hover'da kuvvet, sürükle-
 * döndür (OrbitControls). Bunlar canvas üzerindedir, DOM elemanı gerektirmez.
 *
 * `src/embed.ts`'teki <spatial-canvas> ile aynı görünümü paylaşır (imza,
 * iskelet) — ortak tanım `embedChrome.ts`'te; o dosya React'siz olduğu için
 * custom element'in bundle'ına React sızmaz.
 */

export function EmbedView({
  mode = 'points',
  preset,
  hoverForce = 0.35,
  className,
  style,
}: {
  /** Açılış render modu. */
  mode?: RenderMode;
  /** Uygulanacak render preset'i (opsiyonel). */
  preset?: RenderState;
  /**
   * 0..1 — hover kuvvetinin şiddeti. Gömülü kullanımda varsayılan olarak
   * kısılır: sayfa içinde küçük bir kutu, tam şiddet parçacıkları dağıtıyor.
   */
  hoverForce?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const engine = new Engine(container);
    const materials = {
      points: createPointCloudMaterial(),
      ascii: createAsciiMaterial(),
      neon: createNeonWireMaterial(),
      // Gün B: dördüncü mod. Kabuk yalnızca fotoğrafta kurulur; kabuk yokken
      // Engine solid material'ı takmaz, son sağlam material'da kalır.
      solid: createSolidMaterial(),
      // Gün D: 5. mod. Kendi çizim nesnesi vardır; GaussianBuffer boşken
      // Engine görünürlüğü kapatır ve nokta bulutunda kalınır.
      splat: createSplatMaterial(),
    };
    engine.registerRenderMode('points', materials.points, POINTS_PARAMS);
    engine.registerRenderMode('ascii', materials.ascii, ASCII_PARAMS);
    engine.registerRenderMode('neon', materials.neon, NEON_PARAMS);
    engine.registerRenderMode('solid', materials.solid, SOLID_PARAMS);
    engine.registerRenderMode('splat', materials.splat, SPLAT_PARAMS);
    engine.setPointsMaterial(materials[mode]);

    if (preset) {
      applyRenderState(
        {
          mode,
          points: materials.points,
          ascii: materials.ascii,
          neon: materials.neon,
          solid: materials.solid,
          splat: materials.splat,
          grain: engine.grainUniforms,
        },
        preset,
      );
    }

    // Hover kuvveti Engine'de kurulu; burada yalnızca şiddeti kısılır.
    engine.simUniforms.uForceStrength.value *= hoverForce;

    // İskeleti ilk KARE çizilene kadar tut. Engine hazır olması yetmez —
    // depth gelene kadar sahne boştur, iskeleti erken kaldırmak siyah bir
    // boşluk gösterirdi. fps > 0 ilk karenin çizildiğinin kanıtı.
    const t = window.setInterval(() => {
      if (engine.fps > 0) {
        setReady(true);
        clearInterval(t);
      }
    }, 200);

    return () => {
      clearInterval(t);
      engine.dispose();
      materials.points.dispose();
      materials.ascii.dispose();
      materials.neon.dispose();
      materials.solid.dispose();
      setReady(false);
    };
    // mode/preset açılış değerleridir; değişimlerinde motoru yeniden kurmak
    // yerine sahibi yeni bir EmbedView mount etmelidir (key ile).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
      <style>{EMBED_CHROME_CSS}</style>
      <div ref={containerRef} className="sc-embed-root" />
      {!ready && <div className="sc-embed-skeleton" />}
      <span className="sc-embed-signature" aria-hidden="true">
        {SIGNATURE_TEXT}
      </span>
    </div>
  );
}
