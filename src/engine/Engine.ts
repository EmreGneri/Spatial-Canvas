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
import { SplatObject, fillGaussiansFromPointCloud, uploadGaussianData } from './splats';
import type { GaussianBufferData } from '../shaders/splatFixture';
import type { SplatSortMode } from '../shaders/splatSort';
import { createTrajectoryOverlay, type TrajectoryOverlay } from '../shaders/trajectoryOverlay';
import type { PoseTrackRecord } from './vision/types';
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
import { resampleBilinear } from './reconstruction/silhouette.ts';
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
   * GÜN D/render şeridi — 5. render modu 'splat'. Nesne YALNIZCA mod
   * kaydedilince (registerRenderMode('splat', …)) kurulur: splat kaydedilmemiş
   * bir kurulumda (embed) üç 384² texture + 147k instance boşuna ayrılmasın.
   */
  private splatObject: SplatObject | null = null;
  /** CPU sıralama yolu (radix = tam, bucket = yaklaşık). SPLAT_PARAMS dışı kol. */
  private splatSortModeName: SplatSortMode = 'radix';
  /** Sıralama kapısı: bu opaklığın altındaki splat hiç çizilmez. */
  private splatMinOpacity = 0.02;
  /** Viewport (px) — splat Jacobian'ının piksel ölçeği. resize yazar. */
  private viewportPx = new THREE.Vector2(1, 1);

  /** GÜN 5 — keyframe frustum'ları + yörünge çizgisi (poz varsa kurulur). */
  private trajectoryOverlay: TrajectoryOverlay | null = null;
  private poseTrack: PoseTrackRecord[] = [];
  private trajectoryVisible = true;
  /** D.4 timeline seçimi (null = tüm keyframe'ler). */
  private selectedKeyframe: number | null = null;

  /**
   * GÜN 3 — crystal'ın SPLAT varyantı. Kabuk mesh'i yalnız fotoğraf yolunda
   * kurulur; video → 3B sonucu splat bulutudur. Crystal modu seçiliyken
   * kabuk YOKSA bu material splat nesnesine takılır, böylece mod her iki
   * kaynakta da çizer. Knob'lar ORTAK (uniform nesneleri paylaşılıyor).
   */
  private crystalSplatMaterial: THREE.Material | null = null;

  /**
   * SIFIRLAMA — "başlangıç noktası" anlık görüntüleri.
   * Efektlerle oynadıktan sonra (ya da yeni bir görsele geçerken) kullanıcı
   * başlangıca dönemiyordu: graf sıfırlaması yalnız düğümleri geri alıyor,
   * material/pass uniform'larına dokunmuyordu. Burada kayıt/kurulum anındaki
   * GERÇEK değerler saklanır; ParamDef.default'tan türetmek renk kollarını
   * bozardı (kind: 'color' için default sayıdır).
   */
  private paramDefaults = new Map<string, ParamValues>();
  private passDefaults: {
    grain: ParamValues;
    feedback: ParamValues;
    chromatic: ParamValues;
    bloom: ParamValues;
    look: ParamValues;
    sim: ParamValues;
  } | null = null;
  /** Kamera başlangıç pozu (kurulumdaki konum + hedef). */
  private cameraHome = {
    pos: new THREE.Vector3(0, 0, 3.5),
    target: new THREE.Vector3(0, 0, 0),
  };

  /**
   * "Canlı fotoğraf" paralaks sway (viral sprint, hızlı prototip — ParamDef
   * yok, preset'e kaydolmaz). Sway AÇILDIĞI ANDAKI kamera pozunun etrafında
   * salınır (cameraHome'a SIFIRLAMAZ — kullanıcının manuel çevirdiği kare
   * korunur). `swayBasePos/Target` yoksa sway kapalıdır (tek doğruluk kaynağı).
   */
  private swayEnabled = false;
  private swayBasePos: THREE.Vector3 | null = null;
  private swayBaseTarget: THREE.Vector3 | null = null;
  private swayTime = 0;
  private swayAmplitudeDeg = 4;
  private swaySpeed = 1;
  /** OrbitControls sürüklerken sway duraklar — elle kontrolle çakışmasın. */
  private userInteracting = false;

  /** Çizim sonrası kanca (tracker HUD). Bkz. `setFrameTap`. */
  private frameTap: ((view: HTMLCanvasElement) => void) | null = null;

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
    // Sway: sürüklerken duraklat, bırakınca YENİ pozdan devam et (eski poza
    // sıçramasın) — kullanıcının kadrajı sway'e teslim edilmez.
    this.controls.addEventListener('start', () => {
      this.userInteracting = true;
    });
    this.controls.addEventListener('end', () => {
      this.userInteracting = false;
      this.rebaseSway();
    });

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
    // Pass/look/sim BAŞLANGIÇ değerlerini sakla — sıfırlama bunlara döner.
    // Anlık görüntü pass'ler kurulduktan HEMEN SONRA alınır: preset yükleme
    // ya da graf uygulaması bu değerleri henüz değiştirmemiştir.
    this.passDefaults = {
      grain: collectParams(GRAIN_PARAMS, this.grainUniforms),
      feedback: collectParams(FEEDBACK_PARAMS, this.feedbackUniforms),
      chromatic: collectParams(CHROMATIC_PARAMS, this.chromaticUniforms),
      bloom: collectParams(BLOOM_PARAMS, this.bloomUniforms),
      look: collectParams(LOOK_PARAMS, this.lookUniforms),
      sim: collectParams(SIM_PARAMS, this.simUniforms),
    };
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
      this.applySway(dt);
      this.controls.update();
      // SPLAT: alpha blend sırası CPU'da kurulur. controls.update()'ten SONRA
      // (kamera matrisi güncel) ve composer.render()'dan ÖNCE olmalı — bir kare
      // gecikmiş sıra, dönüş sırasında görünür popping demektir.
      if (this.splatObject?.mesh.visible) {
        this.camera.updateMatrixWorld();
        this.splatObject.update(
          this.camera,
          this.splatSortModeName,
          this.splatMinOpacity,
          this.viewportPx,
          this.splatObject.mesh.material as THREE.Material,
        );
      }
      this.tickPasses(time / 1000);
      this.composer.render();
      // ÇİZİM SONRASI KANCA — konumu KRİTİK. `preserveDrawingBuffer` kapalı
      // olduğu için çizim tamponu yalnızca render ile kompozit arasında
      // geçerlidir (export.ts'teki aynı kural). Kanca dışarıdan bir rAF
      // döngüsünde çağrılsaydı boş kare okurdu.
      this.frameTap?.(this.renderer.domElement);
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
    // MATERIAL ZAMANI (Gün 1 — neon rAF kaldırıldı): `uTime` taşıyan her
    // kayıtlı material'a AYNI saati işle. Eskiden neon kendi rAF'ını
    // sürüyordu; iki ayrı zaman kaynağı sekme arka plandan dönünce ayrışıyor
    // ve mod kapalıyken bile tikliyordu. Tek kaynak: bu kanca.
    for (const entry of this.renderModes.values()) {
      const u = (entry.material as THREE.ShaderMaterial).uniforms as
        | Record<string, THREE.IUniform>
        | undefined;
      if (u?.['uTime']) u['uTime'].value = time;
    }
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
    if (!Engine.usesShellMesh(name) && name !== 'splat') this.lastNonSolidMaterial = material;
    if (name === 'splat') {
      // SPLAT nokta bulutunun material'ı DEĞİLDİR: kendi instanced quad
      // geometrisi var (aCorner/aSplatIndex), points geometrisinde yok.
      // Takas YAPILMAZ — yalnızca mod adı ve görünürlük güncellenir; bulut
      // arkada son sağlam material'ıyla durur (buffer boşsa ona düşülür).
      this.renderModeName = 'splat';
      this.splatObject?.bindTextures(material);
      this.syncRenderVisibility();
      return;
    }
    if (Engine.usesShellMesh(name) && !this.solidReady) {
      // FotoÄŸraf yok â†’ kabuk yok. Solid material'Ä± nokta bulutuna takmak
      // uv/normal attribute eksikliÄŸinden kÄ±rÄ±k render eder; material takasÄ±
      // YAPILMAZ, son saÄŸlam material'da kalÄ±nÄ±r (kabuk kurulunca uygulanÄ±r).
      if (name) this.renderModeName = name;
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
    if (Engine.usesShellMesh(this.renderModeName)) {
      const solidMaterial = this.renderModes.get(this.renderModeName)?.material;
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

  /**
   * KABUK MESH'İ KULLANAN MODLAR: 'solid' ve (Gün 2'den beri) 'crystal'.
   * İkisi de gerçek 2-manifold yüzeye + `normal`/`uv` attribute'larına ihtiyaç
   * duyar; nokta bulutu geometrisinde bunlar YOKTUR (aUv grid'i taşır).
   * Kabuk yoksa material takılmaz — graceful fallback deseni ikisinde de aynı.
   */
  private static usesShellMesh(name: string | null): boolean {
    return name === 'solid' || name === 'crystal';
  }

  /** GÃœN B: solid mod aktif + kabuk hazÄ±rsa bulut gizlenir, mesh gÃ¶rÃ¼nÃ¼r. */
  private syncRenderVisibility() {
    // CRYSTAL YÖNLENDİRMESİ (Gün 3): kabuk varsa mesh'te, yoksa splat'ta çizer.
    // Video yolunda kabuk hiç kurulmaz (fotoğraf-only) — crystal'ın "her iki
    // kaynakta çizer" ölçütü bu dala bağlı.
    const crystalOnSplat =
      this.renderModeName === 'crystal' &&
      !this.solidReady &&
      Boolean(this.crystalSplatMaterial) &&
      (this.splatObject?.ready ?? false);
    if (crystalOnSplat && this.crystalSplatMaterial) {
      this.splatObject!.setMaterial(this.crystalSplatMaterial);
    } else if (this.renderModeName === 'splat' && this.splatObject) {
      const splatMat = this.renderModes.get('splat')?.material;
      if (splatMat) this.splatObject.setMaterial(splatMat);
    }
    const solidActive = Engine.usesShellMesh(this.renderModeName) && !crystalOnSplat;
    // 'splat' aktif + GaussianBuffer dolu → nokta bulutu gizlenir, splat
    // nesnesi görünür. Buffer boşsa (fotoğraf yüklenmemiş) nokta bulutunda
    // kalınır — solid modunun graceful fallback'iyle aynı desen.
    const splatActive = this.renderModeName === 'splat' && (this.splatObject?.ready ?? false);
    this.splatObject?.setVisible(splatActive || crystalOnSplat);
    this.points.visible = !(solidActive && this.solidReady) && !splatActive && !crystalOnSplat;
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
    // GÜN 2 (Z2.2) — SAHNE RENGİ: crystal'ın Gün 5 kırılması için arkadaki
    // görüntü bir texture'da olmalı. Cevap: EVET, sahne EffectComposer'ın
    // renderTarget1/2 ping-pong'una yazılıyor (doğrudan ekrana değil).
    //
    // KRİTİK: crystal RenderPass sırasında ÇİZİLİYOR, yani o an composer'ın
    // WRITE buffer'ına yazıyor. Aynı buffer'ı okumak geri besleme döngüsüdür
    // (tanımsız davranış). Bu yüzden READ buffer bağlanır — içeriği BİR
    // ÖNCEKİ karenin çıktısıdır. Kırılma için bir kare gecikme görünmez;
    // ekstra sahne geçişi ya da yeni RT gerektirmez.
    if (u['uSceneColor']) {
      u['uSceneColor'].value = this.composer.readBuffer.texture;
    }
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
    // BAŞLANGIÇ NOKTASI ANLIK GÖRÜNTÜSÜ (sıfırlama için).
    // ParamDef.default'tan sıfırlamak YETMEZ: renk kolları (kind: 'color')
    // ParamDef'te `default: 0` taşır — sayı, renk değil. Gerçek başlangıç
    // değeri material'ın kendi uniform'undadır; kayıt anında okunur.
    this.paramDefaults.set(name, collectParams(params, (material as THREE.ShaderMaterial).uniforms as Record<string, THREE.IUniform>));
    if (this.pointsMaterial === material) this.renderModeName = name;
    // 'splat' AYRI BİR ÇİZİM NESNESİDİR (instanced quad), nokta bulutunun
    // material takası değil: points geometrisinde aCorner/aSplatIndex yoktur.
    // Nesne mod kaydedilince kurulur; GaussianBuffer o anda boştur ve ilk
    // setDepth/setPhoto onu doldurur (refreshGaussians).
    if (name === 'splat' && !this.splatObject) {
      this.splatObject = new SplatObject(material, POSITION_TEXTURE_SIZE);
      this.splatObject.bindTextures(material);
      this.scene.add(this.splatObject.mesh);
      this.refreshGaussians();
      this.syncRenderVisibility();
    }
  }

  /**
   * GaussianBuffer'ı MEVCUT nokta bulutundan tazeler (geçici köprü — Gün 7
   * füzyonu bunun yerine geçecek, sözleşme aynı kalacak). setDepth ve setPhoto
   * sonrasında çağrılır: splat modu fotoğrafla birlikte güncel kalsın.
   */
  private refreshGaussians() {
    if (!this.splatObject) return;
    // Depth yoksa home texture sıfırdır: doldurulursa 147k splat orijinde
    // üst üste yığılır ve `splatAvailable` YALAN söyler (mod seçilebilir
    // görünür, ekranda tek leke çıkar). Veri gelene kadar buffer boş kalır,
    // Engine nokta bulutunda tutar (solid modunun fallback deseni).
    if (!this.currentDepthTexture) return;
    const count = fillGaussiansFromPointCloud(
      this.splatObject.textures,
      this.homeTexture.image.data as Float32Array,
      this.imageColorTexture ? (this.imageColorTexture.image.data as Uint8Array) : null,
      POSITION_TEXTURE_SIZE,
    );
    this.splatObject.syncFromTextures(count);
    this.syncRenderVisibility();
  }

  /**
   * D.1 sözleşmesinin ASIL girişi: füzyon (Gün 7) ürettiği GaussianBuffer'ı
   * buradan verir. Köprü doldurucusunun aksine normal/ölçek gerçek çok-görüntü
   * çıktısıdır; render tarafında hiçbir şey değişmez.
   */
  setGaussians(data: GaussianBufferData | null) {
    if (!this.splatObject) return;
    if (!data) {
      this.splatObject.syncFromTextures(0, null);
      this.syncRenderVisibility();
      return;
    }
    uploadGaussianData(this.splatObject.textures, data);
    // D.4: keyframeIndex GPU'ya gitmez, timeline filtresi için CPU'da tutulur.
    this.splatObject.syncFromTextures(data.count, data.keyframeIndex);
    this.syncRenderVisibility();
  }

  /**
   * GÜN 5 (render şeridi) — poz zincirini sahnede görünür kılar: keyframe
   * frustum'ları + yörünge çizgisi. Kayıt D.2 yönündedir (kamera→dünya);
   * overlay tersini ALMAZ. `null` → overlay boşalır ve gizlenir.
   */
  setPoseTrack(poses: PoseTrackRecord[] | null) {
    this.poseTrack = poses ?? [];
    if (!this.trajectoryOverlay) {
      if (this.poseTrack.length === 0) return;
      this.trajectoryOverlay = createTrajectoryOverlay();
      this.scene.add(this.trajectoryOverlay.group);
    }
    this.trajectoryOverlay.update(this.poseTrack, this.camera.aspect, this.selectedKeyframe);
    this.trajectoryOverlay.setVisible(this.trajectoryVisible && this.poseTrack.length > 0);
  }

  /** Poz zinciri (UI timeline'ı bunu okur). */
  get poses(): PoseTrackRecord[] {
    return this.poseTrack;
  }

  /** Yörünge/frustum overlay'ini aç-kapa. */
  setTrajectoryVisible(v: boolean) {
    this.trajectoryVisible = v;
    this.trajectoryOverlay?.setVisible(v && this.poseTrack.length > 0);
  }

  get trajectoryShown(): boolean {
    return this.trajectoryVisible;
  }

  /**
   * GÜN 5-6 — D.4 timeline filtresi: yalnızca seçili keyframe'den gelen
   * splat'lar çizilir (null = hepsi). Seçim aynı zamanda frustum vurgusudur.
   */
  setSelectedKeyframe(id: number | null) {
    this.selectedKeyframe = id;
    this.splatObject?.setKeyframeFilter(id);
    if (this.trajectoryOverlay) {
      this.trajectoryOverlay.update(this.poseTrack, this.camera.aspect, id);
    }
  }

  get selectedKeyframeId(): number | null {
    return this.selectedKeyframe;
  }

  /** Sahnedeki keyframe sayısı (timeline uzunluğu). */
  get keyframeCount(): number {
    return Math.max(this.poseTrack.length, this.splatObject?.keyframeCount ?? 0);
  }

  /** Splat modu çizilebilir mi (GaussianBuffer dolu)? UI bunu söyler. */
  get splatAvailable(): boolean {
    return this.splatObject?.ready ?? false;
  }

  /** CPU sıralama yolu — renderer düğümünün params.sortMode'u sürer. */
  get splatSortMode(): SplatSortMode {
    return this.splatSortModeName;
  }

  setSplatSortMode(mode: SplatSortMode) {
    this.splatSortModeName = mode;
  }

  /** Son sıralamanın süresi (ms) + çizilen splat sayısı — ölçüm paneli okur. */
  get splatStats(): { sortMs: number; visible: number } {
    return {
      sortMs: this.splatObject?.lastSortMs ?? 0,
      visible: this.splatObject?.visibleCount ?? 0,
    };
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
  /** Crystal'ın splat varyantını kaydeder (App kurar; knob'lar ortaktır). */
  setCrystalSplatMaterial(material: THREE.Material | null) {
    this.crystalSplatMaterial = material;
    this.syncRenderVisibility();
  }

  /**
   * SIFIRLA — sahneyi "yeni açılmış" hâline döndürür.
   *
   * Neden gerekli: efekt kollarıyla oynadıktan sonra başlangıç noktasına
   * dönmenin yolu yoktu. Graf sıfırlaması yalnız düğüm bağlantılarını geri
   * alıyor; material ve pass uniform'ları oynanmış hâlde kalıyordu — yeni bir
   * görsele geçince de o ayarlar devam ediyor ve "neden böyle görünüyor?"
   * sorusuna cevap bulunamıyordu.
   *
   * Geri alınanlar: her kayıtlı render modunun parametreleri, post-pass
   * zinciri (grain/feedback/chromatic/bloom), global look (exposure + sis),
   * simülasyon kolları ve kamera pozu. MEDYA (fotoğraf/video/depth) ve graf
   * DOKUNULMAZ — "efektleri sıfırla" ile "her şeyi sil" ayrı işlerdir;
   * kullanıcı görselini kaybetmez.
   */
  resetRenderParams(opts: { camera?: boolean } = {}) {
    for (const [name, entry] of this.renderModes) {
      const defaults = this.paramDefaults.get(name);
      if (!defaults) continue;
      const u = (entry.material as THREE.ShaderMaterial).uniforms as Record<string, THREE.IUniform>;
      applyParams(entry.params, u, defaults);
    }
    if (this.passDefaults) {
      applyParams(GRAIN_PARAMS, this.grainUniforms, this.passDefaults.grain);
      applyParams(FEEDBACK_PARAMS, this.feedbackUniforms, this.passDefaults.feedback);
      applyParams(CHROMATIC_PARAMS, this.chromaticUniforms, this.passDefaults.chromatic);
      applyParams(BLOOM_PARAMS, this.bloomUniforms, this.passDefaults.bloom);
      applyParams(LOOK_PARAMS, this.lookUniforms, this.passDefaults.look);
      applyParams(SIM_PARAMS, this.simUniforms, this.passDefaults.sim);
    }
    // Feedback birikimi bayat kare taşır; temizlenmezse eski efektin izi
    // ekranda kalır ve "sıfırlandı" izlenimini bozar.
    this.feedbackPass.requestClear();
    if (opts.camera !== false) {
      this.camera.position.copy(this.cameraHome.pos);
      this.controls.target.copy(this.cameraHome.target);
      this.controls.update();
      // Sway açıksa yeni (home) pozdan devam etsin — bir sonraki applySway
      // çağrısı eski taban'a sıçrayıp "sıfırla"yı görünmez kılmasın.
      this.rebaseSway();
    }
  }

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

  /**
   * Her karede, çizimden HEMEN SONRA çağrılacak kanca — tracker HUD'un
   * ÇİZİLEN kareyi (motor canvas'ı) okuması için. `null` kancayı kaldırır.
   *
   * Neden kaynak video değil de çizilen kare: ekranda görünen şey videonun
   * kendisi değil, ondan türetilen 3B sahnenin projeksiyonudur. Video piksel
   * uzayında bulunan bir hedef ekranda BAŞKA bir yere düşer (boş alana bile) —
   * HUD kutuları içeriğin üstünde durmaz. Çizilen kareyi izlemek iki uzayı
   * tek uzaya indirir: kutu, kullanıcının gördüğü şeyin üstünde olur ve HUD
   * video olmayan kaynaklarda (fotoğraf, splat, sentetik) da çalışır.
   *
   * ÇAĞRI ANI SÖZLEŞMESİ: kanca `composer.render()`'dan hemen sonra, aynı
   * görevde çağrılır — `preserveDrawingBuffer` kapalı olduğu için canvas
   * yalnızca o an okunabilir (export.ts ile aynı kural).
   */
  setFrameTap(tap: ((view: HTMLCanvasElement) => void) | null) {
    this.frameTap = tap;
  }

  /**
   * "Canlı fotoğraf" paralaks sway aç/kapat. AÇILDIĞI ANDAKI kamera pozu
   * temel alınır (`rebaseSway`) — cameraHome'a atlamaz, kullanıcının
   * kadrajını korur. Kapatınca kamera o an sway'in ürettiği pozda kalır
   * (sıçrama yok); bir sonraki `applySway` çağrısı olmayacağı için sabitlenir.
   */
  setAutoSway(enabled: boolean, opts?: { amplitudeDeg?: number; speed?: number }) {
    if (opts?.amplitudeDeg !== undefined) this.swayAmplitudeDeg = opts.amplitudeDeg;
    if (opts?.speed !== undefined && opts.speed !== this.swaySpeed) {
      // FAZ SÜREKLİLİĞİ. Açı sin(swayTime · k · hız); hız değişince swayTime
      // ölçeklenmezse faz ANINDA sıçrar — ölçüldü (5 sn sway sonrası hız
      // 1 → 2.5): normal kare adımı 0.06°, hız değişimindeki adım 4.94°
      // (×82, kamera görünür biçimde zıplıyor). Sway ne kadar uzun açık
      // kalırsa sıçrama o kadar büyür. swayTime'ı ters oranda ölçeklemek
      // faz çarpımını (swayTime · hız) korur: sıçrama yok, tempo değişir.
      // hız = 0 bölen olamaz; o durumda hareket durur, faz olduğu yerde kalır.
      if (opts.speed > 0) this.swayTime *= this.swaySpeed / opts.speed;
      this.swaySpeed = opts.speed;
    }
    if (enabled === this.swayEnabled) return;
    this.swayEnabled = enabled;
    if (enabled) this.rebaseSway();
    else {
      this.swayBasePos = null;
      this.swayBaseTarget = null;
    }
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
      // GÃœN E (bulgu 2): Ä°KÄ°NCÄ° DÄ°LASYON KALDIRILDI.
      //
      // Maske burada bir kez daha dilate ediliyordu: yarÄ±Ã§ap
      // round(MASK_DILATE_RADIUS Ã— maskWidth/width) = round(4 Ã— 1024/518) = 8 px
      // (depth uzayÄ±nda). Ama segmentation.ts maskeyi KENDÄ° Ã§Ã¶zÃ¼nÃ¼rlÃ¼ÄŸÃ¼nde
      // (1024Â²) zaten 4 px dilate + tÃ¼y uygulayarak dÃ¶ndÃ¼rÃ¼yor
      // (segmentation.ts, dilateAndFeatherMask Ã§aÄŸrÄ±sÄ±) â€” iki aÅŸama birbirinden
      // habersizdi ve etkileri Ã‡ARPIÅžIYORDU.
      //
      // ÃœstÃ¼ne, Ã¶lÃ§ek Ã§arpanÄ± TERS yÃ¶ndeydi: 1024 â†’ 518 kÃ¼Ã§Ã¼ltmenin yumuÅŸattÄ±ÄŸÄ±
      // bandÄ± telafi etmek iÃ§in yarÄ±Ã§apÄ±n Ã–LÃ‡EÄžE BÃ–LÃœNMESÄ° gerekirdi (4/1.98 â‰ˆ 2),
      // Ã‡ARPILMASI deÄŸil (4Ã—1.98 = 8).
      //
      // Ã–lÃ§Ã¼m (2026-08-14, gerÃ§ek fonksiyonlar, kolâ€“gÃ¶vde boÅŸluklu sentetik Ã¶zne):
      // ham alana gÃ¶re Ã§ift dilasyon +%23.9, yalnÄ±z bu ikinci geÃ§iÅŸ +%19.7,
      // yalnÄ±z segmentation'daki geÃ§iÅŸ +%6.2. 14 px'lik kolâ€“gÃ¶vde boÅŸluÄŸu Ã§ift
      // dilasyonda tamamen doluyordu (topaklaÅŸma).
      //
      // Bilinear kÃ¼Ã§Ã¼ltme 0.5 izÃ§izgisini yarÄ±m hedef pikselden fazla kaydÄ±rmaz;
      // segmentation'daki 4 px (â‰ˆ 2 px depth uzayÄ±nda) bunu zaten fazlasÄ±yla
      // karÅŸÄ±lar. AyrÄ±ca scripts/verify-curtain.mjs (tek gerÃ§ek fotoÄŸraf testi)
      // bu ikinci geÃ§iÅŸi HÄ°Ã‡ Ã§alÄ±ÅŸtÄ±rmÄ±yordu â€” Ã¼retim yolu ile test edilen yol
      // ayrÄ±ÅŸmÄ±ÅŸtÄ±; kaldÄ±rÄ±nca ikisi birebir aynÄ± hesabÄ± yapÄ±yor.
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
    // SPLAT köprüsü: GaussianBuffer home + renk grid'inden türer, ikisi de
    // yukarıda tazelendi. Splat modu kayıtlı değilse (splatObject null) bu
    // çağrı bedavadır.
    this.refreshGaussians();
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
    // Splat köprüsü: renk grid'i (gSplatC kaynağı) az önce doldu.
    this.refreshGaussians();
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

  /** Sway'in temel pozunu ŞİMDİKİ kamera pozuna çeker (enable anında ve
   *  manuel sürüklemenin BİTİMİNDE çağrılır) — sway her zaman "kullanıcının
   *  son bıraktığı yer"den devam eder, cameraHome'dan değil. */
  private rebaseSway() {
    if (!this.swayEnabled) return;
    this.swayBasePos = this.camera.position.clone();
    this.swayBaseTarget = this.controls.target.clone();
    this.swayTime = 0;
  }

  /** `swayBasePos` etrafında küçük açılı yörünge (yaw + hafif pitch),
   *  hedefe göre küresel koordinatta — kamera her karede TABAN'dan yeniden
   *  hesaplanır (birikimli sürüklenme yok). dt saniye; kare hızından
   *  bağımsız (SIM_PARAMS'taki uDtScale felsefesiyle aynı). */
  private applySway(dt: number) {
    if (!this.swayEnabled || this.userInteracting || !this.swayBasePos || !this.swayBaseTarget) return;
    this.swayTime += dt;
    const amp = THREE.MathUtils.degToRad(this.swayAmplitudeDeg);
    const yaw = Math.sin(this.swayTime * 0.6 * this.swaySpeed) * amp;
    const pitch = Math.sin(this.swayTime * 0.37 * this.swaySpeed) * amp * 0.6;
    const offset = this.swayBasePos.clone().sub(this.swayBaseTarget);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += yaw;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + pitch, 0.05, Math.PI - 0.05);
    this.camera.position.copy(this.swayBaseTarget).add(new THREE.Vector3().setFromSpherical(spherical));
    this.controls.target.copy(this.swayBaseTarget);
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
    // Splat Jacobian'ı da DRAWING BUFFER ölçeğinde çalışır: CSS pikseli
    // verilirse DPR > 1'de elipsler yarı boyutta çizilir (yüzey delinir).
    this.renderer.getDrawingBufferSize(this.viewportPx);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    // Post-pass devre dÄ±ÅŸÄ±yken composer'da deÄŸildir; composer.dispose() onu
    // gÃ¶rmez, GPU kaynaÄŸÄ± bÄ±rakÄ±lmaz. Tek seferlik kurum gereÄŸi iki yol da.
    // GRAIN DISPOSE (düzeltildi): koşul TERSTİ — grain yalnızca composer'da
    // DEĞİLKEN dispose ediliyordu, yani normal durumda (zincirde) hiç
    // bırakılmıyordu. `EffectComposer.dispose()` yalnızca renderTarget1/2 ve
    // copyPass'i bırakır, PASS'LERE DOKUNMAZ (three.js kaynağı) — dolayısıyla
    // "composer onu görür" varsayımı yanlıştı ve her remount'ta grain'in
    // render target'ı sızıyordu. Grain Engine'in malıdır: koşulsuz bırakılır.
    this.grainPass.dispose();
    this.composer.dispose(); // composer'ın KENDİ RT'leri (pass'ler dahil değil)
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
    this.splatObject?.dispose();
    this.trajectoryOverlay?.dispose();
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

