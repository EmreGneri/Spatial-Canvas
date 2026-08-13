import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  createHomeTexture,
  createImageColorTexture,
  createDepthTexture,
  fillImageColorTexture,
  fillPositionsFromDepth,
  POSITION_TEXTURE_SIZE,
} from './buffers';
import { createPointsCloud } from './points';
import { createSimulation, type SimulationUniforms } from './simulation';
import { createGrainPass, type GrainPass, type GrainPassUniforms } from '../shaders/grainPass';
import {
  createFeedbackPass,
  type FeedbackPass,
  type FeedbackPassUniforms,
  FEEDBACK_PARAMS,
} from '../shaders/feedbackPass';
import {
  createChromaticPass,
  type ChromaticPass,
  type ChromaticPassUniforms,
  CHROMATIC_PARAMS,
} from '../shaders/chromaticPass';
import {
  createFxaaPass,
  type FxaaPass,
} from '../shaders/fxaaPass';
import {
  createBloomPass,
  type BloomPass,
  type BloomPassUniforms,
  BLOOM_PARAMS,
} from '../shaders/bloomPass';
import { createLookUniforms, type LookUniforms, LOOK_PARAMS } from '../shaders/look';
import { SIM_PARAMS } from './simulation';
import { GRAIN_PARAMS } from '../shaders/grainPass';
import { applyParams, collectParams, type ParamDef, type ParamValues } from './params';
import { activeNodes, createDefaultGraph, topologicalOrder, validateGraph, type Graph } from './graph';
import {
  dilateAndFeatherMask,
  MASK_DILATE_RADIUS,
  resampleBilinear,
} from './reconstruction/silhouette.ts';
import { buildShellMesh, type ShellMeshData } from './reconstruction/mesh.ts';
import type { CameraPose, MediaType } from './preset';

const MAX_DPR = 2;

/**
 * Pass sÃ¶zleÅŸmesi (ARCHITECTURE.md): Engine pass iÃ§lerine dokunmaz; her pass
 * opsiyonel `update(time)` kancasÄ± sunar, Engine her karede Ã§aÄŸÄ±rÄ±r.
 */
export interface TickablePass {
  update?: (time: number) => void;
}

/**
 * Veri katmanÄ±nÄ±n Ã§ekirdeÄŸi (Emre). GÃ¼n 3: positionTexture artÄ±k DataTexture
 * deÄŸil â€” GPGPU simÃ¼lasyonunun ping-pong render target texture'Ä±. SimÃ¼lasyon
 * her karede konumlarÄ± shader'da hesaplar; render katmanÄ± aynÄ± ÅŸekilde
 * Ã¶rnekler (texture2D(uPositions, aUv)).
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly homeTexture: THREE.DataTexture;
  readonly points: THREE.Points;
  readonly simType: THREE.TextureDataType;
  /** Log iÃ§in: 'RGBA32F' | 'RGBA16F' */
  readonly simTextureLabel: string;

  /**
   * GÃ–RSEL RENK TEXTURE'U (Tur 11): fotoÄŸraf RGB'si, konumlarla aynÄ± grid
   * eÅŸlemesiyle (sampler.ts sampleImageGrid) buraya yazÄ±lÄ±r; render
   * shader'larÄ± uImageTexture adÄ±yla aUv'de okur â€” her parÃ§acÄ±k kendi
   * fotoÄŸraf pikselinin rengini taÅŸÄ±r. FotoÄŸraf yÃ¼klenene kadar null'dur;
   * material'lar uHasImage = 0 ile derinlik rampasÄ±na dÃ¼ÅŸer (kamera/video).
   */
  private imageColorTexture: THREE.DataTexture | null = null;
  /** setPhoto ile alÄ±nan fotoÄŸraf pikselleri (0..1, interleaved rgb) â€” CPU
   *  Ã¶rneklemesi iÃ§in saklanÄ±r; GPU tarafÄ± imageColorTexture'tÄ±r. */
  private photoData: Float32Array | null = null;
  private photoWidth = 0;
  private photoHeight = 0;

  /**
   * VÄ°DEO RENK DOKUSU (Tur 12): aktif video kaynaÄŸÄ± canlÄ± VideoTexture olarak
   * uImageTexture'a baÄŸlanÄ±r (GPU tarafÄ±, kare kare upload). Konum grid'i
   * luminanceHeightMap ile aynÄ± oranda Ã¶rneklediÄŸi iÃ§in aUv ile birebir
   * hizalÄ±dÄ±r. Video yokken null â€” fotoÄŸraf grid'i (imageColorTexture) geÃ§er.
   */
  private videoElement: HTMLVideoElement | null = null;
  private videoTexture: THREE.VideoTexture | null = null;

  /**
   * Nesne ayÄ±rma (Tur 12 â€” ÅŸikayet 4): AÃ‡IK iken shader'lar arka plan
   * parÃ§acÄ±klarÄ±nÄ± (w < 0.5) tamamen atar â€” ekranda beyaz kaÄŸÄ±t/perde kalmaz,
   * yalnÄ±zca bÃ¼st gÃ¶rÃ¼nÃ¼r. KAPALI iken tÃ¼m sahne Ã§izilir; arka plan
   * pikselleri parlayÄ±p Ã¶zneyi yutmasÄ±n diye karartÄ±lÄ±r (Ã—0.4).
   */
  private objectSeparation = false;
  /**
   * Renk modu (Tur 12 â€” ÅŸikayet 3): AÃ‡IK (varsayÄ±lan) â†’ parÃ§acÄ±k rengi
   * doÄŸrudan gÃ¶rselin RGB dokusundan; KAPALI â†’ dokular yok sayÄ±lÄ±r, renk
   * saÄŸ paneldeki Near/Far derinlik gradyanÄ±ndan tÃ¼retilir.
   */
  private useTextureColor = true;

  /** EXT_color_buffer_float tespiti â€” sim RT tÃ¼rÃ¼ buna gÃ¶re seÃ§ilir. */
  static readonly EXT_COLOR_BUFFER_FLOAT = 'EXT_color_buffer_float';

  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private pointsMaterial: THREE.Material;
  private currentDepthTexture: THREE.DataTexture | null = null;
  private composer: EffectComposer;
  private feedbackPass: FeedbackPass;
  private chromaticPass: ChromaticPass;
  private grainPass: GrainPass;
  /** GÃ¼n A: FXAA (parametresiz, her zaman aÃ§Ä±k) â€” anti-alias yokken pÄ±rÄ±ltÄ±yÄ± keser. */
  private fxaaPass: FxaaPass;
  /** GÃ¼n A: bloom sarmalayÄ±cÄ± â€” sÃ¶zlÃ¼ÄŸÃ¼ (BLOOM_PARAMS) iÃ§ parametrelere taÅŸÄ±r. */
  private bloomPass: BloomPass;
  /** GÃ¼n A: ACES tonemapping + exposure (zincirin son Ã§Ä±ktÄ±sÄ±). */
  private outputPass: OutputPass;
  /** GÃ¼n A: global look kÃ¶prÃ¼sÃ¼ (exposure + fog) â€” output dÃ¼ÄŸÃ¼mÃ¼nÃ¼n kollarÄ±. */
  private look: LookUniforms = createLookUniforms();
  private resizeObserver: ResizeObserver;
  private simulation: ReturnType<typeof createSimulation>;
  private raycaster = new THREE.Raycaster();
  private mousePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private mouseWorld = new THREE.Vector3();
  private ndc = new THREE.Vector2();

