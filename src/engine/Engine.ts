import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import {
  createDepthTexture,
  createPositionTexture,
  fillPositionsFromDepth,
  POSITION_TEXTURE_SIZE,
} from './buffers';
import { createPointsCloud } from './points';
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
 * Veri katmanının çekirdeği (Emre). Gün 2: sahne = positionTexture'dan konum
 * okuyan point cloud + perspektif kamera + OrbitControls. Render modları ve
 * pass'ler Zeynep'in katmanıdır; material `setPointsMaterial` ile değişir.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly positionTexture: THREE.DataTexture;
  readonly points: THREE.Points;

  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private pointsMaterial: THREE.Material;
  private currentDepthTexture: THREE.DataTexture | null = null;
  private composer: EffectComposer;
  private grainPass: GrainPass;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    container.appendChild(this.renderer.domElement);

    this.positionTexture = createPositionTexture();

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    this.camera.position.set(0, 0, 3.5);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 15;

    this.points = createPointsCloud(this.positionTexture);
    this.pointsMaterial = this.points.material as THREE.Material;
    this.scene.add(this.points);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.grainPass = createGrainPass();
    this.composer.addPass(this.grainPass);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.renderer.setAnimationLoop((time) => {
      this.controls.update();
      this.tickPasses(time / 1000);
      this.composer.render();
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
    fillPositionsFromDepth(this.positionTexture, data, width, height);
  }

  /** Renderers read the normalized R32F depth map through this contract. */
  get depthTexture(): THREE.DataTexture | null {
    return this.currentDepthTexture;
  }

  /** UI grain/vignette uniform'larına buradan yazar; render döngüsüne dokunmaz. */
  get grainUniforms(): GrainPassUniforms {
    return this.grainPass.uniforms;
  }

  get positionCount() {
    return POSITION_TEXTURE_SIZE * POSITION_TEXTURE_SIZE;
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
    this.positionTexture.dispose();
    this.points.geometry.dispose();
    this.pointsMaterial.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
