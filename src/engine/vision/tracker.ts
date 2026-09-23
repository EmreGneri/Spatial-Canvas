// Tracker HUD — canlı önizlemede (kamera/video) izlenen köşe kümelerini
// hedef kutucuklarına indirger (Zeynep'in TrackerOverlay'i bunu çizer).
//
// HIZLI PROTOTİP (Gün 1, sprint kararı): verify-*.mjs yok, ölçüm kaydı yok.
// `flow.ts`'in kilitli Shi-Tomasi/LK'sını YENİDEN KULLANIR, DEĞİŞTİRMEZ.
// Kendi çalışma çözünürlüğü `flow.ts`in FLOW_WIDTH/HEIGHT'ından ve
// `videoPipe.ts`'in KEYFRAME_WIDTH/HEIGHT'ından BAĞIMSIZDIR — bu dosyanın
// ayarını değiştirmek füzyon/poz pipeline'ını etkilemez.
import { computeOpticalFlow } from './flow.ts';
import type { FlowPoint } from './types.ts';

/**
 * Tracker'ın kendi çalışma çözünürlüğü. 160×90 → 128×72 DÜŞÜRÜLDÜ: kaynak
 * artık motor canvas'ı, yani kare yakalama GPU→CPU geri okumadır ve
 * tarayıcıda ölçülen maliyet Node'dakinin çok üstünde çıktı
 * (`getImageData` tek başına 6.1 ms, akış 8.6 ms). Aynı koşullarda ölçülen
 * GÖRELİ karşılaştırma:
 *
 *   160×90 → 22.6 ms/hesap
 *   128×72 → 15.6 ms/hesap   (−%31)
 *
 * Köşe sayısı bu kararda etkisiz çıktı (100 vs 70: 22.6 vs 21.2 ms) — kaldıraç
 * çözünürlük, köşe bütçesi değil.
 *
 * DÜRÜSTLÜK: bu sayılar rAF'ı kısıtlanmış bir test ortamında alındı, MUTLAK
 * değer olarak gerçek makineyi temsil etmez; oran güvenilir, "60 Hz bütçesine
 * (16.7 ms) sığıyor" iddiası DOĞRULANMADI. Gerçek kontrol: tracker açıkken
 * arayüzdeki fps sayacı. Maliyet hâlâ yüksekse sıradaki kol `everyNFrames`
 * (3 → 5) ya da hesabı Worker'a taşımak.
 */
export const TRACKER_WIDTH = 128;
export const TRACKER_HEIGHT = 72;

/** Bir HUD kutusu — kaynak (tracker çözünürlüğü) piksel uzayında. */
export interface TrackedTarget {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** NESNE modunda COCO sınıfı ('person', 'car'...). Özellik modunda yok. */
  label?: string;
  /** Tespit güveni (0..1) — yalnız nesne modunda. */
  score?: number;
}

export interface TrackerOptions {
  /** Gerçek hesap her N karede bir yapılır (perf). Aradaki karelerde son
   *  bilinen hedefler AYNEN döner (dürüst: "yeni" değil "son"). */
  everyNFrames?: number;
  maxCorners?: number;
  /** En fazla kaç kutu döner (Inspector'daki "Max Targets"). */
  maxTargets?: number;
  /** Bu alanın (px²) altındaki kümeler kutu sayılmaz ("Min Area %"). */
  minArea?: number;
  /** Aynı kümeye ait sayılacak nokta-merkez mesafesi (px). */
  clusterRadius?: number;
  /** Bir kutunun büyüyebileceği en büyük kenar (px). Zincirlemeyi kırar. */
  maxBoxSize?: number;
  /** ID sürekliliği için önceki kareyle eşleştirme mesafe tavanı (px). */
  idMatchRadius?: number;
  /**
   * 'ozellik' = kontrast kümeleri (varsayılan, model gerektirmez).
   * 'nesne'   = COCO nesne tespiti; kutular etiketli gelir.
   */
  mod?: TrackerModu;
  /** Nesne modunda tespit kaç adımda bir koşar (aradaki adımlarda kutuları
   *  akış taşır). Tespit ~100-140 ms; her adımda koşmak tempoyu yer. */
  detectEveryNSteps?: number;
  /** Nesne modunda en fazla kaç tespit tutulur (skora göre). */
  detectMaxCount?: number;
}

export type TrackerModu = 'ozellik' | 'nesne';

export interface DetectionStatus {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
}

