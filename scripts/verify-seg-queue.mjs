/**
 * SEGMENTASYON GPU SIRASI + KURULUM TEKİLLEŞTİRME (review-fixes gorev 1).
 *
 * Bulgu: fotograf segmentasyonu (segmentForeground) paylasilan GPU kuyrugunun
 * (depth.ts gpuSirasinaGir) DISINDA kosuyordu — App.tsx yalniz video yolunu
 * sariyordu (satir ~594). Bir video canli derinlik dongusu surerken fotograf
 * birakilirsa IS-Net kurulumu/cikarimi Depth Anything ile ayni WebGPU
 * cihazinda CAKISIYOR (belgelenen "getBindGroupLayout" / "Buffer was
 * unmapped" cokmesi, depth.ts:88-110). Cozum: her ORT WebGPU isi (kurulum +
 * calistirma) artik segmentation.ts'in ICINDE kuyruga girer — cagiran
 * yerlerin sarmasi gerekmez (App.tsx:594'teki cift sarmalama kaldirildi,
 * kuyruk yeniden girisli degil).
 *
 * loadSegmentationModel de loadDepthModel'in onceRetry/yukleEstimator
 * desenini kullanir: eszamanli cagrilar TEK kuruluma birlesir, basarisiz
 * kurulum sonrasi yeniden denenebilir.
 *
 * ort.InferenceSession.create burada SAHTE bir fonksiyonla degistirilir — bu
 * script kuyruk/tekillestirme SOZLESMESINI kanitlar, gercek modeli DEGIL
 * (gercek model scripts/verify-seg.mjs'de dogrulaniyor, orada duz
 * onnxruntime-web ile ayri bir yol kullanilir). segmentation.ts her alt
 * testte TAZE bir modul ornegi olarak (sorgu dizesiyle) yuklenir — modul
 * seviyesindeki segSession/yukleSession tekil durumu testler arasinda
 * SIZMASIN diye.
 *
 *   node scripts/verify-seg-queue.mjs
 */
import assert from 'node:assert/strict';

// Gereksinim 4: gpuSirasinaGir, navigator.locks VARSA gercek bir Web Lock
// kullanir, YOKSA dogrudan `is()` cagirir (depth.ts:126-129) — ikisinde de
// modul-seviyesi `gpuKuyrugu` zinciri sirayi korur. Bu Node surumu (v24)
// navigator.locks'u gercekten uyguluyor; hangi dal alinirsa alinsin
// asagidaki testler GOZLENEBILIR sirayi dogrular, mekanizmayi degil.
console.log(`navigator.locks: ${typeof navigator !== 'undefined' && navigator.locks ? 'var (gercek Web Lock yolu)' : 'yok (dogrudan cagri yolu)'}`);

const ort = await import('onnxruntime-web/webgpu');
const { gpuSirasinaGir } = await import('../src/depth.ts');

let freshCounter = 0;
function freshSegmentation() {
  freshCounter++;
  // Sorgu dizesi: her cagri TAZE bir modul ornegi getirir (segSession/
  // yukleSession modul-seviyesi durumu bir sonraki alt teste sizmaz).
  return import(`../src/engine/reconstruction/segmentation.ts?verify-seg-queue=${freshCounter}`);
}

// ---------------------------------------------------------------------
// [1] KURULUM paylasilan GPU kuyrugunu bekler: baska bir is kuyrugu
// tutarken loadSegmentationModel oturum olusturmaya BASLAMAZ.
// ---------------------------------------------------------------------
{
  const events = [];
  let releaseHolder;
  const holderGate = new Promise((resolve) => { releaseHolder = resolve; });
  ort.InferenceSession.create = async () => {
    events.push('seg-create-start');
    return { run: async () => ({}) };
  };

  const holderPromise = gpuSirasinaGir(async () => {
    events.push('holder-start');
    await holderGate;
    events.push('holder-end');
  });

  const { loadSegmentationModel } = await freshSegmentation();
  const segPromise = loadSegmentationModel('wasm');

  // Kisa bekleme: kuyruk dogruysa segmentasyon kurulumu HENUZ baslamamis
  // olmali (holder hala tutuyor). Sahte create() ani dondugu icin, kuyruk
  // atlanmis olsaydi bu pencerede 'seg-create-start' zaten gorunurdu.
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(events, ['holder-start'],
    'segmentasyon kurulumu, kuyruktaki onceki is bitmeden BASLAMAMALI');

  releaseHolder();
  await holderPromise;
  await segPromise;
  assert.deepEqual(events, ['holder-start', 'holder-end', 'seg-create-start'],
    'segmentasyon kurulumu ancak kuyruktaki onceki is bitince baslamali');
  console.log('[1] segmentasyon kurulumu paylasilan GPU kuyrugunu bekliyor ✓');
}

// ---------------------------------------------------------------------
// [2] Eszamanli loadSegmentationModel cagrilari TEK oturuma birlesir.
// ---------------------------------------------------------------------
{
  let creates = 0;
  ort.InferenceSession.create = async () => {
    creates++;
    await new Promise((r) => setTimeout(r, 15));
    return { run: async () => ({}), tur: creates };
  };
  const { loadSegmentationModel } = await freshSegmentation();
  const [a, b] = await Promise.all([loadSegmentationModel('wasm'), loadSegmentationModel('wasm')]);
  assert.equal(creates, 1, 'eszamanli cagrilar TEK oturum kurmali');
  assert.equal(a, b, 'eszamanli cagrilar AYNI oturumu almali');
  const c = await loadSegmentationModel('wasm');
  assert.equal(c, a, 'basari sonrasi cagri memoize edilen oturumu doner');
  assert.equal(creates, 1, 'memoize edilen cagri yeniden kurulum tetiklemez');
  console.log('[2] eszamanli kurulum cagrilari tek oturuma birlesti ✓');
}

// ---------------------------------------------------------------------
// [3] Basarisiz kurulumdan sonra yeniden deneme calisir (onceRetry).
// ---------------------------------------------------------------------
{
  let attempts = 0;
  ort.InferenceSession.create = async () => {
    attempts++;
    if (attempts === 1) throw new Error('gecici webgpu kurulum hatasi');
    return { run: async () => ({}) };
  };
  const { loadSegmentationModel } = await freshSegmentation();
  let failed = false;
  try {
    await loadSegmentationModel('wasm');
  } catch {
    failed = true;
  }
  assert.ok(failed, 'ilk kurulum hatasi cagirana firlatilmali');
  assert.equal(attempts, 1, 'ilk cagri loaderi bir kez cagirdi');
  const session = await loadSegmentationModel('wasm');
  assert.ok(session, 'basarisiz kurulumdan sonra yeniden deneme basarili olmali');
  assert.equal(attempts, 2, 'retry: loader ikinci kez cagrildi');
  console.log('[3] basarisiz kurulumdan sonra yeniden deneme ✓');
}

console.log('OK segmentasyon GPU sirasi + kurulum tekillestirme');
