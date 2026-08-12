import { Engine } from './engine';
import { createPointCloudMaterial, POINTS_PARAMS } from './shaders/pointCloudMaterial';
import { createAsciiMaterial, ASCII_PARAMS } from './shaders/asciiMaterial';
import { createNeonWireMaterial, NEON_PARAMS } from './shaders/neonWireMaterial';
import { createDefaultGraph } from './engine/graph';
import type { Preset } from './engine/preset';

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
`;

class SpatialCanvasElement extends HTMLElement {
  private engine: Engine | null = null;
  private container: HTMLDivElement | null = null;
  private fallbackImg: HTMLImageElement | null = null;
  private observer: IntersectionObserver | null = null;
  private loaded = false;

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
    this.engine?.dispose();
    this.engine = null;
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
      // Materyalleri kaydet (embed'de UI yok ama preset modu uygulanabilir)
      this.engine.registerRenderMode('points', createPointCloudMaterial(), POINTS_PARAMS);
      this.engine.registerRenderMode('ascii', createAsciiMaterial(), ASCII_PARAMS);
      this.engine.registerRenderMode('neon', createNeonWireMaterial(), NEON_PARAMS);
      this.engine.setPointsMaterial(createPointCloudMaterial());
      this.engine.setGraph(createDefaultGraph());

      const src = this.getAttribute('src');
      if (src) await this.loadSource(src);

      const preset = this.getAttribute('preset');
      if (preset) this.applyPreset(preset);

      // GÜN 6 (URL): attribute yoksa URL paramları kullanılır.
      this.applyUrlParams();
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