/**
 * Varsayılanlar GERÇEK klip üzerinde ölçülerek seçildi
 * (`assets/test-clips/yay-100derece-stgeorge.mp4`, 160×90, 15 fps, 75 kare):
 *
 * | ayar                          | süre/kare | hedef | ID ömrü (medyan) | anlık ID |
 * |-------------------------------|-----------|-------|------------------|----------|
 * | eski (kume 14, idR 24)        |   36.1 ms |    26 |                6 |     %21  |
 * | + fb kapalı, pencere 5, 100 köşe | 7.4 ms |    24 |                5 |     %23  |
 * | + kume 28, idR 40 (BUGÜNKÜ)   |    7.4 ms |    11 |                6 |     %21  |
 *
 * Üç karar: (1) **4.9× hız** — HUD ana iş parçacığında koşuyor, 36 ms her
 * 3. karede görünür takılma demekti. (2) **kümeleme yarıçapı 14 → 28**:
 * 26 kutu görsel gürültüydü, 11 kutu aranan "Tracker" estetiği.
 * (3) **ID eşleşme yarıçapı 24 → 40**: kutular büyüyünce kare arası yer
 * değişimi de büyüdü, 24 px dar kalıyordu — ID ömrü 3 → 6 kareye çıktı.
 *
 * Ölçülüp REDDEDİLENLER (fark üretmedi, değiştirilmedi): piramit 4 → 2 ve
 * iterasyon 10 → 5 — ikisi de süreyi hiç değiştirmedi (LK zaten eşikte
 * yakınsıyor, üst piramit seviyeleri 20×11 px'te neredeyse bedava).
 *
 * ── KUTU TAVANI TURU (bildirilen "kutular saçma yerlerde" hatası) ────────
 * Kök neden `clusterPoints`'te belgeli: zincirleme kümeleme. Tavan (18 px)
 * eklendikten sonra, ÜÇ gerçek klipte 128×72'de ölçüm:
 *
 * | klip            | tavansız: en büyük kutu / ID ömrü | tavanlı: kutu / ID ömrü |
 * |-----------------|-----------------------------------|--------------------------|
 * | stgeorge        |  103 px / 4 kare                  |  ≤26 px / 11 kare        |
 * | mariatheresa    |   98 px / 7 kare                  |  ≤26 px /  8 kare        |
 * | NYC yürüyüş     |   84 px / 4 kare                  |  ≤26 px /  7 kare        |
 *
 * Tavan yalnız yeri düzeltmedi, KARARLILIĞI da düzeltti: dev kutunun
 * merkezi her karede noktalar girip çıktıkça oynuyor, ID kopuyordu; yerel
 * kutu sabit duruyor. En uzun yaşayan ID artık üç klipte de 74 karenin
 * tamamı boyunca hayatta. Tarayıcıda hizalama: kutu merkezlerinin 61/61'i
 * (%100) içeriğin üstünde.
 *
 * `maxTargets` 32 → 20: tavan kutuları böldüğü için sayı 26-32'ye çıkıyordu;
 * görsel kalabalığı sınır bu kolda tutulur (overlay'in kendi "max" slider'ı
 * ayrıca kullanıcı tarafında daraltabilir).
 */
export const TRACKER_DEFAULTS: Required<TrackerOptions> = {
  everyNFrames: 3,
  maxCorners: 100,
  maxTargets: 20,
  minArea: 16,
  // Yarıçaplar çözünürlükle birlikte ölçeklendi (160→128, ×0.8): 28→22, 40→32.
  // Ölçeklenmezlerse aynı piksel yarıçapı küçülen karede GÖRECELİ olarak
  // büyür, kümeler gereğinden fazla birleşir.
  clusterRadius: 22,
  idMatchRadius: 32,
  maxBoxSize: 18,
  mod: 'ozellik',
  // ~10 adım × everyNFrames(3) ≈ 30 kare ≈ saniyede bir tespit. Aradaki
  // kutuları akış taşır, yani HUD 60 Hz akıcı kalırken model seyrek koşar.
  detectEveryNSteps: 10,
  detectMaxCount: 20,
};