/** Ä°lk depth simÃ¼lasyonu tohumlar; sonrakiler yalnÄ±zca home'u tazeler. */
  private seeded = false;
  /**
   * Son setDepth'te kullanÄ±lan iÅŸlenmiÅŸ fg maskesi (Engine iÃ§i). Renk grid'i
   * de aynÄ± remap'i kurmalÄ± — setPhoto sonradan gelirse maskesiz remap
   * kurar ve renkler parÃ§acÄ±klardan kayar (GÃ¼n B).
   */
  private lastFgMask: Float32Array | null = null;
  private lastFrameTime = 0;
  private frameCount = 0;
  private lastFpsSample = 0;
  /** Her saniye gÃ¼ncellenir â€” FPS geÃ§idi (384 â†’ 256 kararÄ±) buna bakar. */
  fps = 0;

  /** Kaynak tÃ¼rÃ¼ (preset'e yalnÄ±zca bu yazÄ±lÄ±r; medyanÄ±n kendisi asla). */
  mediaType: MediaType = 'synthetic';

  /**
   * GÃœN 6 (video 3D â€” madde 4): video/kamera kaynaÄŸÄ± aktifken home depth'i
   * her karede deÄŸiÅŸir. Toptan yazÄ±lÄ±rsa yay parÃ§acÄ±ÄŸÄ± sÃ¼rekli dÃ¼rter
   * (atiyoloji kaybÄ± + titreme). Bu bayrak aÃ§Ä±kken fillPositionsFromDepth
   * blend ile yazÄ±lÄ±r (0.8) ve yay/Ã¶lÃ¼ bÃ¶lge videoya gÃ¶re gevÅŸetilir.
   * YalnÄ±zca startLuminanceLoop (canlÄ±) sÄ±rasÄ±nda true â€” fotoÄŸraf yolu deÄŸil.
   */
  dynamicHome = false;

  /** Graf = sahnenin tek doÄŸruluk kaynaÄŸÄ± (GÃ¼n 4). */
  private graph: Graph = createDefaultGraph();
  /** Aktif render modlarÄ±: ad â†’ { material, parametre tanÄ±mlarÄ± }. */
  private renderModes = new Map<string, { material: THREE.Material; params: ParamDef[] }>();
  private renderModeName = 'points';
  /**
   * GÃœN 7+8: 'feedback' graf dÃ¼ÄŸÃ¼mÃ¼ post-pass zincirinin tamamÄ±nÄ± yÃ¶netir â€”
   * feedback birikimi â†’ chromatic â†’ bloom â†’ grain/vignette, FXAA ile birlikte
   * (ARCHITECTURE.md Â· Pass Zinciri). Zincirdeki sabit sÄ±ra:
   *   RenderPass â†’ FXAA â†’ feedback â†’ chromatic â†’ bloom â†’ grain â†’ Output
   * Grain kapatÄ±lÄ±rken zincirdeki yeri not edilir â€” geri aÃ§Ä±lÄ±nca aynÄ± yere
   * dÃ¶ner; feedback/chromatic/bloom/fxaa her zaman composer'da durur,
   * enabled ile aÃ§Ä±lÄ±r/kapanÄ±r.
   */
  private postPassEnabled = true;
  /** Grain pass kapatÄ±lÄ±rken zincirdeki yeri â€” geri aÃ§Ä±lÄ±nca aynÄ± yere dÃ¶ner. */
  private grainPassIndex = 5;
