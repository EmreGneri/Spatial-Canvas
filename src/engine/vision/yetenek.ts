// YETENEK RAPORU — E2. Tarayıcı neyi çalıştırabiliyor, neyi çalıştıramıyor
// ve ÇALIŞTIRAMIYORSA SEBEBİ NE.
//
// NEDEN VAR: WebGPU yoksa canlı derinlik sessizce parlaklık vekiline
// düşüyordu (parlak = yakın). Kullanıcı ekranda "mush" görüyor ama sebebini
// bilmiyor; bunun adı sessiz bozulmadır ve projenin dürüstlük kuralına
// aykırıdır. Rapor tek yerden üretilir, arayüz onu gösterir.
import { webgpuKullanilabilir } from '../../depth.ts';
import { liveDepthKullanilabilir } from './liveDepth.ts';

export interface YetenekRaporu {
  /** WebGPU bağdaştırıcısı alınabiliyor mu. */
  webgpu: boolean;
  /** Canlı video derinliği (model) çalışabilir mi. */
  canliDerinlik: 'acik' | 'kapali';
  /** Nesne tespiti (COCO) çalışabilir mi. */
  tespit: 'acik' | 'kapali';
  /** Kapalı olan varsa insan diliyle sebebi; her şey açıksa null. */
  sebep: string | null;
}

/**
 * Oturum başına TEK ölçüm: `requestAdapter` tarayıcı ömrü boyunca aynı
 * cevabı verir, her sorguda yeniden adapter istemenin karşılığı yok.
 */
let onbellek: Promise<YetenekRaporu> | null = null;

export function yetenekRaporu(): Promise<YetenekRaporu> {
  if (!onbellek) onbellek = olc();
  return onbellek;
}

/** Yalnız test içindir: önbelleği düşürür. */
export function yetenekOnbelleginiSifirla(): void {
  onbellek = null;
}

async function olc(): Promise<YetenekRaporu> {
  const webgpu = await webgpuKullanilabilir();
  // Canlı derinlik sidecar üzerinden de açılabilir (WebGPU'suz yol), o yüzden
  // ayrı sorulur — WebGPU'dan türetilmez.
  const canli = (await liveDepthKullanilabilir()) ? 'acik' : 'kapali';
  // Tespit yalnız WebGPU yolunda koşar: wasm'da ölçülen süre canlı kullanımı
  // taşımıyor (bkz. detect.ts başlığı).
  const tespit = webgpu ? 'acik' : 'kapali';

  let sebep: string | null = null;
  if (!webgpu && canli === 'kapali') {
    sebep =
      'Tarayıcın WebGPU desteklemiyor: canlı video derinliği kapalı '
      + '(parlaklık vekili çalışır, gerçek geometri değildir) ve nesne tespiti kapalı. '
      + 'Chrome/Edge güncel sürümde açılır.';
  } else if (!webgpu) {
    sebep =
      'WebGPU yok: nesne tespiti kapalı. Canlı derinlik yerel çıkarım '
      + 'üzerinden çalışıyor.';
  } else if (canli === 'kapali') {
    sebep = 'WebGPU var ama canlı derinlik açılamadı.';
  }
  return { webgpu, canliDerinlik: canli, tespit, sebep };
}
