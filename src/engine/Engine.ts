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
import { SIM_PARAMS } from './simulation';
import { GRAIN_PARAMS } from '../shaders/grainPass';
import { applyParams, collectParams, type ParamDef, type ParamValues } from './params';
import { activeNodes, createDefaultGraph, topologicalOrder, validateGraph, type Graph } from './graph';
import type { CameraPose, MediaType } from './preset';

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

  /** Kaynak türü (preset'e yalnızca bu yazılır; medyanın kendisi asla). */
  mediaType: MediaType = 'synthetic';

  /** Graf = sahnenin tek doğruluk kaynağı (Gün 4). */
  private graph: Graph = createDefaultGraph();
  /** Aktif render modları: ad → { material, parametre tanımları }. */
  private renderModes = new Map<string, { material: THREE.Material; params: ParamDef[] }>();
  private renderModeName = 'points';
  /** Feedback düğümü aktifken true — grain pass'in composer'daki varlığı. */
  private postPassEnabled = true;
  /** Grain pass kapatılırken zincirdeki yeri — geri açılınca aynı yere döner. */
  private grainPassIndex = 1;
  /** Aktif material'ı Engine mi üretti? Yalnızca öyleyse dispose eder. */
  private ownsPointsMaterial = true;

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

  /**
   * Render modları (Zeynep) kendi point cloud shader'ını buraya takar.
   *
   * SAHİPLİK KURALI: Engine yalnızca KENDİ ürettiği yer tutucuyu dispose eder.
   * Dışarıdan gelen material'lar (App'te bir kez üretilip mod takasında ileri
   * geri kullanılanlar) çağıranın malıdır. Aksi halde points → ascii → points
   * dizisinde her takas bir sonraki takasta gereken material'ı yok eder:
   * ASCII'nin dispose kancası karakter atlasını da bırakır, shader her
   * seferinde yeniden derlenir.
   */
  setPointsMaterial(material: THREE.Material) {
    if (this.ownsPointsMaterial && this.pointsMaterial !== material) {
      this.pointsMaterial.dispose();
    }
    this.ownsPointsMaterial = false;
    this.pointsMaterial = material;
    this.points.material = material;
    // Registry'deki adı yakala — ModeSelector doğrudan takas edince de
    // renderMode güncel kalsın (toPreset bunu yazar).
    for (const [name, entry] of this.renderModes) {
      if (entry.material === material) {
        this.renderModeName = name;
        break;
      }
    }
  }

  /** Render modunu graf'a kaydeder: ad → material + parametre tanımları. */
  registerRenderMode(name: string, material: THREE.Material, params: ParamDef[]) {
    this.renderModes.set(name, { material, params });
    if (this.pointsMaterial === material) this.renderModeName = name;
  }

  /** Aktif render modunun adı ('points' | 'ascii'). */
  get renderMode(): string {
    return this.renderModeName;
  }

  /** Aktif modun güncel parametre DEĞERLERİ — preset serileştirmesi için. */
  activeRenderParams(): ParamValues {
    const entry = this.renderModes.get(this.renderModeName);
    if (!entry) return {};
    const uniforms = (entry.material as THREE.ShaderMaterial).uniforms as Record<
      string,
      THREE.IUniform
    >;
    return collectParams(entry.params, uniforms);
  }

  /**
   * Grafı kurar (Gün 4). Aktiflik media'dan erişilebilirlikle belirlenir:
   * feedback düğümünün giriş kenarı kesilirse post-pass composer'dan çıkar
   * (grain/vignette gerçekten kaybolur). Sıra: mod → pass'ler → parametreler.
   */
  setGraph(graph: Graph): { active: Set<string>; warnings: string[] } {
    const warnings: string[] = [];
    for (const problem of validateGraph(graph)) warnings.push(problem);
    this.graph = graph;
    const active = activeNodes(graph);
    if (active.size === 0) {
      warnings.push('graf media düğümü içermiyor — hiçbir düğüm aktif değil');
    }
    const order = topologicalOrder(graph);
    for (const id of order) {
      if (!active.has(id)) continue;
      const node = graph.nodes.find((n) => n.id === id);
      if (!node) continue;
      if (node.type === 'renderer') {
        const mode = String(node.params.mode ?? this.renderModeName);
        const entry = this.renderModes.get(mode);
        if (entry) this.setPointsMaterial(entry.material);
        else warnings.push(`render modu bilinmiyor: '${mode}' (graf modu korunur)`);
      }
    }
    const feedbackActive = graph.nodes.some((n) => n.type === 'feedback' && active.has(n.id));
    this.setPostPassEnabled(feedbackActive);
    for (const id of order) {
      if (!active.has(id)) continue;
      const node = graph.nodes.find((n) => n.id === id);
      if (!node) continue;
      if (node.type === 'particles') {
        applyParams(SIM_PARAMS, this.simUniforms, node.params);
      } else if (node.type === 'feedback') {
        applyParams(GRAIN_PARAMS, this.grainUniforms, node.params);
      } else if (node.type === 'renderer') {
        const entry = this.renderModes.get(this.renderModeName);
        if (entry) {
          const uniforms = (entry.material as THREE.ShaderMaterial).uniforms as Record<
            string,
            THREE.IUniform
          >;
          applyParams(entry.params, uniforms, node.params);
        }
      }
    }
    return { active, warnings };
  }

  get currentGraph(): Graph {
    return this.graph;
  }

  /** Kamera duruşu — preset'e yazılır / preset'ten geri kurulur. */
  getCameraPose(): CameraPose {
    const p = this.camera.position;
    const t = this.controls.target;
    return {
      position: [p.x, p.y, p.z],
      target: [t.x, t.y, t.z],
    };
  }

  setCameraPose(pose: CameraPose) {
    this.camera.position.set(...pose.position);
    this.controls.target.set(...pose.target);
  }

  private setPostPassEnabled(enabled: boolean) {
    if (enabled === this.postPassEnabled) return;
    this.postPassEnabled = enabled;
    const index = this.composer.passes.indexOf(this.grainPass);
    if (enabled && index === -1) {
      // addPass zincirin SONUNA ekler. Zeynep'in feedback/chroma/neon pass'leri
      // geldiğinde grain kapatılıp açılınca sıranın sonuna düşerdi; kapatırken
      // not edilen yere geri konuyor.
      this.composer.insertPass(this.grainPass, this.grainPassIndex);
    } else if (!enabled && index !== -1) {
      this.grainPassIndex = index;
      this.composer.removePass(this.grainPass);
    }
  }

  /** Simülasyon uniform'ları — UI/ayar için (yay, sönüm, fare kuvveti). */
  get simUniforms(): SimulationUniforms & Record<string, THREE.IUniform> {
    return this.simulation.uniforms as SimulationUniforms & Record<string, THREE.IUniform>;
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
  get grainUniforms(): GrainPassUniforms & Record<string, THREE.IUniform> {
    return this.grainPass.uniforms as GrainPassUniforms & Record<string, THREE.IUniform>;
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
    // Post-pass devre dışıyken composer'da değildir; composer.dispose() onu
    // görmez, GPU kaynağı bırakılmaz. Tek seferlik kurum gereği iki yol da.
    if (this.composer.passes.indexOf(this.grainPass) === -1) this.grainPass.dispose();
    this.composer.dispose(); // pass'lerin render target'ları — yoksa remount'ta GPU sızıntısı
    this.currentDepthTexture?.dispose();
    this.homeTexture.dispose();
    this.simulation.dispose();
    this.points.geometry.dispose();
    // Kayıtlı material'lar çağıranın malı (App useMemo ile üretir ve bırakır);
    // burada dispose edilirse React StrictMode'un çift mount'unda ikinci
    // engine ölü material'la açılır.
    if (this.ownsPointsMaterial) this.pointsMaterial.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