/** Aktif material'Ä± Engine mi Ã¼retti? YalnÄ±zca Ã¶yleyse dispose eder. */
  private ownsPointsMaterial = true;
  /**
   * GÃœN B ('solid' modu): kapalÄ± kabuk mesh — buildShellMesh Ã§Ä±ktÄ±sÄ±nÄ±
   * BufferGeometry'ye taÅŸÄ±r; nokta bulutu solid modda gizlenir (fotoÄŸraf-only).
   */
  private solidMesh: THREE.Mesh | null = null;
  /** Solid modda Ã§izilebilir geometri var mÄ± (setShellGeometry verisi)? */
  private solidReady = false;
  /**
   * Solid seÃ§iliyken kabuk yoksa (fotoÄŸraf yÃ¼klenmemiÅŸ) nokta bulutunda
   * son SAÄLAM material kalÄ±r — solid shader uv/normal attribute'larÄ±
   * ister, points geometrisinde yoktur, takÄ±lÄ±rsa kÄ±rÄ±k render olur.
   * Kabuk kurulunca (setShellGeometry) solid material uygulanÄ±r.
   */
  private lastNonSolidMaterial: THREE.Material | null = null;

  /**
   * GÃœN 6 (opt): otomatik DPR dÃ¼ÅŸÃ¼rme. FPS sÃ¼rdÃ¼rÃ¼lebilir eÅŸiÄŸin (30) altÄ±na
   * dÃ¼ÅŸerse drawing buffer 384â†’256'ya iner (karede 2.25x daha az piksel);
   * tekrar 45+ olursa geri yÃ¼kselir. Histerezis: sÄ±k sÄ±k salÄ±nÄ±m yapmaz.
   * KullanÄ±cÄ± yÃ¼ksek DPR istiyorsa capsMaxDpr=1 vererek kapatabilir.
   */
  adaptiveDpr = true;
  private currentDpr = 0;
  private lowFpsCount = 0;
  private highFpsCount = 0;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.currentDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.renderer.setPixelRatio(this.currentDpr);
    container.appendChild(this.renderer.domElement);

    this.homeTexture = createHomeTexture();

    // Ã–n kontrol: float render target'sÄ±z GPGPU aÃ§Ä±lmaz. Yoksa 16 bit'e dÃ¼ÅŸ.
    // WebGL2'de EXT_color_buffer_float ikisini birden aÃ§ar; o yoksa half-float
    // iÃ§in ayrÄ± bir eklenti gerekir â€” ikisi de yoksa sessizce bozulmaz, baÄŸÄ±rÄ±r.
    const gl = this.renderer.getContext();
    const floatRenderable = gl.getExtension(Engine.EXT_COLOR_BUFFER_FLOAT) !== null;
    const halfRenderable =
      floatRenderable || gl.getExtension('EXT_color_buffer_half_float') !== null;
    if (!halfRenderable) {
      console.error('[engine] float render target desteÄŸi yok â€” GPGPU simÃ¼lasyonu Ã§alÄ±ÅŸmaz.');
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
    // GÃ¼n A (gÃ¶rÃ¼ntÃ¼ kalitesi): ACES sinematik ton eÄŸrisi + exposure. OutputPass
    // zincirin sonunda tonemapping + sRGB dÃ¶nÃ¼ÅŸÃ¼mÃ¼nÃ¼ uygular; exposure
    // lookUniforms'tan gelir (output dÃ¼ÄŸÃ¼mÃ¼ parametresi, renderer.toneMappingExposure).
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.look.uExposure.value;
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // GÃœN 7: Zeynep'in post-pass'leri zincire baÄŸlandÄ± â€” daha Ã¶nce dosyalar
    // hazÄ±rdÄ± ama composer'a hiÃ§ takÄ±lmamÄ±ÅŸtÄ± (gÃ¶rÃ¼nmez Ã¶zellikler). SÄ±ra
    // ARCHITECTURE.md Â· Pass Zinciri ile birebir: FXAA kaynak kareyi
    // yumuÅŸatÄ±r, feedback birikimi Ã¼zerine chromatic, bloom, en son grain.
    // ÃœÃ§Ã¼ de 'feedback' graf dÃ¼ÄŸÃ¼mÃ¼ tarafÄ±ndan aÃ§Ä±lÄ±r/kapanÄ±r (setGraph).
    this.fxaaPass = createFxaaPass();
    this.composer.addPass(this.fxaaPass);
    this.feedbackPass = createFeedbackPass();
    this.chromaticPass = createChromaticPass();
    this.composer.addPass(this.feedbackPass);
    this.composer.addPass(this.chromaticPass);
    this.bloomPass = createBloomPass();
    this.composer.addPass(this.bloomPass);
    this.grainPass = createGrainPass();
    this.composer.addPass(this.grainPass);
    // GÃ¼n A: zincir bÃ¼yÃ¼dÃ¼kÃ§e sabit indeks bozulur â€” grain'in yeri kurulum
    // anÄ±nda okunur, kapatÄ±ldÄ±ÄŸÄ±nda not edilir, geri aÃ§Ä±lÄ±nca oraya dÃ¶ner.
    this.grainPassIndex = this.composer.passes.indexOf(this.grainPass);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.setupMouse();

    this.renderer.setAnimationLoop((time) => {
      // SimÃ¼lasyon kare hÄ±zÄ±ndan baÄŸÄ±msÄ±z olsun: 60 fps'te 1. Sekme arka plana
      // dÃ¼ÅŸÃ¼p dÃ¶ndÃ¼ÄŸÃ¼nde dev bir dt gelir, kÄ±rpÄ±lmazsa bulut patlar.
      const dt = this.lastFrameTime ? (time - this.lastFrameTime) / 1000 : 1 / 60;
      this.lastFrameTime = time;
      this.simulation.uniforms.uDtScale.value = THREE.MathUtils.clamp(dt * 60, 0.5, 2);
      this.simulation.step();
      // Tur 12 (ÅŸikayet 1): video kaynaÄŸÄ± aktifken video dokusu her karede
      // GPU'ya taÅŸÄ±nÄ±r â€” yeni kare yÃ¼klendikÃ§e parÃ§acÄ±k renkleri canlÄ± kalÄ±r.
      if (this.videoTexture && this.videoElement) {
        this.videoTexture.needsUpdate = true;
      }
      // Okunan konum texture'Ä± her karede deÄŸiÅŸir (ping-pong) â€” render
      // katmanÄ±nÄ±n material'Ä±na push edilir (uPositions sÃ¶zleÅŸmesi).
      const uPositions = (this.pointsMaterial as THREE.ShaderMaterial).uniforms?.['uPositions'];
      if (uPositions) uPositions.value = this.simulation.positionTexture;
      this.pushLookUniforms();
      this.controls.update();
      this.tickPasses(time / 1000);
      this.composer.render();
      this.countFps();
    });
  }

  /**
   * Zincirin tamamını BİR kez, çağrıldığı anda çizer (simülasyonu ilerletmez).
   *
   * PNG export için: renderer `preserveDrawingBuffer` olmadan kurulu, yani
   * çizim tamponu tarayıcı kareyi kompozit ettikten sonra geçersizdir. Bir
   * tıklama işleyicisinden `toBlob` çağırmak son karenin ardından gelir ve
   * boş görüntü verir. Yakalamadan hemen önce, AYNI görevde bunu çağırmak
   * tamponu tazeler. Alternatif olan `preserveDrawingBuffer: true` her kare
   * için maliyet getirirdi; bu yalnızca export anında ödenir.
   */
  renderFrame() {
    const uPositions = (this.pointsMaterial as THREE.ShaderMaterial).uniforms?.['uPositions'];
    if (uPositions) uPositions.value = this.simulation.positionTexture;
    this.composer.render();
  }

  /**
   * GÃ¼n A: global look kÃ¶prÃ¼sÃ¼nÃ¼ (exposure + fog) her karede iÅŸler â€” kÃ¶prÃ¼
   * tek doÄŸruluk kaynaÄŸÄ±dÄ±r; UI/preset yalnÄ±zca ona yazar. Fog Ã¼Ã§ render
   * material'Ä±nda (points/ascii/neon) aynÄ± uniform adlarÄ±nÄ± kullanÄ±r.
   */
  private pushLookUniforms() {
const exposure = this.look.uExposure.value;
    if (this.renderer.toneMappingExposure !== exposure) {
      this.renderer.toneMappingExposure = exposure;
    }
    const fogDensity = this.look.uFogDensity.value;
    // Renk köprüde THREE.Color örneği olarak yaşar; material uniform'ları da
    // Color bekler. getHex() number döndürür ve uniform3fv onu çeviremez —
    // aynı örneği paylaşarak işlemek hem tip hem upload doğruluğu sağlar.
    const fogColor = this.look.uFogColor.value as THREE.Color;
    const targets: THREE.Material[] = [];
    for (const entry of this.renderModes.values()) targets.push(entry.material);
    targets.push(this.pointsMaterial);
    for (const material of targets) {
      const u = (material as THREE.ShaderMaterial).uniforms as Record<
        string,
        THREE.IUniform
      > | undefined;
      if (!u?.['uFogDensity']) continue;
      u['uFogDensity'].value = fogDensity;
      u['uFogColor'].value = fogColor;
    }
  }

  private tickPasses(time: number) {
    const passes = this.composer.passes as TickablePass[];
    for (const pass of passes) pass.update?.(time);
  }

  /**
   * Render modlarÄ± (Zeynep) kendi point cloud shader'Ä±nÄ± buraya takar.
   *
   * SAHÄ°PLÄ°K KURALI: Engine yalnÄ±zca KENDÄ° Ã¼rettiÄŸi yer tutucuyu dispose eder.
   * DÄ±ÅŸarÄ±dan gelen material'lar (App'te bir kez Ã¼retilip mod takasÄ±nda ileri
   * geri kullanÄ±lanlar) Ã§aÄŸÄ±ranÄ±n malÄ±dÄ±r. Aksi halde points â†’ ascii â†’ points
   * dizisinde her takas bir sonraki takasta gereken material'Ä± yok eder:
   * ASCII'nin dispose kancasÄ± karakter atlasÄ±nÄ± da bÄ±rakÄ±r, shader her
   * seferinde yeniden derlenir.
   */
