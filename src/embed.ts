import type * as THREE from 'three';
import { Engine } from './engine';
import { createPointCloudMaterial, POINTS_PARAMS } from './shaders/pointCloudMaterial';
import { createAsciiMaterial, ASCII_PARAMS } from './shaders/asciiMaterial';
import { createNeonWireMaterial, NEON_PARAMS } from './shaders/neonWireMaterial';
import { createDefaultGraph } from './engine/graph';
import type { Preset } from './engine/preset';
import {
  createSignatureElement,
  createSkeletonElement,
  EMBED_CHROME_CSS,
} from './ui/embedChrome';

/**
 * EMBED MODU (Gün 6 — Emre).
 *
 * <spatial-canvas> custom element: aynı bundle, mode=embed bayrağı.
 * UI mount edilmez; depth modeli yalnızca preset istiyorsa lazy yüklenir.
 * WebGL yoksa statik görsel fallback'e düşer.
 *
 * Kullanım:
 *   <spatial-canvas src="photo.jpg" preset="..." mode="points"></spatial-canvas>
 *   <script type="module" src="/embed.js"></script>
 */

declare global {
  interface Window {
    SpatialCanvas?: typeof SpatialCanvasElement;
  }
}

const EMBED_STYLES = `
  :host { display: block; width: 100%; height: 100%; min-height: 300px; }
  .container { width: 100%; height: 100%; position: relative; }
  .fallback { width: 100%; height: 100%; object-fit: cover; display: none; }
  .error { color: #c66; font: 12px monospace; padding: 8px; }
${EMBED_CHROME_CSS}
`;

class SpatialCanvasElement extends HTMLElement {
  private engine: Engine | null = null;
  private container: HTMLDivElement | null = null;
  private fallbackImg: HTMLImageElement | null = null;
  private observer: IntersectionObserver | null = null;
  private loaded = false;
  private skeleton: HTMLElement | null = null;
  private skeletonTimer = 0;
  /** Render modu material'ları — burada üretilir, burada bırakılır. */
  private materials: {
    points: THREE.Material;
    ascii: THREE.Material;
    neon: THREE.Material;
  } | null = null;

  static get observedAttributes() {
    return ['src', 'preset', 'mode', 'width', 'height'];
  }

