/**
 * E1.4 — DEPTH YÜKLEYİCİ RETRY testi (depth.ts `onceRetry`).
 *
 * Sorun: transformersPromise modül seviyesinde reddedilen promise'i KALICI
 * cache'liyordu — tek seferlik ağ/modül hatası oturumu sonsuza dek bozuyordu.
 * Ayrıca eşzamanlı loadDepthModel çağrıları iki pipeline() edinimi yarıştırıyor
 * (webgpu cihaz kilidi çift edinilir).
 *
 * Sözleşme: (a) ilk çağrı reddederse cache DÜŞER — sonraki çağrı yeniden
 * dener; (b) başarı sonrası cache kalıcıdır; (c) eşzamanlı çağrılar TEK
 * yüklemeye birleşir.
 */
import assert from 'node:assert/strict';
import { onceRetry } from '../src/depth.ts';

// (a) reddedilen ilk çağrı cache'i düşürür → ikinci çağrı yeniden dener.
{
  let kac = 0;
  const yukle = onceRetry(async () => {
    kac++;
    if (kac === 1) throw new Error('gecici yukleme hatasi');
    return 'model';
  });
  let hata = false;
  try {
    await yukle();
  } catch {
    hata = true;
  }
  assert.ok(hata, 'ilk çağrı hata fırlatmalı');
  assert.equal(kac, 1, 'ilk çağrı loaderı bir kez çağırdı');
  const m = await yukle();
  assert.equal(m, 'model', 'ikinci çağrı yeniden denedi ve başardı');
  assert.equal(kac, 2, 'retry: loader ikinci kez çağrıldı');
  const m2 = await yukle();
  assert.equal(m2, 'model');
  assert.equal(kac, 2, 'başarı sonrası cache: loader tekrar çağrılmaz');
  console.log('[1] hata sonrası retry + başarı sonrası kalıcı cache ✓');
}

// (b) eşzamanlı çağrılar tek yüklemeye birleşir (device lock çift edinilmez).
{
  let kac = 0;
  const yukle = onceRetry(async () => {
    kac++;
    await new Promise((r) => setTimeout(r, 30));
    return `model-${kac}`;
  });
  const [a, b] = await Promise.all([yukle(), yukle()]);
  assert.equal(a, b, 'iki çağrı aynı sonucu aldı');
  assert.equal(kac, 1, 'tek pipeline yüklendi');
  console.log('[2] eşzamanlı çağrılar tek yüklemeye birleşti ✓');
}

// (c) başarı sonrası ardışık çağrılar önbellekten döner.
{
  let kac = 0;
  const yukle = onceRetry(async () => {
    kac++;
    return 42;
  });
  await yukle();
  await yukle();
  await yukle();
  assert.equal(kac, 1, 'ardışık çağrılar cacheten döndü');
  console.log('[3] ardışık çağrılar cacheten ✓');
}

console.log('OK depth retry (E1.4)');