setPointsMaterial(material: THREE.Material) {
    if (this.ownsPointsMaterial && this.pointsMaterial !== material) {
      this.pointsMaterial.dispose();
    }
    this.ownsPointsMaterial = false;
    // Registry'deki adÄ± yakala â€” ModeSelector doÄŸrudan takas edince de
    // renderMode gÃ¼ncel kalsÄ±n (toPreset bunu yazar).
    let name: string | null = null;
    for (const [n, entry] of this.renderModes) {
      if (entry.material === material) {
        name = n;
        break;
      }
    }
    if (name !== 'solid') this.lastNonSolidMaterial = material;
    if (name === 'solid' && !this.solidReady) {
      // FotoÄŸraf yok â†’ kabuk yok. Solid material'Ä± nokta bulutuna takmak
      // uv/normal attribute eksikliÄŸinden kÄ±rÄ±k render eder; material takasÄ±
      // YAPILMAZ, son saÄŸlam material'da kalÄ±nÄ±r (kabuk kurulunca uygulanÄ±r).
      this.renderModeName = 'solid';
      this.syncRenderVisibility();
      return;
    }
    this.pointsMaterial = material;
    this.points.material = material;
    // Tur 11: tek nokta bulutu, tek draw call â€” fg + bg aynÄ± uPositions
    // texture'Ä±nda (home) yaÅŸar; material takasÄ± yoktur.
    // Tur 12: yeni material'a tÃ¼m ortak render uniform'larÄ±nÄ± iÅŸle
    // (renk dokusu, nesne ayÄ±rma, renk modu).
    this.pushSharedUniforms(material);
    if (name) this.renderModeName = name;
    // GÃœN B: solid modu â†’ nokta bulutu gizlenir, kabuk mesh gÃ¶rÃ¼nÃ¼r.
    this.syncRenderVisibility();
  }

  /**
   * GÃœN B ('solid' modu): kabuk mesh geometrisini gÃ¼nceller — buildShellMesh
   * Ã§Ä±ktÄ±sÄ± (positions/uvs/indices). Veri yoksa (null) mesh boÅŸaltÄ±lÄ±r ve
   * nokta bulutu geri gelir. Normaller computeVertexNormals ile Ã¼retilir.
   */
  setShellGeometry(data: ShellMeshData | null) {
    if (!this.solidMesh) {
      this.solidMesh = new THREE.Mesh(
        new THREE.BufferGeometry(),
        this.pointsMaterial,
      );
      this.scene.add(this.solidMesh);
    }
    const old = this.solidMesh.geometry;
    const geometry = new THREE.BufferGeometry();
    if (data) {
      geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
      // GÜN C: normaller ve kabuk kimliği (aShell) mesh üreticisinden gelir.
      // computeVertexNormals KULLANILMAZ: front/back/duvar köşeleri paylaşıldığı
      // için ortalama normal siluet sınırında ön yüzü duvarla karıştırıyordu.
      geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
      geometry.setAttribute('aShell', new THREE.BufferAttribute(data.shell, 1));
      geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    }
    this.solidReady = Boolean(data && data.indices.length > 0);
    this.solidMesh.geometry = geometry;
    old.dispose();
    // GÃœN B: solid seÃ§iliyken kabuk HAZIR olunca material'Ä± uygula (bekleyen
    // fallback kapanÄ±r); kabuk bÄ±rakÄ±lÄ±nca (releasePhoto) son saÄŸlam
    // material'a geri dÃ¶n â€” solid shader nokta bulutunda kÄ±rÄ±k render eder.
    if (this.renderModeName === 'solid') {
      const solidMaterial = this.renderModes.get('solid')?.material;
      const fallback = this.lastNonSolidMaterial ?? this.renderModes.get('points')?.material;
      if (this.solidReady && solidMaterial && this.pointsMaterial !== solidMaterial) {
        this.pointsMaterial = solidMaterial;
        this.points.material = solidMaterial;
        this.pushSharedUniforms(solidMaterial);
      } else if (!this.solidReady && fallback && this.pointsMaterial !== fallback) {
        this.pointsMaterial = fallback;
        this.points.material = fallback;
      }
    }
    this.syncRenderVisibility();
  }

  /** GÃœN B: solid mod aktif + kabuk hazÄ±rsa bulut gizlenir, mesh gÃ¶rÃ¼nÃ¼r. */
  private syncRenderVisibility() {
    const solidActive = this.renderModeName === 'solid';
    this.points.visible = !(solidActive && this.solidReady);
    if (this.solidMesh) {
      this.solidMesh.visible = solidActive && this.solidReady;
      // Mesh ilk kurulumda o andaki material'a baÄŸlanÄ±r; fotoÄŸraf points
      // modunda yÃ¼klendiyse mesh yanlÄ±ÅŸ material'la kalÄ±r — solid aktifken
      // materiÄŸali her seferinde gÃ¼ncel material'a eÅŸitle.
      if (solidActive) this.solidMesh.material = this.pointsMaterial;
    }
  }

  /**
   * GÃœN 8: ModeSelector/ControlPanel takasÄ± artÄ±k graf'a yazÄ±lÄ±r â€” graf tek
   * doÄŸruluk kaynaÄŸÄ± kalÄ±r. Material takasÄ± yalnÄ±zca setPointsMaterial'Ä±n
   * iÅŸidir; bu Ã§aÄŸrÄ± yalnÄ±zca renderer dÃ¼ÄŸÃ¼mÃ¼nÃ¼n params.mode'unu gÃ¼nceller
   * (editÃ¶r, preset kaydÄ± ve sonraki setGraph aynÄ± deÄŸeri gÃ¶rÃ¼r). SÄ±ra:
   * Ã¶nce takas (setPointsMaterial), sonra bu Ã§aÄŸrÄ±.
   */
  selectRenderMode(mode: string) {
    const node = this.graph.nodes.find((n) => n.type === 'renderer');
    if (node) node.params = { ...node.params, mode };
  }

  /**
   * Kaynak-tÃ¼rÃ¼nden baÄŸÄ±msÄ±z ortak render uniform'larÄ±nÄ± bir material'a
   * iÅŸler: uImageTexture (fotoÄŸraf grid'i ya da video dokusu), uHasImage,
   * uObjectSeparation (nesne ayÄ±rma), uUseTextureColor (renk modu). Hepsi
   * Engine'in sahipliÄŸinde; UI/source deÄŸiÅŸimi buradan tek kapÄ±yla yayÄ±lÄ±r.
   */
  private pushSharedUniforms(material: THREE.Material) {
    const u = (material as THREE.ShaderMaterial).uniforms as Record<
      string,
      THREE.IUniform
    >;
    if (!u?.['uImageTexture']) return;
    const image = this.videoTexture ?? this.imageColorTexture;
    u['uImageTexture'].value = image;
    u['uHasImage'].value = image ? 1 : 0;
    if (u['uObjectSeparation']) {
      u['uObjectSeparation'].value = this.objectSeparation ? 1 : 0;
    }
    if (u['uUseTextureColor']) {
      u['uUseTextureColor'].value = this.useTextureColor ? 1 : 0;
    }
  }

  private pushSharedUniformsAll() {
    for (const entry of this.renderModes.values()) {
      this.pushSharedUniforms(entry.material);
    }
    this.pushSharedUniforms(this.pointsMaterial);
  }

  /** Nesne ayÄ±rma (Tur 12 â€” ÅŸikayet 4): shader'lara canlÄ± iÅŸlenir. */
  setObjectSeparation(on: boolean) {
    this.objectSeparation = on;
    this.pushSharedUniformsAll();
  }

  /**
   * Renk modu (Tur 12 â€” ÅŸikayet 3): AÃ‡IK â†’ gÃ¶rsel dokusu; KAPALI â†’ saÄŸ
   * paneldeki Near/Far derinlik gradyanÄ±. FotoÄŸraf/video yÃ¼klÃ¼ olup olmamasÄ±
   * fark etmeksizin her iki material'a canlÄ± iÅŸlenir.
   */
  setUseTextureColor(on: boolean) {
    this.useTextureColor = on;
    this.pushSharedUniformsAll();
  }

  /**
   * VÄ°DEO KAYNAÄI (Tur 12 â€” ÅŸikayet 1): videoyu canlÄ± VideoTexture olarak
   * uImageTexture'a baÄŸlar; eski fotoÄŸraf grid'ini ve eski video dokusunu
   * dispose eder (resim hayaleti kalmaz). null â†’ video dokusu bÄ±rakÄ±lÄ±r
   * (kamera kapatÄ±ldÄ± / kaynak deÄŸiÅŸti); fotoÄŸraf grid'i varsa onunla devam
   * edilir, yoksa uHasImage = 0 â†’ shader'lar derinlik rampasÄ±na dÃ¼ÅŸer.
   */
  setVideoSource(video: HTMLVideoElement | null) {
    if (video === this.videoElement) return;
    this.videoTexture?.dispose();
    this.videoTexture = null;
    this.videoElement = video;
    if (video) {
      // Yeni video geliyor â€” eski fotoÄŸraf pikselleri hayalet olarak kalmasÄ±n.
      this.releasePhoto();
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      this.videoTexture = tex;
    }
    this.pushSharedUniformsAll();
  }

  /**
   * FotoÄŸraf renk grid'ini GPU'dan TAMAMEN bÄ±rakÄ±r (Tur 12 â€” ÅŸikayet 1):
   * yeni kaynak gelmeden eski uImageTexture dispose edilir, bÃ¶ylece
   * resimâ†’video geÃ§iÅŸinde parÃ§acÄ±k renklerinde hayalet kalmaz. Video dokusu
   * varsa uHasImage yeniden 1 olur; yoksa derinlik rampasÄ±na dÃ¼ÅŸÃ¼lÃ¼r.
   */