/**
 * Nokta kümelerini greedy şekilde birleştirir (tek geçiş, O(n·k)). Her
 * kümenin merkezi eklenen son noktanın konumuna göre güncellenir — kesin
 * centroid değil ama HUD kutusu için yeterli, ekstra geçiş gerektirmez.
 *
 * KUTU BOYUTU TAVANI (`maxBoxSize`) ZİNCİRLEMEYİ KIRAR. Tek-bağlantı
 * kümeleme geçişlidir: A–B yakın, B–C yakın ise A ile C aynı kutuya girer.
 * Noktalar kareye yayıldığında (çizilen kare tam da böyledir) her şey TEK
 * kutuda birleşiyordu; o kutunun merkezi bütün noktaların ortalamasıdır,
 * yani genellikle BOŞLUĞA denk gelir — bildirilen "kutular saçma yerlerde"
 * hatasının kök nedeni buydu. Ölçüldü (çizilen kare, 14 izlenen nokta):
 * tavansız 1 kutu 32×40 (karenin üçte biri) · tavan 12 → 5 kutu, en büyüğü
 * 20×20 · tavan 8 → 9 kutu, en büyüğü 15×15.
 */
function clusterPoints(
  points: { x: number; y: number }[],
  radius: number,
  maxBoxSize: number,
): { minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number }[] {
  const r2 = radius * radius;
  const clusters: { minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number }[] = [];
  for (const p of points) {
    let hit = -1;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      const dx = c.cx - p.x;
      const dy = c.cy - p.y;
      if (dx * dx + dy * dy > r2) continue;
      // Nokta bu kümeye girerse kutu tavanı aşıyor mu? Aşıyorsa küme
      // BÜYÜMEZ; nokta kendi kümesini kurar (zincir burada kırılır).
      if (Math.max(c.maxX, p.x) - Math.min(c.minX, p.x) > maxBoxSize) continue;
      if (Math.max(c.maxY, p.y) - Math.min(c.minY, p.y) > maxBoxSize) continue;
      hit = i;
      break;
    }
    if (hit === -1) {
      clusters.push({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y, cx: p.x, cy: p.y });
    } else {
      const c = clusters[hit];
      c.minX = Math.min(c.minX, p.x);
      c.minY = Math.min(c.minY, p.y);
      c.maxX = Math.max(c.maxX, p.x);
      c.maxY = Math.max(c.maxY, p.y);
      c.cx = (c.cx + p.x) / 2;
      c.cy = (c.cy + p.y) / 2;
    }
  }
  return clusters;
}

/** İzlenen akış noktalarından hedef kutuları kurar: kümele → min-alan
 *  filtrele → büyükten küçüğe sırala/kırp → önceki karenin ID'lerini
 *  en-yakın-merkeze göre devral (yoksa yeni ID).
 *
 *  DIŞA AÇIK ve DOM'SUZ: kare yakalama (canvas) `Tracker` sınıfında kalır,
 *  karar mantığı burada — Node'dan gerçek klip kareleriyle çalıştırılabilsin
 *  (tarayıcı gerektirmeden ölçüm). */
export function targetsFromFlow(
  flow: FlowPoint[],
  prev: TrackedTarget[],
  opts: Required<TrackerOptions>,
  nextId: () => number,
): TrackedTarget[] {
  // Kümeleme "current" konumunda çalışır (x+u, y+v) — kutunun ekranda
  // göründüğü yer, akışın başladığı yer değil.
  const pts = flow.map((p) => ({ x: p.x + p.u, y: p.y + p.v }));
  const clusters = clusterPoints(pts, opts.clusterRadius, opts.maxBoxSize);

  const PAD = 4; // tek nokta bile görünür bir kutu alsın
  const boxes = clusters
    .map((c) => ({
      x: c.minX - PAD,
      y: c.minY - PAD,
      w: c.maxX - c.minX + PAD * 2,
      h: c.maxY - c.minY + PAD * 2,
    }))
    .filter((b) => b.w * b.h >= opts.minArea)
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, opts.maxTargets);

  // ponytail: ID devamlılığı tek kare geriye bakar (histerezis yok). Ölçülen
  // kalan titreme: ID'lerin ~%20-27'si tek karelik (iki gerçek klipte 18/86 ve
  // 25/91). Sebep greedy kümelemenin kare arası bölünüp birleşmesi. Gerekirse
  // yükseltme yolu: eşleşmeyen hedefi 2-3 kare "hayalet" tutmak ya da
  // kümelemeyi ızgara tabanlı/kararlı tohumlu yapmak.
  const usedPrev = new Set<number>();
  const r2 = opts.idMatchRadius * opts.idMatchRadius;
  return boxes.map((b) => {
    const bcx = b.x + b.w / 2;
    const bcy = b.y + b.h / 2;
    let bestId = -1;
    let bestDist = Infinity;
    for (const p of prev) {
      if (usedPrev.has(p.id)) continue;
      const pcx = p.x + p.w / 2;
      const pcy = p.y + p.h / 2;
      const dx = pcx - bcx;
      const dy = pcy - bcy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2 && d2 < bestDist) {
        bestDist = d2;
        bestId = p.id;
      }
    }
    if (bestId === -1) bestId = nextId();
    else usedPrev.add(bestId);
    return { id: bestId, ...b };
  });
}

