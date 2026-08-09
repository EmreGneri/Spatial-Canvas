import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import {
  createDepthTexture,
  createHomeTexture,
  fillPositionsFromDepth,
  POSITION_TEXTURE_SIZE,
} from './buffers';
import { createPointsCloud } from './points';
import { createSimulation, type SimulationUniforms } from './simulation';
import { createGrainPass, type GrainPass, type GrainPassUniforms } from '../shaders/grainPass';

const MAX_DPR = 2;

/**
 * Pass sözleşmesi (ARCHITECTURE.md): Engine pass içlerine dokunmaz; her pass
 * opsiyonel `update(time)` kancası sunar, Engine her karede çağırır.
 */
export interface TickablePass {
  update?: (time: number) => void;
}

/**
 * Veri katmanının çekirdeği (Emre). Gün 3: positionTexture artık DataTexture
 * değil — GPGPU simülasyonunun ping-pong render target texture'ı. Simülasyon
 * her karede konumları shader'da hesaplar; render katmanı aynı şekilde
 * örnekler (texture2D(uPositions, aUv)).
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly homeTexture: THREE.DataTexture;
  readonly points: THREE.Points;
  readonly simType: THREE.TextureDataType;
  /** Log için: 'RGBA32F' | 'RGBA16F' */
  readonly simTextureLabel: string;

  /** EXT_color_buffer_float tespiti — sim RT türü buna göre seçilir. */
  static readonly EXT_COLOR_BUFFER_FLOAT = 'EXT_color_buffer_float';

  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private pointsMaterial: THREE.Material;
  private currentDepthTexture: THREE.DataTexture | null = null;
  private composer: EffectComposer;
  private grainPass: GrainPass;
  private resizeObserver: ResizeObserver;
  private simulation: ReturnType<typeof createSimulation>;
  private raycaster = new THREE.Raycaster();
  private mousePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private mouseWorld = new THREE.Vector3();
  private ndc = new THREE.Vector2();

  /** İlk depth simülasyonu tohumlar; sonrakiler yalnızca home'u tazeler. */
  private seeded = false;
  private lastFrameTime = 0;
  private frameCount = 0;
  private lastFpsSample = 0;
  /** Her saniye güncellenir — FPS geçidi (384 → 256 kararı) buna bakar. */
  fps = 0;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    container.appendChild(this.renderer.domElement);

    this.homeTexture = createHomeTexture();

    // Ön kontrol: float render target'sız GPGPU açılmaz. Yoksa 16 bit'e düş.
    // WebGL2'de EXT_color_buffer_float ikisini birden açar; o yoksa half-float
    // için ayrı bir eklenti gerekir — ikisi de yoksa sessizce bozulmaz, bağırır.
    const gl = this.renderer.getContext();
    const floatRenderable = gl.getExtension(Engine.EXT_COLOR_BUFFER_FLOAT) !== null;
    const halfRenderable =
      floatRenderable || gl.getExtension('EXT_color_buffer_half_float') !== null;
    if (!halfRenderable) {
      console.error('[engine] float render target desteği yok — GPGPU simülasyonu çalışmaz.');
    }
    this.simType = floatRenderable ? THREE.FloatType : THREE.HalfFloatType;
    this.simTextureLabel = floatRenderable ? 'RGBA32F' : 'RGBA16F';

    this.simulation = createSimulation(this.renderer, this.simType);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    this.camera.position.set(0, 0, 3.5);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 15;

    this.points = createPointsCloud(this.simulation.positionTexture);
    this.pointsMaterial = this.points.material as THREE.Material;
    this.scene.add(this.points);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.grainPass = createGrainPass();
    this.composer.addPass(this.grainPass);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.setupMouse();

    this.renderer.setAnimationLoop((time) => {
      // Simülasyon kare hızından bağımsız olsun: 60 fps'te 1. Sekme arka plana
      // düşüp döndüğünde dev bir dt gelir, kırpılmazsa bulut patlar.
      const dt = this.lastFrameTime ? (time - this.lastFrameTime) / 1000 : 1 / 60;
      this.lastFrameTime = time;
      this.simulation.uniforms.uDtScale.value = THREE.MathUtils.clamp(dt * 60, 0.5, 2);
      this.simulation.step();
      // Okunan konum texture'ı her karede değişir (ping-pong) — render
      // katmanının material'ına push edilir (uPositions sözleşmesi).
      const uPositions = (this.pointsMaterial as THREE.ShaderMaterial).uniforms?.['uPositions'];
      if (uPositions) uPositions.value = this.simulation.positionTexture;
      this.controls.update();
      this.tickPasses(time / 1000);
      this.composer.render();
      this.countFps();
    });
  }

  private tickPasses(time: number) {
    const passes = this.composer.passes as TickablePass[];
    for (const pass of passes) pass.update?.(time);
  }

  /** Render modları (Zeynep) kendi point cloud shader'ını buraya takar. */
  setPointsMaterial(material: THREE.Material) {
    this.pointsMaterial.dispose();
    this.pointsMaterial = material;
    this.points.material = material;
  }

  /** Simülasyon uniform'ları — UI/ayar için (yay, sönüm, fare kuvveti). */
  get simUniforms(): SimulationUniforms {
    return this.simulation.uniforms;
  }

  /** Depth sözleşmesi: R32F, 0=uzak/1=yakın, satır 0 = üst. Flip yalnızca burada. */
  setDepth(data: Float32Array, width: number, height: number) {
    const current = this.currentDepthTexture;
    // Canlı kamera saniyede ~10 kez çağırır; boyut aynıysa texture'ı yeniden
    // ayırmak yerine yerinde güncelle (GPU tahsisi/dispose çöpü olmasın).
    if (current && current.image.width === width && current.image.height === height) {
      (current.image.data as Float32Array).set(data);
      current.needsUpdate = true;
    } else {
      current?.dispose();
      this.currentDepthTexture = createDepthTexture(data, width, height);
    }
    // Home'u depth'ten doldur. Tohumlama YALNIZCA ilk seferde: canlı kamera
    // saniyede ~10 kez setDepth çağırır, her seferinde tohumlanırsa konumlar
    // sıfırlanır ve fareyle yapılan deformasyon sürekli silinir.
    fillPositionsFromDepth(this.homeTexture, data, width, height);
    if (this.seeded) {
      this.simulation.setHome(this.homeTexture);
    } else {
      this.simulation.seedFrom(this.homeTexture);
      this.seeded = true;
    }
  }

  /** Renderers read the normalized R32F depth map through this contract. */
  get depthTexture(): THREE.DataTexture | null {
    return this.currentDepthTexture;
  }

  /** Konum texture'ı — artık simülasyonun ping-pong RT texture'ı. */
  get positionTexture(): THREE.Texture {
    return this.simulation.positionTexture;
  }

  /** UI grain/vignette uniform'larına buradan yazar; render döngüsüne dokunmaz. */
  get grainUniforms(): GrainPassUniforms {
    return this.grainPass.uniforms;
  }

  get positionCount() {
    return POSITION_TEXTURE_SIZE * POSITION_TEXTURE_SIZE;
  }

  private setupMouse() {
    const dom = this.renderer.domElement;
    const sim = this.simulation;
    dom.addEventListener('pointerenter', () => {
      sim.uniforms.uMouseActive.value = 1;
    });
    dom.addEventListener('pointerleave', () => {
      sim.uniforms.uMouseActive.value = 0; // canvas dışı → kuvvet yok
    });
    dom.addEventListener('pointermove', (e) => {
      // İmleç sayfa yüklendiğinde zaten canvas üzerindeyse pointerenter gelmez.
      sim.uniforms.uMouseActive.value = 1;
      const rect = dom.getBoundingClientRect();
      this.ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.raycaster.setFromCamera(this.ndc, this.camera);
      if (this.raycaster.ray.intersectPlane(this.mousePlane, this.mouseWorld)) {
        sim.uniforms.uMouseWorld.value.set(this.mouseWorld.x, this.mouseWorld.y);
      }
    });
  }

  private countFps() {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsSample >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsSample));
      this.frameCount = 0;
      this.lastFpsSample = now;
    }
  }

  private resize() {
    const width = this.renderer.domElement.parentElement?.clientWidth || 1;
    const height = this.renderer.domElement.parentElement?.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // updateStyle açık: DPR > 1'de canvas'ın CSS boyutu yazılmazsa çizim tamponu
    // kadar (ör. 1280×840) yer kaplar ve konteynerden taşar.
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    // Grain piksel ölçeği drawing buffer'ı izler (DPR dahil).
    this.renderer.getDrawingBufferSize(this.grainPass.uniforms.uResolution.value);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.composer.dispose(); // pass'lerin render target'ları — yoksa remount'ta GPU sızıntısı
    this.currentDepthTexture?.dispose();
    this.homeTexture.dispose();
    this.simulation.dispose();
    this.points.geometry.dispose();
    this.pointsMaterial.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