releasePhoto() {
    this.imageColorTexture?.dispose();
    this.imageColorTexture = null;
    this.photoData = null;
    this.photoWidth = 0;
    this.photoHeight = 0;
    // GÃœN B: fotoÄŸraf bÄ±rakÄ±ldÄ± â†’ kabuk mesh gÃ¼ncel deÄŸil (video/boÅŸ
    // kaynak sÃ¶zleÅŸmesinde dÃ¶kÃ¼lÃ¼r; solid kaldÄ±ysa nokta bulutu geri dÃ¶ner).
    this.setShellGeometry(null);
    this.pushSharedUniformsAll();
  }

  /** Render modunu graf'a kaydeder: ad â†’ material + parametre tanÄ±mlarÄ±. */
  registerRenderMode(name: string, material: THREE.Material, params: ParamDef[]) {
    this.renderModes.set(name, { material, params });
    if (this.pointsMaterial === material) this.renderModeName = name;
  }

  /** Aktif render modunun adÄ± ('points' | 'ascii'). */
  get renderMode(): string {
    return this.renderModeName;
  }

  /** Solid modu gerçekten çizilebilir mi (kabuk mesh hazır)? UI bunu söyler. */
  get solidAvailable(): boolean {
    return this.solidReady;
  }


  /** Aktif modun gÃ¼ncel parametre DEÄERLERÄ° â€” preset serileÅŸtirmesi iÃ§in. */
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
   * GrafÄ± kurar (GÃ¼n 4). Aktiflik media'dan eriÅŸilebilirlikle belirlenir:
   * feedback dÃ¼ÄŸÃ¼mÃ¼nÃ¼n giriÅŸ kenarÄ± kesilirse post-pass zinciri (feedback â†’
   * chromatic â†’ grain/vignette) gerÃ§ekten kapanÄ±r. SÄ±ra: mod â†’ pass'ler â†’
   * parametreler.
   */
  setGraph(graph: Graph): { active: Set<string>; warnings: string[] } {
    const warnings: string[] = [];
    for (const problem of validateGraph(graph)) warnings.push(problem);
    this.graph = graph;
    const active = activeNodes(graph);
    if (active.size === 0) {
      warnings.push('graf media dÃ¼ÄŸÃ¼mÃ¼ iÃ§ermiyor â€” hiÃ§bir dÃ¼ÄŸÃ¼m aktif deÄŸil');
    }
    const order = topologicalOrder(graph);
    for (const id of order) {
      if (!active.has(id)) continue;
      const node = graph.nodes.find((n) => n.id === id);
      if (!node) continue;
      if (node.type === 'renderer') {
        const mode = String(node.params.mode ?? this.renderModeName);
        const entry = this.renderModes.get(mode);
        // AynÄ± material'Ä± TEKRAR takma: setPointsMaterial eskisini dispose
        // eder â€” ascii material atlas'Ä±nÄ± dispose kancasÄ±yla bÄ±raktÄ±ÄŸÄ± iÃ§in
        // kendi material'Ä±nÄ±n atlas'Ä± silinir, mod ekranda kaybolurdu.
if (entry && entry.material !== this.pointsMaterial) {
          this.setPointsMaterial(entry.material);
        } else if (entry) {
          this.renderModeName = mode;
          this.syncRenderVisibility();
        } else {
          warnings.push(`render modu bilinmiyor: '${mode}' (graf modu korunur)`);
        }
      }
    }
    const feedbackActive = graph.nodes.some((n) => n.type === 'feedback' && active.has(n.id));
    // GÃœN 7: feedback dÃ¼ÄŸÃ¼mÃ¼ post-pass zincirinin tamamÄ±nÄ± devreye alÄ±r/Ã§Ä±karÄ±r.
    // feedback + chromatic her zaman composer'da durur (enabled ile yÃ¶netilir);
    // grain ise insertPass/removePass ile eklenir/Ã§Ä±karÄ±lÄ±r (eski davranÄ±ÅŸ).
    // GÜN C: enabled artık pass'in kendi update kancasında hesaplanır
    // (zincir kolu VE parametrenin kimlik olmaması) — kapalı ayarda tam ekran
    // pass'leri hiç çizilmez. Engine yalnızca zincir kolunu söyler.
    this.feedbackPass.chainEnabled = feedbackActive;
    this.chromaticPass.chainEnabled = feedbackActive;
    // GÃ¼n A: FXAA + bloom da post-pass grubunun parÃ§asÄ± â€” kabloyu Ã§ekince
    // zincir bÃ¼tÃ¼nÃ¼yle kapanÄ±r (grain removePass ile, diÄŸerleri enabled ile).
    this.fxaaPass.enabled = feedbackActive;
    this.bloomPass.chainEnabled = feedbackActive;
    this.setPostPassEnabled(feedbackActive);
    for (const id of order) {
      if (!active.has(id)) continue;
      const node = graph.nodes.find((n) => n.id === id);
      if (!node) continue;
      if (node.type === 'particles') {
        applyParams(SIM_PARAMS, this.simUniforms, node.params);
      } else if (node.type === 'feedback') {
        // Post-pass zinciri: feedback â†’ chromatic â†’ bloom â†’ grain parametreleri
        // aynÄ± dÃ¼ÄŸÃ¼mde durur. applyParams bilinmeyen anahtarÄ± atlar â€” eski
        // preset'ler (yalnÄ±zca ilk Ã¼Ã§ listenin anahtarlarÄ±) olduÄŸu gibi Ã§alÄ±ÅŸÄ±r.
        applyParams(FEEDBACK_PARAMS, this.feedbackUniforms, node.params);
        applyParams(CHROMATIC_PARAMS, this.chromaticUniforms, node.params);
        applyParams(BLOOM_PARAMS, this.bloomUniforms, node.params);
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
    // Gün A sözleşmesi: output (global look) AKTİFLİK GEREKTİRMEZ — look
    // köprüsü canlıdır. Zincir kopsa da (feedback→output kenarı kesilse de)
    // editör değişikliği ve preset round-trip uygulanır; aksi halde kopuk
    // zincirde look kolları sessizce varsayılana dönerdi.
    const outputNode = graph.nodes.find((n) => n.type === 'output');
    if (outputNode) applyParams(LOOK_PARAMS, this.lookUniforms, outputNode.params);
    return { active, warnings };
  }

  get currentGraph(): Graph {
    return this.graph;
  }

  /** Kamera duruÅŸu â€” preset'e yazÄ±lÄ±r / preset'ten geri kurulur. */
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
      // geldiÄŸinde grain kapatÄ±lÄ±p aÃ§Ä±lÄ±nca sÄ±ranÄ±n sonuna dÃ¼ÅŸerdi; kapatÄ±rken
      // not edilen yere geri konuyor.
      this.composer.insertPass(this.grainPass, this.grainPassIndex);
    } else if (!enabled && index !== -1) {
      this.grainPassIndex = index;
      this.composer.removePass(this.grainPass);
    }
  }

  /** SimÃ¼lasyon uniform'larÄ± â€” UI/ayar iÃ§in (yay, sÃ¶nÃ¼m, fare kuvveti). */
  get simUniforms(): SimulationUniforms & Record<string, THREE.IUniform> {
    return this.simulation.uniforms as SimulationUniforms & Record<string, THREE.IUniform>;
  }

  /** Depth sÃ¶zleÅŸmesi: R32F, 0=uzak/1=yakÄ±n, satÄ±r 0 = Ã¼st. Flip yalnÄ±zca burada. */
  setDepth(
    data: Float32Array,
    width: number,
    height: number,
    foregroundMask?: Float32Array,
    maskWidth?: number,
    maskHeight?: number,
  ) {
    // Nesne maskesi (segmentation.ts) depth ile aynÄ± boyutta deÄŸilse (letterbox
    // yuvarlama farklarÄ±) depth boyutuna yeniden Ã¶rneklenir â€” siluet AND koÅŸulu
    // piksel-piksel hizalÄ± yÃ¼rÃ¼sÃ¼n.
    let mask: Float32Array | undefined;
    if (foregroundMask && maskWidth && maskHeight) {
      mask =
        maskWidth === width && maskHeight === height
          ? foregroundMask
          : resampleBilinear(foregroundMask, maskWidth, maskHeight, width, height);
      // Kenar gÃ¼vencesi: bilinear Ã¶lÃ§ekleme siluet kenarÄ±ndaki yumuÅŸak deÄŸerleri
      // (< 0.5) Ã¼retir; buildSilhouette'teki sert AND bu bandÄ± keserdi (Ã¶nceki
      // hata: "sadece orta seÃ§iliyor"). EÅŸiÄŸi gevÅŸetmeden (arka plan da sÄ±zardÄ±)
      // maske depth uzayÄ±nda HAFÄ°F dilate edilir â€” dar morf: kenar +1px geri
      // kazanÄ±lÄ±r, uzak arka plan (RMBG 0.0-0.1) hÃ¢lÃ¢ temiz kalÄ±r.
mask = dilateAndFeatherMask(
        mask,
        width,
        height,
        Math.round(MASK_DILATE_RADIUS * Math.max(1, maskWidth / width)),
      );
    }
    // GÃ¼n B: renk grid'inin remap'i konum grid'ininkiyle birebir aynÄ± olmalÄ±
    // (mask-aware); setPhoto sonradan gelirse buraya yazÄ±lan maske kullanÄ±lÄ±r.
    this.lastFgMask = mask ?? null;
    const current = this.currentDepthTexture;
    // CanlÄ± kamera saniyede ~10 kez Ã§aÄŸÄ±rÄ±r; boyut aynÄ±ysa texture'Ä± yeniden
    // ayÄ±rmak yerine yerinde gÃ¼ncelle (GPU tahsisi/dispose Ã§Ã¶pÃ¼ olmasÄ±n).
    if (current && current.image.width === width && current.image.height === height) {
      (current.image.data as Float32Array).set(data);
      current.needsUpdate = true;
    } else {
      current?.dispose();
      this.currentDepthTexture = createDepthTexture(data, width, height);
    }
    // Home'u depth'ten doldur. Tohumlama YALNIZCA ilk seferde: canlÄ± kamera
    // saniyede ~10 kez setDepth Ã§aÄŸÄ±rÄ±r, her seferinde tohumlanÄ±rsa konumlar
    // sÄ±fÄ±rlanÄ±r ve fareyle yapÄ±lan deformasyon sÃ¼rekli silinir.
    // GÃœN 6 (madde 4): video/kamera kaynaÄŸÄ±nda (dynamicHome) home %80 yeni
    // %20 eski ile yazÄ±lÄ±r â€” parÃ§acÄ±k ataleti korunur, titreme sÃ¶ner.
    fillPositionsFromDepth(this.homeTexture, data, width, height, {
      foregroundMask: mask,
      blend: this.dynamicHome ? 0.8 : 1,
    });
    // TUR 11: fotoÄŸraf yÃ¼klÃ¼yse parÃ§acÄ±k renklerini de aynÄ± grid/remap ile
    // doldur (setPhoto'dan Ã¶nce setDepth gelirse texture boÅŸ kalÄ±r â€” renkler
    // sonraki setDepth'te yazÄ±lÄ±r).
if (this.photoData) {
      fillImageColorTexture(
        this.imageColorTexture!,
        this.photoData,
        this.photoWidth,
        this.photoHeight,
data,
        width,
        height,
        { foregroundMask: this.lastFgMask ?? undefined },
      );
      // GÜN B ('solid' modu, fotoğraf-only): depth değiştiğinde kabuk mesh'i
      // yeniden kur — aynı siluet + remap + z formülleri (parçacık yüzeyi
      // hizası). Video/kamera yolu setPhoto çağırmaz → bu blok yalnızca
      // fotoğrafta çalışır, video yolunda mesh güncellenmez (ucuz kalır).
      this.setShellGeometry(
        buildShellMesh(data, width, height, {
          foregroundMask: this.lastFgMask ?? undefined,
        }),
      );
    }
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

  /** Last object mask in depth space (resampled + dilated) - diagnostic overlay. */
  get foregroundMask(): Float32Array | null {
    return this.lastFgMask;
  }

  /**
   * FotoÄŸrafÄ± (orijinal RGB) parÃ§acÄ±k renklerine baÄŸlar (Tur 11 â€” gÃ¶rev 1).
   * `setDepth`'ten Ã–NCE Ã§aÄŸrÄ±lÄ±r: pikseller CPU'da saklanÄ±r (renk grid'i
   * depth gelince aynÄ± remap ile doldurulur), RGBA8 grid texture'Ä±
   * uImageTexture olarak tÃ¼m kayÄ±tlÄ± render material'larÄ±na iÅŸlenir.
   * Tur 12 (ÅŸikayet 1): eski fotoÄŸraf grid'i Ã¶nce dispose edilir â€” yeni
   * gÃ¶rsel yÃ¼klendiÄŸinde GPU'da eski renk Ã¶nbelleÄŸi kalmaz.
   * Kamera/video yolu setPhoto Ã§aÄŸÄ±rmaz â†’ video dokusu yoksa uHasImage = 0,
   * shader'lar varsayÄ±lan derinlik rampasÄ±na dÃ¼ÅŸer.
   */
  setPhoto(source: HTMLCanvasElement | HTMLImageElement) {
    // Tur 12: eski renk Ã¶nbelleÄŸi tamamen temizlenir (hayalet yok).
    this.releasePhoto();
    const width = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
    const height = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0);
    const px = ctx.getImageData(0, 0, width, height).data;
    const rgb = new Float32Array(width * height * 3);
    for (let i = 0, k = 0; i < px.length; i += 4, k += 3) {
      rgb[k] = px[i] / 255;
      rgb[k + 1] = px[i + 1] / 255;
      rgb[k + 2] = px[i + 2] / 255;
    }
    this.photoData = rgb;
    this.photoWidth = width;
    this.photoHeight = height;
    this.imageColorTexture = createImageColorTexture();
    // FotoÄŸraf daha Ã¶nce depth'le geldiyse (setDepth â†’ setPhoto sÄ±rasÄ±) renk
    // grid'ini hemen doldur; yoksa bir sonraki setDepth Ã¼stlenir.
    if (this.currentDepthTexture) {
      const depth = this.currentDepthTexture.image.data as Float32Array;
      fillImageColorTexture(
        this.imageColorTexture,
        rgb,
        width,
        height,
depth,
        this.currentDepthTexture.image.width,
        this.currentDepthTexture.image.height,
        { foregroundMask: this.lastFgMask ?? undefined },
      );
    }
    // Ortak uniform'larÄ± tÃ¼m render modlarÄ±na iÅŸle (gelecekte takÄ±lacak
    // material'lar iÃ§in setPointsMaterial aynÄ± ÅŸeyi yapar).
    this.pushSharedUniformsAll();
  }

  /** Konum texture'Ä± â€” artÄ±k simÃ¼lasyonun ping-pong RT texture'Ä±. */
  get positionTexture(): THREE.Texture {
    return this.simulation.positionTexture;
  }

  /** UI grain/vignette uniform'larÄ±na buradan yazar; render dÃ¶ngÃ¼sÃ¼ne dokunmaz. */
  get grainUniforms(): GrainPassUniforms & Record<string, THREE.IUniform> {
    return this.grainPass.uniforms as GrainPassUniforms & Record<string, THREE.IUniform>;
  }

  /** UI feedback uniform'larÄ±na buradan yazar; render dÃ¶ngÃ¼sÃ¼ne dokunmaz. */
  get feedbackUniforms(): FeedbackPassUniforms & Record<string, THREE.IUniform> {
    return this.feedbackPass.uniforms as FeedbackPassUniforms & Record<string, THREE.IUniform>;
  }

  /** UI chromatic uniform'larÄ±na buradan yazar; render dÃ¶ngÃ¼sÃ¼ne dokunmaz. */
  get chromaticUniforms(): ChromaticPassUniforms & Record<string, THREE.IUniform> {
    return this.chromaticPass.uniforms as ChromaticPassUniforms & Record<string, THREE.IUniform>;
  }

  /** UI bloom uniform'larÄ±na buradan yazar; kancasÄ± iÃ§ parametrelere senkronlar. */
  get bloomUniforms(): BloomPassUniforms & Record<string, THREE.IUniform> {
    return this.bloomPass.uniforms as BloomPassUniforms & Record<string, THREE.IUniform>;
  }