/**
 * Kutuyu İÇİNDEKİ akış noktalarının MEDYAN kaymasıyla taşır.
 *
 * Medyan, ortalama değil: kutunun içine düşen noktaların bir kısmı arka
 * plana (nesnenin yanından görünen duvar, zemin) aittir ve onların akışı
 * nesneninkinden farklıdır. Ortalama bu aykırı değerlerle sürüklenir,
 * medyan çoğunluğu izler.
 *
 * İçinde izlenen nokta YOKSA kutu OLDUĞU YERDE kalır — uydurma hareket
 * üretmek, kutuyu yanlış yere götürmekten daha kötüdür (HUD yalan söyler).
 */
export function moveBoxWithFlow(hedef: TrackedTarget, flow: FlowPoint[]): TrackedTarget {
  const us: number[] = [];
  const vs: number[] = [];
  for (const p of flow) {
    if (p.x < hedef.x || p.x > hedef.x + hedef.w) continue;
    if (p.y < hedef.y || p.y > hedef.y + hedef.h) continue;
    us.push(p.u);
    vs.push(p.v);
  }
  if (us.length === 0) return hedef;
  us.sort((a, b) => a - b);
  vs.sort((a, b) => a - b);
  const du = us[Math.floor(us.length / 2)];
  const dv = vs[Math.floor(vs.length / 2)];
  return { ...hedef, x: hedef.x + du, y: hedef.y + dv };
}

/** İki kutunun kesişim/birleşim oranı — tespit↔mevcut hedef eşleştirmesi. */
function iou(a: TrackedTarget, b: TrackedTarget): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return 0;
  const kesisim = (x1 - x0) * (y1 - y0);
  return kesisim / (a.w * a.h + b.w * b.h - kesisim);
}

/** Yeni tespitleri mevcut hedeflerle eşleştirip ID'leri devreder.
 *  Eşleşme koşulu: AYNI SINIF ve IoU eşik üstü — sınıf kontrolü olmadan
 *  üst üste binen bir insan ve bisiklet birbirinin ID'sini çalardı. */
function tespitleriEsle(
  yeni: TrackedTarget[],
  onceki: TrackedTarget[],
  nextId: () => number,
  iouEsik = 0.3,
): TrackedTarget[] {
  const kullanilan = new Set<number>();
  return yeni.map((t) => {
    let enIyi = -1;
    let enIyiSkor = iouEsik;
    for (const p of onceki) {
      if (kullanilan.has(p.id) || p.label !== t.label) continue;
      const s = iou(t, p);
      if (s >= enIyiSkor) {
        enIyiSkor = s;
        enIyi = p.id;
      }
    }
    if (enIyi === -1) return { ...t, id: nextId() };
    kullanilan.add(enIyi);
    return { ...t, id: enIyi };
  });
}

/** Bir canlı kaynağın (kamera/video) izleme durumunu tutar. Her `step`
 *  çağrısı en fazla bir gerçek optik akış hesabı yapar (throttle). */
export class Tracker {
  private opts: Required<TrackerOptions>;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D | null;
  private prevLum: Float32Array | null = null;
  private frameCount = 0;
  private nextIdCounter = 1;
  private lastTargets: TrackedTarget[] = [];
  /** NESNE modu: tespit için ayrı, daha büyük yakalama tuvali. Tracker'ın
   *  kendi 128×72'si akış için yeterli ama model için çok küçük. */
  private detectCanvas: HTMLCanvasElement | null = null;
  private detectCtx: CanvasRenderingContext2D | null = null;
  private detectPending = false;
  private detectModelReady = false;
  private detectCaptureStep = -1;
  private detectFlows: FlowPoint[][] = [];
  private detectionStatus: DetectionStatus = { phase: 'idle', error: null };
  private stepSayaci = 0;
  /** Kaynak değişince uçuşta olan tespit sonucu YOK sayılsın diye. */
  private nesil = 0;

