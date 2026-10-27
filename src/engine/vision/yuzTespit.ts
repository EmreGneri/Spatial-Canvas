import { currentPhotoMeasurement } from '../photoMeasurement.ts';
import { onceRetry } from '../../depth.ts';

// MediaPipe normalize: x,y 0..1 (y aşağı), z x ile aynı ölçek, küçük = kameraya yakın.
export interface YuzNoktasi { x: number; y: number; z: number }
export interface YuzSonucu { noktalar: YuzNoktasi[]; genislik: number; yukseklik: number; sureMs: number }

type Tespitci = import('@mediapipe/tasks-vision').FaceLandmarker;

// depth.ts ile aynı desen: dev'de node_modules (Vite dönüştürme hattı),
// prod'da public/ içinden kopyalanan /mediapipe-wasm.
const VITE_DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
const WASM_TABANI = VITE_DEV ? '/node_modules/@mediapipe/tasks-vision/wasm' : '/mediapipe-wasm';

// Paket dinamik import: yüz özelliği kullanılmazsa ana paket şişmesin.
// Başarısız olursa onceRetry önbelleği düşürür, sonraki çağrı yeniden dener.
const tespitciYukle = onceRetry<Tespitci>(async () => {
  const trace = currentPhotoMeasurement();
  const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision');
  const wasm = await FilesetResolver.forVisionTasks(WASM_TABANI);
  const olustur = (delegate: 'GPU' | 'CPU') => {
    const run = () => FaceLandmarker.createFromOptions(wasm, {
      baseOptions: { modelAssetPath: '/models/mediapipe/face_landmarker.task', delegate },
      runningMode: 'IMAGE',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    return trace ? trace.measure(`face.create.${delegate.toLowerCase()}`, run) : run();
  };
  // GPU temsilcisi bazı sürücülerde kurulamaz; CPU yavaş ama çalışır.
  return olustur('GPU').catch(() => olustur('CPU'));
});

let uyarildi = false;
const uyar = (neden: unknown) => {
  if (uyarildi) return; // her karede log basmasın
  uyarildi = true;
  console.warn('[yuzTespit]', neden);
};

/** İlk yüzün tüm landmark'ları; yüz yoksa ya da hata varsa null (asla fırlatmaz). */
export async function yuzNoktalari(kaynak: HTMLCanvasElement | HTMLImageElement): Promise<YuzSonucu | null> {
  const trace = currentPhotoMeasurement();
  try {
    const t0 = performance.now();
    const tespitci = await tespitciYukle();
    const sonuc = trace ? trace.measureSync('face.detect', () => tespitci.detect(kaynak)) : tespitci.detect(kaynak);
    const yuz = sonuc.faceLandmarks[0];
    if (!yuz?.length) { uyar('yüz bulunamadı'); return null; }
    const genislik = kaynak instanceof HTMLImageElement ? kaynak.naturalWidth : kaynak.width;
    const yukseklik = kaynak instanceof HTMLImageElement ? kaynak.naturalHeight : kaynak.height;
    return {
      noktalar: yuz.map(({ x, y, z }) => ({ x, y, z })),
      genislik, yukseklik,
      sureMs: performance.now() - t0,
    };
  } catch (e) {
    uyar(e);
    return null;
  }
}
