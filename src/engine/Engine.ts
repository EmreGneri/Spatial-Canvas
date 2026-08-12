import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
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
import { SIM_PARAMS } from './simulation';
import { GRAIN_PARAMS } from '../shaders/grainPass';
import { applyParams, collectParams, type ParamDef, type ParamValues } from './params';
import { activeNodes, createDefaultGraph, topologicalOrder, validateGraph, type Graph } from './graph';
import { resampleBilinear, dilateAndFeatherMask } from './reconstruction/silhouette.ts';
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

  /**
   * GÖRSEL RENK TEXTURE'U (Tur 11): fotoğraf RGB'si, konumlarla aynı grid
   * eşlemesiyle (sampler.ts sampleImageGrid) buraya yazılır; render
   * shader'ları uImageTexture adıyla aUv'de okur — her parçacık kendi
   * fotoğraf pikselinin rengini taşır. Fotoğraf yüklenene kadar null'dur;
   * material'lar uHasImage = 0 ile derinlik rampasına düşer (kamera/video).
   */
  private imageColorTexture: THREE.DataTexture | null = null;
  /** setPhoto ile alınan fotoğraf pikselleri (0..1, interleaved rgb) — CPU
   *  örneklemesi için saklanır; GPU tarafı imageColorTexture'tır. */
  private photoData: Float32Array | null = null;
  private photoWidth = 0;
  private photoHeight = 0;

  /**
   * VİDEO RENK DOKUSU (Tur 12): aktif video kaynağı canlı VideoTexture olarak
   * uImageTexture'a bağlanır (GPU tarafı, kare kare upload). Konum grid'i
   * luminanceHeightMap ile aynı oranda örneklediği için aUv ile birebir
   * hizalıdır. Video yokken null — fotoğraf grid'i (imageColorTexture) geçer.
   */
  private videoElement: HTMLVideoElement | null = null;
  private videoTexture: THREE.VideoTexture | null = null;

  /**
   * Nesne ayırma (Tur 12 — şikayet 4): AÇIK iken shader'lar arka plan
   * parçacıklarını (w < 0.5) tamamen atar — ekranda beyaz kağıt/perde kalmaz,
   * yalnızca büst görünür. KAPALI iken tüm sahne çizilir; arka plan
   * pikselleri parlayıp özneyi yutmasın diye karartılır (×0.4).
   */
  private objectSeparation = false;
  /**
   * Renk modu (Tur 12 — şikayet 3): AÇIK (varsayılan) → parçacık rengi
   * doğrudan görselin RGB dokusundan; KAPALI → dokular yok sayılır, renk
   * sağ paneldeki Near/Far derinlik gradyanından türetilir.
   */
  private useTextureColor = true;

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

  /**
   * GÜN 6 (video 3D — madde 4): video/kamera kaynağı aktifken home depth'i
   * her karede değişir. Toptan yazılırsa yay parçacığı sürekli dürter
   * (atiyoloji kaybı + titreme). Bu bayrak açıkken fillPositionsFromDepth
   * blend ile yazılır (0.8) ve yay/ölü bölge videoya göre gevşetilir.
   * Yalnızca startLuminanceLoop (canlı) sırasında true — fotoğraf yolu değil.
   */
  dynamicHome = false;

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

  /**
   * GÜN 6 (opt): otomatik DPR düşürme. FPS sürdürülebilir eşiğin (30) altına
   * düşerse drawing buffer 384→256'ya iner (karede 2.25x daha az piksel);
   * tekrar 45+ olursa geri yükselir. Histerezis: sık sık salınım yapmaz.
   * Kullanıcı yüksek DPR istiyorsa capsMaxDpr=1 vererek kapatabilir.
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
      // Tur 12 (şikayet 1): video kaynağı aktifken video dokusu her karede
      // GPU'ya taşınır — yeni kare yüklendikçe parçacık renkleri canlı kalır.
      if (this.videoTexture && this.videoElement) {
        this.videoTexture.needsUpdate = true;
      }
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
    // Tur 11: tek nokta bulutu, tek draw call — fg + bg aynı uPositions
    // texture'ında (home) yaşar; material takası yoktur.
    // Tur 12: yeni material'a tüm ortak render uniform'larını işle
    // (renk dokusu, nesne ayırma, renk modu).
    this.pushSharedUniforms(material);
    // Registry'deki adı yakala — ModeSelector doğrudan takas edince de
    // renderMode güncel kalsın (toPreset bunu yazar).
    for (const [name, entry] of this.renderModes) {
      if (entry.material === material) {
        this.renderModeName = name;
        break;
      }
    }
  }

  /**
   * Kaynak-türünden bağımsız ortak render uniform'larını bir material'a
   * işler: uImageTexture (fotoğraf grid'i ya da video dokusu), uHasImage,
   * uObjectSeparation (nesne ayırma), uUseTextureColor (renk modu). Hepsi
   * Engine'in sahipliğinde; UI/source değişimi buradan tek kapıyla yayılır.
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

  /** Nesne ayırma (Tur 12 — şikayet 4): shader'lara canlı işlenir. */
  setObjectSeparation(on: boolean) {
    this.objectSeparation = on;
    this.pushSharedUniformsAll();
  }

  /**
   * Renk modu (Tur 12 — şikayet 3): AÇIK → görsel dokusu; KAPALI → sağ
   * paneldeki Near/Far derinlik gradyanı. Fotoğraf/video yüklü olup olmaması
   * fark etmeksizin her iki material'a canlı işlenir.
   */
  setUseTextureColor(on: boolean) {
    this.useTextureColor = on;
    this.pushSharedUniformsAll();
  }

  /**
   * VİDEO KAYNAĞI (Tur 12 — şikayet 1): videoyu canlı VideoTexture olarak
   * uImageTexture'a bağlar; eski fotoğraf grid'ini ve eski video dokusunu
   * dispose eder (resim hayaleti kalmaz). null → video dokusu bırakılır
   * (kamera kapatıldı / kaynak değişti); fotoğraf grid'i varsa onunla devam
   * edilir, yoksa uHasImage = 0 → shader'lar derinlik rampasına düşer.
   */
  setVideoSource(video: HTMLVideoElement | null) {
    if (video === this.videoElement) return;
    this.videoTexture?.dispose();
    this.videoTexture = null;
    this.videoElement = video;
    if (video) {
      // Yeni video geliyor — eski fotoğraf pikselleri hayalet olarak kalmasın.
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
   * Fotoğraf renk grid'ini GPU'dan TAMAMEN bırakır (Tur 12 — şikayet 1):
   * yeni kaynak gelmeden eski uImageTexture dispose edilir, böylece
   * resim→video geçişinde parçacık renklerinde hayalet kalmaz. Video dokusu
   * varsa uHasImage yeniden 1 olur; yoksa derinlik rampasına düşülür.
   */
  releasePhoto() {
    this.imageColorTexture?.dispose();
    this.imageColorTexture = null;
    this.photoData = null;
    this.photoWidth = 0;
    this.photoHeight = 0;
    this.pushSharedUniformsAll();
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
        // Aynı material'ı TEKRAR takma: setPointsMaterial eskisini dispose
        // eder — ascii material atlas'ını dispose kancasıyla bıraktığı için
        // kendi material'ının atlas'ı silinir, mod ekranda kaybolurdu.
        if (entry && entry.material !== this.pointsMaterial) {
          this.setPointsMaterial(entry.material);
        } else if (entry) {
          this.renderModeName = mode;
        } else {
          warnings.push(`render modu bilinmiyor: '${mode}' (graf modu korunur)`);
        }
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
  setDepth(
    data: Float32Array,
    width: number,
    height: number,
    foregroundMask?: Float32Array,
    maskWidth?: number,
    maskHeight?: number,
  ) {
    // Nesne maskesi (segmentation.ts) depth ile aynı boyutta değilse (letterbox
    // yuvarlama farkları) depth boyutuna yeniden örneklenir — siluet AND koşulu
    // piksel-piksel hizalı yürüsün.
    let mask: Float32Array | undefined;
    if (foregroundMask && maskWidth && maskHeight) {
      mask =
        maskWidth === width && maskHeight === height
          ? foregroundMask
          : resampleBilinear(foregroundMask, maskWidth, maskHeight, width, height);
      // Kenar güvencesi: bilinear ölçekleme siluet kenarındaki yumuşak değerleri
      // (< 0.5) üretir; buildSilhouette'teki sert AND bu bandı keserdi (önceki
      // hata: "sadece orta seçiliyor"). Eşiği gevşetmeden (arka plan da sızardı)
      // maske depth uzayında HAFİF dilate edilir — dar morf: kenar +1px geri
      // kazanılır, uzak arka plan (RMBG 0.0-0.1) hâlâ temiz kalır.
      mask = dilateAndFeatherMask(mask, width, height);
    }
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
    // GÜN 6 (madde 4): video/kamera kaynağında (dynamicHome) home %80 yeni
    // %20 eski ile yazılır — parçacık ataleti korunur, titreme söner.
    fillPositionsFromDepth(this.homeTexture, data, width, height, {
      foregroundMask: mask,
      blend: this.dynamicHome ? 0.8 : 1,
    });
    // TUR 11: fotoğraf yüklüyse parçacık renklerini de aynı grid/remap ile
    // doldur (setPhoto'dan önce setDepth gelirse texture boş kalır — renkler
    // sonraki setDepth'te yazılır).
    if (this.photoData) {
      fillImageColorTexture(
        this.imageColorTexture!,
        this.photoData,
        this.photoWidth,
        this.photoHeight,
        data,
        width,
        height,
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

  /**
   * Fotoğrafı (orijinal RGB) parçacık renklerine bağlar (Tur 11 — görev 1).
   * `setDepth`'ten ÖNCE çağrılır: pikseller CPU'da saklanır (renk grid'i
   * depth gelince aynı remap ile doldurulur), RGBA8 grid texture'ı
   * uImageTexture olarak tüm kayıtlı render material'larına işlenir.
   * Tur 12 (şikayet 1): eski fotoğraf grid'i önce dispose edilir — yeni
   * görsel yüklendiğinde GPU'da eski renk önbelleği kalmaz.
   * Kamera/video yolu setPhoto çağırmaz → video dokusu yoksa uHasImage = 0,
   * shader'lar varsayılan derinlik rampasına düşer.
   */
  setPhoto(source: HTMLCanvasElement | HTMLImageElement) {
    // Tur 12: eski renk önbelleği tamamen temizlenir (hayalet yok).
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
    // Fotoğraf daha önce depth'le geldiyse (setDepth → setPhoto sırası) renk
    // grid'ini hemen doldur; yoksa bir sonraki setDepth üstlenir.
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
      );
    }
    // Ortak uniform'ları tüm render modlarına işle (gelecekte takılacak
    // material'lar için setPointsMaterial aynı şeyi yapar).
    this.pushSharedUniformsAll();
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
      // GÜN 6 (opt): otomatik çözünürlük uyarlaması — histerezisli geçit.
      this.adaptResolution();
    }
  }

  /**
   * FPS'ye göre pixel ratio'yu düşür/yükselt. Histerezis: 30 altı 1 sn üst
   * üste görülürse düşür (384→256 = 2.25x daha az piksel); 45 üstü 2 sn
   * sürerse geri yükselt. Salınımı önler, düşük + yüksek DPR cihazlarda
   * video yolunu akıcı tutar.
   */
  private adaptResolution() {
    if (!this.adaptiveDpr) return;
    const maxDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (this.fps > 0 && this.fps < 30) {
      this.lowFpsCount++;
      this.highFpsCount = 0;
      if (this.lowFpsCount >= 1 && this.currentDpr > 0.75) {
        this.currentDpr = Math.max(0.75, this.currentDpr * 0.75);
        this.renderer.setPixelRatio(this.currentDpr);
        this.resize(); // drawing buffer + composer + grain uResolution
        this.lowFpsCount = 0;
        console.log(`[engine] DPR ${this.renderer.getPixelRatio().toFixed(2)} — düşük FPS (${this.fps})`);
      }
    } else if (this.fps >= 45) {
      this.highFpsCount++;
      this.lowFpsCount = 0;
      if (this.highFpsCount >= 2 && this.currentDpr < maxDpr) {
        this.currentDpr = Math.min(maxDpr, this.currentDpr / 0.75);
        this.renderer.setPixelRatio(this.currentDpr);
        this.resize();
        this.highFpsCount = 0;
        console.log(`[engine] DPR ${this.renderer.getPixelRatio().toFixed(2)} — toparlandı (${this.fps})`);
      }
    } else {
      // Orta bölge: sayaçları tut — salınım bastırılır.
      this.lowFpsCount = Math.max(0, this.lowFpsCount - 0);
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
    this.imageColorTexture?.dispose();
    this.videoTexture?.dispose();
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