  constructor(opts: TrackerOptions = {}) {
    this.opts = { ...TRACKER_DEFAULTS, ...opts };
    this.canvas.width = TRACKER_WIDTH;
    this.canvas.height = TRACKER_HEIGHT;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /** Mod çalışma anında değişebilir (UI seçici). Hedefler sıfırlanır:
   *  iki modun kutuları farklı anlam taşır, karıştırmak yalan olurdu. */
  setMod(mod: TrackerModu): void {
    if (mod === this.opts.mod) return;
    this.opts = { ...this.opts, mod };
    this.lastTargets = [];
    this.stepSayaci = 0;
    this.detectCaptureStep = -1;
    this.detectFlows = [];
    this.detectionStatus = { phase: 'idle', error: null };
    this.nesil++;
  }

  get mod(): TrackerModu {
    return this.opts.mod;
  }

  get status(): DetectionStatus {
    return this.detectionStatus;
  }

  get generation(): number {
    return this.nesil;
  }

  /** Kaynak değiştiğinde (kamera açıldı/kapandı, video değişti) çağrılır —
   *  eski karenin ID'leri yeni kaynağa sızmasın. */
  reset(): void {
    this.prevLum = null;
    this.lastTargets = [];
    this.frameCount = 0;
    this.stepSayaci = 0;
    this.detectCaptureStep = -1;
    this.detectFlows = [];
    this.detectionStatus = { phase: 'idle', error: null };
    // Uçuştaki tespit eski kaynağa aittir; sonucu gelince atılsın.
    this.nesil++;
  }

  /** TRACKER_WIDTH×HEIGHT piksel uzayında hedefler döner. Tüketici
   *  (TrackerOverlay) kendi görüntülenen genişlik/yüksekliğine ölçekler. */
  step(source: HTMLVideoElement | HTMLCanvasElement): TrackedTarget[] {
    this.frameCount++;
    if (this.frameCount % this.opts.everyNFrames !== 0) return this.lastTargets;
    if (!this.ctx) return this.lastTargets;
    if (source instanceof HTMLVideoElement && source.readyState < 2) return this.lastTargets;

    const w = TRACKER_WIDTH;
    const h = TRACKER_HEIGHT;
    this.ctx.drawImage(source, 0, 0, w, h);
    const raw = this.ctx.getImageData(0, 0, w, h).data;
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      lum[i] = 0.299 * (raw[i * 4] / 255) + 0.587 * (raw[i * 4 + 1] / 255) + 0.114 * (raw[i * 4 + 2] / 255);
    }

    const prevLum = this.prevLum;
    this.prevLum = lum;
    this.stepSayaci++;
    // Detection needs only one frame. Optical flow still waits for a pair.
    const needsFirstDetection = this.detectionStatus.phase === 'idle' ||
      (this.detectionStatus.phase === 'loading' && this.detectModelReady);
    if (this.opts.mod === 'nesne' &&
      (needsFirstDetection || this.stepSayaci % this.opts.detectEveryNSteps === 0)) {
      this.tespitPlanla(source);
    }
    if (!prevLum) return this.lastTargets; // ilk kare — akış için çift gerekir

    // HUD akış ayarı FÜZYON ayarından AYRI (ölçüldü, yukarıdaki tablo):
    // `fbConsistency` kapalı + `windowRadius` 5 birlikte 36.1 → 11.1 ms.
    // Gerekçe: geri-ileri tutarlılık RANSAC'ın aykırı havuzunu küçültmek
    // için var; HUD'da kötü eşleşmenin bedeli bir karelik yanlış kutudur,
    // görsel olarak fark edilmez. Füzyon yolu (videoPipe) bu ayarı GÖRMEZ.
    const flow = computeOpticalFlow(prevLum, lum, w, h, {
      maxCorners: this.opts.maxCorners,
      fbConsistency: false,
      windowRadius: 5,
    }).filter((p) => p.status === 1);

    if (this.opts.mod === 'nesne') {
      if (this.detectPending && this.detectCaptureStep >= 0 && this.stepSayaci > this.detectCaptureStep) {
        this.detectFlows.push(flow);
      }
      // Kutuların KİMLİĞİ modelden, HAREKETİ akıştan gelir: tespit seyrek
      // (~saniyede bir) koşar, aradaki her adımda kutular akışla taşınır.
      // Böylece HUD model temposuna değil akış temposuna bağlı kalır.
      this.lastTargets = this.lastTargets.map((t) => moveBoxWithFlow(t, flow));
      return this.lastTargets;
    }

    this.lastTargets = targetsFromFlow(flow, this.lastTargets, this.opts, () => this.nextIdCounter++);
    return this.lastTargets;
  }