/** Global look kÃ¶prÃ¼sÃ¼ (exposure + fog) â€” output dÃ¼ÄŸÃ¼mÃ¼nÃ¼n kollarÄ±. */
  get lookUniforms(): LookUniforms & Record<string, THREE.IUniform> {
    return this.look as LookUniforms & Record<string, THREE.IUniform>;
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
      sim.uniforms.uMouseActive.value = 0; // canvas dÄ±ÅŸÄ± â†’ kuvvet yok
    });
    dom.addEventListener('pointermove', (e) => {
      // Ä°mleÃ§ sayfa yÃ¼klendiÄŸinde zaten canvas Ã¼zerindeyse pointerenter gelmez.
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
      // GÃœN 6 (opt): otomatik Ã§Ã¶zÃ¼nÃ¼rlÃ¼k uyarlamasÄ± â€” histerezisli geÃ§it.
      this.adaptResolution();
    }
  }

  /**
   * FPS'ye gÃ¶re pixel ratio'yu dÃ¼ÅŸÃ¼r/yÃ¼kselt. Histerezis: 30 altÄ± 1 sn Ã¼st
   * Ã¼ste gÃ¶rÃ¼lÃ¼rse dÃ¼ÅŸÃ¼r (384â†’256 = 2.25x daha az piksel); 45 Ã¼stÃ¼ 2 sn
   * sÃ¼rerse geri yÃ¼kselt. SalÄ±nÄ±mÄ± Ã¶nler, dÃ¼ÅŸÃ¼k + yÃ¼ksek DPR cihazlarda
   * video yolunu akÄ±cÄ± tutar.
   */
  private adaptResolution() {
    if (!this.adaptiveDpr) return;
    const maxDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (this.fps > 0 && this.fps < 30) {
      this.lowFpsCount++;
      this.highFpsCount = 0;
      // Taban 1.0: altına inmek CSS pikselinin altında örneklemek demektir
      // (görünür bulanıklık). "Kaliteden ödün vermeden FPS" kuralı gereği
      // uyarlama yalnızca DPR > 1 fazlalığını geri alır.
      if (this.currentDpr > 1) {
        this.currentDpr = Math.max(1, this.currentDpr * 0.75);
        this.renderer.setPixelRatio(this.currentDpr);
        this.resize(); // drawing buffer + composer + grain uResolution
        this.lowFpsCount = 0;
        console.log(`[engine] DPR ${this.renderer.getPixelRatio().toFixed(2)} â€” dÃ¼ÅŸÃ¼k FPS (${this.fps})`);
      }
    } else if (this.fps >= 45) {
      this.highFpsCount++;
      this.lowFpsCount = 0;
      if (this.highFpsCount >= 2 && this.currentDpr < maxDpr) {
        this.currentDpr = Math.min(maxDpr, this.currentDpr / 0.75);
        this.renderer.setPixelRatio(this.currentDpr);
        this.resize();
        this.highFpsCount = 0;
        console.log(`[engine] DPR ${this.renderer.getPixelRatio().toFixed(2)} â€” toparlandÄ± (${this.fps})`);
      }
    }
    // Orta bölge (30..45): sayaçlar olduğu gibi kalır — salınım bastırılır.
  }

  private resize() {
    const width = this.renderer.domElement.parentElement?.clientWidth || 1;
    const height = this.renderer.domElement.parentElement?.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // updateStyle aÃ§Ä±k: DPR > 1'de canvas'Ä±n CSS boyutu yazÄ±lmazsa Ã§izim tamponu
    // kadar (Ã¶r. 1280Ã—840) yer kaplar ve konteynerden taÅŸar.
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    // Grain piksel Ã¶lÃ§eÄŸi drawing buffer'Ä± izler (DPR dahil).
    this.renderer.getDrawingBufferSize(this.grainPass.uniforms.uResolution.value);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    // Post-pass devre dÄ±ÅŸÄ±yken composer'da deÄŸildir; composer.dispose() onu
    // gÃ¶rmez, GPU kaynaÄŸÄ± bÄ±rakÄ±lmaz. Tek seferlik kurum gereÄŸi iki yol da.
    if (this.composer.passes.indexOf(this.grainPass) === -1) this.grainPass.dispose();
    this.composer.dispose(); // pass'lerin render target'larÄ± â€” yoksa remount'ta GPU sÄ±zÄ±ntÄ±sÄ±
    // Feedback kendi ping-pong RT'lerini + quad'larÄ±nÄ± taÅŸÄ±r (composer'Ä±n
    // iki RT'si bunlar deÄŸildir) â€” elle bÄ±rakÄ±lÄ±r. Chromatic de ShaderPass
    // material'Ä±nÄ± kendine Ã¶zel dispose eder.
    this.feedbackPass.dispose();
    this.chromaticPass.dispose();
    // GÃ¼n A: bloom kendi mip RT zincirini taÅŸÄ±r â€” elle bÄ±rakÄ±lÄ±r. FXAA ve
    // OutputPass ShaderPass tÃ¼rÃ¼dÃ¼r, material'larÄ±nÄ± composer dispose ya da
    // kendi dispose'larÄ± bÄ±rakÄ±r (iki kez Ã§aÄŸÄ±rmak gÃ¼venli).
    this.bloomPass.dispose();
    this.fxaaPass.dispose();
    this.outputPass.dispose();
    this.currentDepthTexture?.dispose();
    this.homeTexture.dispose();
    this.imageColorTexture?.dispose();
    this.videoTexture?.dispose();
this.simulation.dispose();
    this.points.geometry.dispose();
    this.solidMesh?.geometry.dispose();
    if (this.solidMesh) this.scene.remove(this.solidMesh);
    // KayÄ±tlÄ± material'lar Ã§aÄŸÄ±ranÄ±n malÄ± (App useMemo ile Ã¼retir ve bÄ±rakÄ±r);
    // burada dispose edilirse React StrictMode'un Ã§ift mount'unda ikinci
    // engine Ã¶lÃ¼ material'la aÃ§Ä±lÄ±r.
    if (this.ownsPointsMaterial) this.pointsMaterial.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

