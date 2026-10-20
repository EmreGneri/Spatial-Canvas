// OYNATIRKEN SUNULAN HER KALİTE AYARI CANLI OLMALI.
//
// ── BULUNAN KUSUR (ölçüldü, 2026-09-09) ────────────────────────────────────
// Canlı video kalite seçicisi üç girdi boyutu sunuyor. Ölçülen kare başına
// çıkarım süreleri:
//
//   154 → 128–330 ms   (3.0–7.8 Hz)
//   252 → 677 ms       (1.5 Hz)
//   378 → 1877 ms      (0.53 Hz)
//
// 378'de derinlik saniyede bir kereden AZ güncelleniyor: video oynarken
// geometri kullanıcının gördüğü kareden sürekli ~2 saniye geride kalıyor.
// Bu "daha yavaş bir seçenek" değil, oynatma için ÇALIŞMAYAN bir seçenek —
// menüde çalışmayan bir şey sunulmamalı.
//
// ── SEÇİM İLKESİ (sayıdan önce) ────────────────────────────────────────────
// Canlı bir ayar, video OYNARKEN saniyede en az bir derinlik güncellemesi
// üretmelidir. Bunun altında geometri gösterilen kareyi takip etmez ve mod
// "canlı" olmaktan çıkar. Ölçüme göre bu koşulu 154 (≥3.0 Hz) ve 252 (1.5 Hz)
// sağlıyor, 378 (0.53 Hz) sağlamıyor → oynatma tavanı 252.
//
// DURAKLATILMIŞ karede tavan YOKTUR: tek kare için 1877 ms kabul edilebilir
// bir bekleme ve yüksek detay tam da orada anlamlı. Seçenek silinmiyor,
// bağlamına taşınıyor.
//
//   node scripts/verify-canli-kalite-tavani.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./ts-extension-loader.mjs', import.meta.url);

const { LIVE_INPUT_SIZE, LIVE_PLAYBACK_MAX_INPUT, canliGirdiBoyutu } =
  await import('../src/engine/vision/liveDepth.ts');

// Ölçülen kare süreleri (ms) — kapının dayanağı.
const OLCUM = { 154: 330, 252: 677, 378: 1877 }; // 154 için EN KÖTÜ değer alındı
const CANLI_MIN_HZ = 1;

// ---------------------------------------------------------------------------
// [1] TAVAN ÖLÇÜMDEN TÜRÜYOR — sabit keyfi değil.
// ---------------------------------------------------------------------------
{
  for (const [boyut, ms] of Object.entries(OLCUM)) {
    const hz = 1000 / ms;
    const canliMi = Number(boyut) <= LIVE_PLAYBACK_MAX_INPUT;
    console.log(`[1] ${boyut} → ${ms} ms = ${hz.toFixed(2)} Hz · oynatmada ${canliMi ? 'İZİNLİ' : 'kapalı'}`);
    assert.equal(
      canliMi,
      hz >= CANLI_MIN_HZ,
      `${boyut} için tavan kararı ölçümle çelişiyor (${hz.toFixed(2)} Hz, taban ${CANLI_MIN_HZ} Hz)`,
    );
  }
}

// ---------------------------------------------------------------------------
// [2] OYNARKEN tavan uygulanır, DURAKLATILMIŞKEN uygulanmaz.
// ---------------------------------------------------------------------------
{
  assert.equal(canliGirdiBoyutu(378, false), LIVE_PLAYBACK_MAX_INPUT, 'oynarken tavan uygulanmıyor');
  assert.equal(canliGirdiBoyutu(378, true), 378, 'duraklatılmış karede tavan uygulanmamalı');
  assert.equal(canliGirdiBoyutu(252, false), 252, 'tavanın altındaki seçim düşürülmemeli');
  assert.equal(canliGirdiBoyutu(154, false), 154, 'en hızlı seçim değiştirilmemeli');
  assert.equal(canliGirdiBoyutu(154, true), 154, 'duraklatınca seçim YÜKSELTİLMEMELİ');
  console.log(`[2] oynarken 378 → ${LIVE_PLAYBACK_MAX_INPUT} · duraklatınca 378 → 378 ✓`);
}

// ---------------------------------------------------------------------------
// [3] VARSAYILAN zaten canlı — tavan varsayılanı değiştirmemeli.
// ---------------------------------------------------------------------------
{
  assert.ok(
    LIVE_INPUT_SIZE <= LIVE_PLAYBACK_MAX_INPUT,
    `varsayılan girdi (${LIVE_INPUT_SIZE}) oynatma tavanının üstünde`,
  );
  assert.equal(canliGirdiBoyutu(LIVE_INPUT_SIZE, false), LIVE_INPUT_SIZE);
  console.log(`[3] varsayılan ${LIVE_INPUT_SIZE} tavanın altında, dokunulmuyor ✓`);
}

// ---------------------------------------------------------------------------
// [4] BOZUK GİRDİ sessizce geçmemeli.
// ---------------------------------------------------------------------------
{
  assert.equal(canliGirdiBoyutu(Number.NaN, false), LIVE_INPUT_SIZE, 'NaN varsayılana düşmeli');
  assert.equal(canliGirdiBoyutu(0, false), LIVE_INPUT_SIZE, 'sıfır varsayılana düşmeli');
  assert.equal(canliGirdiBoyutu(-5, true), LIVE_INPUT_SIZE, 'negatif varsayılana düşmeli');
  console.log('[4] geçersiz boyut varsayılana düşüyor ✓');
}

console.log('OK canlı kalite tavanı — oynatmada yalnız gerçekten canlı ayarlar, duraklatınca tam detay');
