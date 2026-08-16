/**
 * E1.3 — TEK-ÇALIŞMA KİLİDİ testi (videoPipe.buildFusionScene).
 *
 * Kilit: eşzamanlı İKİNCİ koşu REDDEDİLİR (aynı anda iki füzyon yarışı
 * çifte setGaussians/flicker üretir); koşu bitince (başarı veya hata)
 * kilit serbest kalır — sonraki koşu çalışabilir.
 *
 * In-flight koşu, yavaş bir sahte depthProvider ile simüle edilir (D5'te
 * MiDaS'nin gerçek asenkron sözleşmesi — DepthProvider).
 */
import assert from 'node:assert/strict';
import { buildFusionScene, KEYFRAME_HEIGHT, KEYFRAME_WIDTH } from '../src/engine/vision/videoPipe.ts';

const W = KEYFRAME_WIDTH;
const H = KEYFRAME_HEIGHT;

function uniformFrame(v) {
  return { timeMs: 0, lum: new Float32Array(W * H).fill(v), rgb: new Float32Array(W * H * 3).fill(v) };
}

function slowProvider(ms) {
  return async (frame) => {
    await new Promise((r) => setTimeout(r, ms));
    return frame.lum;
  };
}

const frames = [uniformFrame(0.4), uniformFrame(0.6)];

// 1. In-flight koşu varken ikinci koşu reddedilir.
{
  const ilk = buildFusionScene(frames, undefined, { depthProvider: slowProvider(80) });
  let reddedildi = false;
  try {
    await buildFusionScene(frames);
  } catch (err) {
    reddedildi = /zaten calisiyor|tek-run/.test(err.message);
  }
  assert.ok(reddedildi, 'in-flight koşu varken ikinci koşu reddedilmeli');
  const sonuc = await ilk; // ilk koşu normal tamamlanır
  assert.ok(sonuc.data.count >= 0, 'ilk koşu sonuç üretti');
  console.log('[1] in-flight ikinci koşu reddedildi, ilk koşu tamamlandı ✓');
}

// 2. Kilit bitişte serbest: normal koşu sonrası tekrar çalışabilir.
{
  const sonuc = await buildFusionScene(frames);
  assert.ok(sonuc.data.count >= 0, 'kilit serbestken koşu çalıştı');
  console.log('[2] kilit serbest, yeni koşu çalıştı ✓');
}

// 3. HATA durumunda da kilit serbest kalır (try/finally).
{
  let hata = false;
  try {
    await buildFusionScene(frames, undefined, {
      depthProvider: async () => {
        throw new Error('sahte provider hatası');
      },
    });
  } catch {
    hata = true;
  }
  assert.ok(hata, 'başarısız koşu hata fırlatmalı');
  const sonuc = await buildFusionScene(frames);
  assert.ok(sonuc.data.count >= 0, 'hata sonrası kilit serbest — yeni koşu çalıştı');
  console.log('[3] hata sonrası kilit serbest kaldı ✓');
}

console.log('OK tek-çalışma kilidi (E1.3)');