  /**
   * Tespiti ARKA PLANDA başlatır — `step` senkron kalmalı, yoksa HUD model
   * beklerken donar. Sonuç geldiğinde kutular değiştirilir; o ana kadar
   * mevcut kutular akışla taşınmaya devam eder.
   *
   * Aynı anda tek tespit (`detectPending`): kuyruk birikirse hepsi bayat
   * kare üstünde çalışır ve GPU'yu derinlik modeliyle çekişmeye sokar.
   *
   * `detect.ts` DİNAMİK yüklenir: özellik modunda kalan kullanıcı ML
   * yığınını hiç indirmez (embed.ts'in lazy depth yüklemesiyle aynı ilke).
   */
  private tespitPlanla(source: HTMLVideoElement | HTMLCanvasElement): void {
    if (this.detectPending) return;
    const nesil = this.nesil;
    if (!this.detectModelReady) {
      // Warm the model before capturing a frame; its first load can take seconds.
      this.detectPending = true;
      if (this.detectionStatus.phase === 'idle') {
        this.detectionStatus = { phase: 'loading', error: null };
      }
      void import('./detect.ts')
        .then(({ isitDetectModel }) => isitDetectModel())
        .then(() => { this.detectModelReady = true; })
        .catch((error: unknown) => {
          if (nesil === this.nesil && this.opts.mod === 'nesne') {
            this.detectionStatus = {
              phase: 'error',
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
        .finally(() => { this.detectPending = false; });
      return;
    }
    if (!this.detectCanvas) {
      this.detectCanvas = document.createElement('canvas');
      this.detectCtx = this.detectCanvas.getContext('2d', { willReadFrequently: true });
    }
    const c = this.detectCanvas;
    const ctx = this.detectCtx;
    if (!ctx) return;
    // Tespit tuvali akış tuvalinden BÜYÜK: 128×72'de insan birkaç piksel
    // kalır, model göremez. Kaynağın en-boyu korunur (ezmek kutuları kaydırır).
    const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    if (!(sw > 0) || !(sh > 0)) return;
    const uzun = 384;
    const k = uzun / Math.max(sw, sh);
    const dw = Math.max(1, Math.round(sw * k));
    const dh = Math.max(1, Math.round(sh * k));
    if (c.width !== dw || c.height !== dh) {
      c.width = dw;
      c.height = dh;
    }
    ctx.drawImage(source, 0, 0, dw, dh);

    this.detectPending = true;
    this.detectCaptureStep = this.stepSayaci;
    this.detectFlows = [];
    if (this.detectionStatus.phase === 'idle') {
      this.detectionStatus = { phase: 'loading', error: null };
    }
    void import('./detect.ts')
      .then(({ algila }) => algila(c, { maxCount: this.opts.detectMaxCount }))
      .then((tespitler) => {
        // Kaynak/mod değiştiyse bu sonuç başka bir dünyaya ait.
        if (nesil !== this.nesil || this.opts.mod !== 'nesne') return;
        const olcekX = TRACKER_WIDTH / c.width;
        const olcekY = TRACKER_HEIGHT / c.height;
        const yeni: TrackedTarget[] = tespitler.map((d) => ({
          id: 0, // gerçek ID eşleştirmede verilir
          x: d.x * olcekX,
          y: d.y * olcekY,
          w: d.w * olcekX,
          h: d.h * olcekY,
          label: d.label,
          score: d.score,
        }));
        // Advance boxes through every flow measured while inference was in flight.
        const current = this.detectFlows.reduce(
          (boxes, flow) => boxes.map((box) => moveBoxWithFlow(box, flow)), yeni,
        );
        this.lastTargets = tespitleriEsle(current, this.lastTargets, () => this.nextIdCounter++);
        this.detectionStatus = { phase: 'ready', error: null };
      })
      .catch((error: unknown) => {
        if (nesil !== this.nesil || this.opts.mod !== 'nesne') return;
        // Keep existing boxes while exposing the failure to the HUD.
        this.detectionStatus = {
          phase: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      })
      .finally(() => {
        this.detectCaptureStep = -1;
        this.detectFlows = [];
        this.detectPending = false;
      });
  }
}