  connectedCallback() {
    if (this.loaded) return;
    this.loaded = true;
    this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = EMBED_STYLES;
    this.shadowRoot!.appendChild(style);
    this.container = document.createElement('div');
    this.container.className = 'container';
    this.shadowRoot!.appendChild(this.container);
    this.fallbackImg = document.createElement('img');
    this.fallbackImg.className = 'fallback';
    this.fallbackImg.alt = 'spatial-canvas fallback';
    this.container.appendChild(this.fallbackImg);

    // Gömülü görünüm: yüklenirken siyah boşluk yerine nefes alan iskelet, ve
    // köşede küçük saydam imza. Tanım EmbedView ile ortak (ui/embedChrome).
    this.container.classList.add('sc-embed-root');
    this.skeleton = createSkeletonElement(document);
    this.container.appendChild(this.skeleton);
    this.container.appendChild(createSignatureElement(document));

    // WebGL yoksa fallback'e düş
    if (!this.checkWebGL()) {
      this.showFallback('WebGL desteklenmiyor');
      return;
    }

    // Lazy load: görünür olana kadar bekle
    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              this.observer?.disconnect();
              this.initEngine();
              break;
            }
          }
        },
        { rootMargin: '100px' },
      );
      this.observer.observe(this);
    } else {
      this.initEngine();
    }
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    clearInterval(this.skeletonTimer);
    this.engine?.dispose();
    this.engine = null;
    // Engine yalnızca kendi yer tutucusunu bırakır; bunlar bizim.
    if (this.materials) {
      this.materials.points.dispose();
      this.materials.ascii.dispose();
      this.materials.neon.dispose();
      this.materials = null;
    }
  }

  /** İlk kare çizildiyse iskeleti kaldırır ve yoklamayı durdurur. */
  private hideSkeletonWhenDrawn() {
    if (!this.engine || this.engine.fps <= 0) return;
    clearInterval(this.skeletonTimer);
    this.skeleton?.remove();
    this.skeleton = null;
  }

  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null) {
    if (oldVal === newVal) return;
    if (name === 'src' && this.engine) {
      this.loadSource(newVal);
    }
    if (name === 'preset' && this.engine) {
      this.applyPreset(newVal);
    }
  }

  private checkWebGL(): boolean {
    try {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch {
      return false;
    }
  }

  private showFallback(msg: string) {
    if (this.fallbackImg) {
      this.fallbackImg.style.display = 'block';
      const src = this.getAttribute('src');
      if (src) this.fallbackImg.src = src;
    }
    const err = document.createElement('div');
    err.className = 'error';
    err.textContent = msg;
    this.shadowRoot?.appendChild(err);
  }

  private async initEngine() {
    if (!this.container) return;
    try {
      this.engine = new Engine(this.container);
      // Materyalleri kaydet (embed'de UI yok ama preset modu uygulanabilir).
      // Aktif material KAYITLI OLANIN AYNISI olmalı: ayrı bir
      // createPointCloudMaterial() çağrısı dördüncü bir instance üretir,
      // preset 'points' moduna geçtiğinde kayıtlı olana takas edilir ve
      // fazladan üretilen hiç bırakılmadan GPU'da kalırdı.
      this.materials = {
        points: createPointCloudMaterial(),
        ascii: createAsciiMaterial(),
        neon: createNeonWireMaterial(),
      };
      this.engine.registerRenderMode('points', this.materials.points, POINTS_PARAMS);
      this.engine.registerRenderMode('ascii', this.materials.ascii, ASCII_PARAMS);
      this.engine.registerRenderMode('neon', this.materials.neon, NEON_PARAMS);
      this.engine.setPointsMaterial(this.materials.points);
      this.engine.setGraph(createDefaultGraph());

      const src = this.getAttribute('src');
      if (src) await this.loadSource(src);

      const preset = this.getAttribute('preset');
      if (preset) this.applyPreset(preset);

      // GÜN 6 (URL): attribute yoksa URL paramları kullanılır.
      this.applyUrlParams();

      // İskelet ilk KARE çizilene kadar durur. Engine'in kurulmuş olması
      // yetmez: depth gelene kadar sahne boştur, iskeleti erken kaldırmak
      // siyah bir boşluk gösterirdi. fps > 0 ilk karenin kanıtı.
      this.skeletonTimer = window.setInterval(() => this.hideSkeletonWhenDrawn(), 200);
    } catch (err) {
      this.showFallback(err instanceof Error ? err.message : 'Engine başlatılamadı');
    }
  }

  private async loadSource(src: string | null) {
    if (!src || !this.engine) return;
    try {
      const img = await loadImage(src);
      // Depth modeli lazy: yalnızca fotoğraf varsa yüklenir
      const { estimateDepth } = await import('./depth');
      const depth = await estimateDepth(img);
      this.engine.setPhoto(img);
      this.engine.setDepth(depth.data, depth.width, depth.height);
    } catch (err) {
      this.showFallback(`Görsel yüklenemedi: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * GÜN 6 (URL): attribute'ları çevre URL'inden gelir — <spatial-canvas
   * src="..."> yerine aynı sayfa farklı URL. src boşsa kullanmaz.
   */
  private applyUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const src = params.get('src');
    if (src && !this.getAttribute('src')) {
      this.setAttribute('src', src);
      if (this.engine) this.loadSource(src);
    }
    const preset = params.get('preset');
    if (preset && !this.getAttribute('preset')) {
      this.applyPreset(preset);
    }
  }

  private applyPreset(presetJson: string | null) {
    if (!presetJson || !this.engine) return;
    try {
      const preset = JSON.parse(presetJson) as Preset;
      // Preset uygulama: graf + kamera + parametreler
      this.engine.setGraph(preset.graph);
      this.engine.setCameraPose(preset.camera);
    } catch (err) {
      console.error('[spatial-canvas] preset parse hatası:', err);
    }
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Custom element kaydı — aynı bundle'dan tekrar çağrılırsa atla
if (!customElements.get('spatial-canvas')) {
  customElements.define('spatial-canvas', SpatialCanvasElement);
}

export { SpatialCanvasElement };
