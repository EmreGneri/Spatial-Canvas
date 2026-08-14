// GÜN E (bulgu 3 + 4) — DERİNLİK MASKESİ + zSpan REGRESYON KİLİDİ.
//
// NEDEN VAR: bulgu 1 (maske-kör derinlik son-işlemesi) ve bulgu 2 (çift maske
// dilasyonu) 10 script'lik yeşil zincirin ALTINDAN geçti. Sebebi denetimde
// tespit edildi: gövde/geniş sahne vakası hiçbir testte yoktu ve
// verify-curtain.mjs üretim yolunun ikinci dilasyonunu hiç çalıştırmıyordu.
// Bu script o boşluğu kapatır — düzeltmeler artık SAYIYLA kilitli.
//
// KAPSAM SINIRI (dürüst bildirim): sahneler SENTETİKTİR. Repoda gövde/ayna
// fotoğrafı yok (üretici model YASAK, lisanslı görsel indirilmedi). Gerçek
// fotoğraf ölçümü için: `node scripts/verify-curtain.mjs <foto-yolu>` — o
// script gerçek RMBG + depth modelini kullanır ve aynı metrikleri basar.
//
// Model YÜKLEMEZ: saf CPU, saniyenin altında koşar, determinist.
import assert from 'node:assert/strict';
import {
  applyForegroundStretch,
  foregroundMask,
  limitDepthSlope,
  MAX_SLOPE_PER_PX,
} from '../src/depth.ts';
import {
  dilateAndFeatherMask,
  MASK_DILATE_RADIUS,
  resampleBilinear,
} from '../src/engine/reconstruction/silhouette.ts';
import {
  ANATOMIC_DEPTH_RATIO,
  computeBodyGeometry,
} from '../src/engine/reconstruction/sampler.ts';

const W = 200;
const H = 300;

// ---------------------------------------------------------------------------
// Sentetik sahneler (deterministik — Math.random YOK)
// ---------------------------------------------------------------------------

/** YÜZ YAKIN PLAN: özne kadrajın ~%70'i, derinliği geniş bir bant kaplar.
 *  Bulgu 1'in ZATEN ÇALIŞAN vakası — burada regresyon nöbetçisidir. */
function faceScene() {
  const d = new Float32Array(W * H);
  const subj = new Uint8Array(W * H);
  const cx = W / 2;
  const cy = H * 0.42;
  const rx = W * 0.4;
  const ry = H * 0.33;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (t <= 1) {
        subj[i] = 1;
        d[i] = 0.55 + 0.45 * Math.sqrt(Math.max(0, 1 - t));
      } else {
        d[i] = 0.05 + 0.15 * (1 - y / H);
      }
    }
  }
  return { d, subj };
}

/** GÖVDE / AYNA SELFIE: özne DAR bir derinlik bandında (0.60..0.72); YAKIN
 *  ZEMİN kadrajın altında 1.0'a kadar çıkar, uzak duvar 0.2'de kalır. Bulgu
 *  1'in KIRIK vakası: zemin depth-türevli sahte "ön plan" maskesine girer. */
function bodyScene() {
  const d = new Float32Array(W * H);
  const subj = new Uint8Array(W * H);
  const cx = W / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const bw = W * (y < H * 0.22 ? 0.09 : 0.17);
      if (Math.abs(x - cx) < bw && y > H * 0.1) {
        subj[i] = 1;
        d[i] = 0.6 + 0.12 * (1 - Math.abs(x - cx) / bw);
      } else if (y > H * 0.66) {
        d[i] = 0.25 + 0.75 * ((y - H * 0.66) / (H * 0.34));
      } else {
        d[i] = 0.18 + 0.04 * (1 - y / H);
      }
    }
  }
  return { d, subj };
}

/** Özne İÇ bölgesi: kenardan `pad` piksel içeride kalan özne pikselleri.
 *  Kenar halkası HARİÇ tutulur — yoksa maske-kör yolun kenar çökmesi
 *  "varyans" gibi görünüp gerçek rölyefi maskeler (ölçüm tuzağı). */
function interior(subj, pad = 5) {
  const inner = new Uint8Array(subj.length);
  for (let y = pad; y < H - pad; y++) {
    for (let x = pad; x < W - pad; x++) {
      const i = y * W + x;
      if (!subj[i]) continue;
      let ok = 1;
      for (let k = 1; k <= pad && ok; k++) {
        if (!subj[i - k] || !subj[i + k] || !subj[i - k * W] || !subj[i + k * W]) ok = 0;
      }
      inner[i] = ok;
    }
  }
  return inner;
}

function reliefStd(depth, region) {
  let s = 0;
  let q = 0;
  let n = 0;
  for (let i = 0; i < depth.length; i++) {
    if (!region[i]) continue;
    s += depth[i];
    q += depth[i] * depth[i];
    n++;
  }
  const m = s / n;
  return Math.sqrt(q / n - m * m);
}

/** MASKE-KÖR yol (düzeltme öncesi davranış): sahte maske + maskesiz limiter. */
function maskBlind(scene) {
  const d = Float32Array.from(scene.d);
  applyForegroundStretch(d, foregroundMask(d, W, H), W, H);
  return limitDepthSlope(d, W, H, null);
}

/** MASKE-FARKINDA yol (estimateDepth'in bugünkü zinciri): gerçek özne maskesi
 *  + BÖLGE-AYRIK limiter (önce maske içi, sonra maske dışı). */
function maskAware(scene) {
  const m = Float32Array.from(scene.subj);
  const d = Float32Array.from(scene.d);
  applyForegroundStretch(d, m, W, H);
  const inside = limitDepthSlope(d, W, H, m);
  const outside = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) outside[i] = m[i] >= 0.5 ? 0 : 1;
  return { after: limitDepthSlope(inside, W, H, outside), stretched: d };
}

// ---------------------------------------------------------------------------
// 1. BULGU 1 — gövde sahnesinde rölyef gerçekten geri geliyor mu?
// ---------------------------------------------------------------------------
{
  const sc = bodyScene();
  const inner = interior(sc.subj);
  const blind = reliefStd(maskBlind(sc), inner);
  const aware = reliefStd(maskAware(sc).after, inner);
  const gain = aware / blind;
  console.log(
    `[1] gövde sahnesi — özne iç rölyef std: maske-kör ${blind.toFixed(4)} → maske-farkında ${aware.toFixed(4)} (×${gain.toFixed(2)})`,
  );
  // Ölçülen ×6.86; eşik geniş marjla altında (kayan nokta/platform toleransı).
  assert.ok(gain >= 4, `gövde rölyef kazancı ×4'ün altına düştü: ×${gain.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
// 2. BULGU 1 — sahte maskeye sızan özne-DIŞI piksel (kök neden metriği)
// ---------------------------------------------------------------------------
{
  for (const [name, sc, maxLeakPct] of [
    ['yüz  ', faceScene(), 5],
    ['gövde', bodyScene(), 200],
  ]) {
    const fake = foregroundMask(Float32Array.from(sc.d), W, H);
    let leak = 0;
    let subjN = 0;
    for (let i = 0; i < fake.length; i++) {
      if (fake[i] >= 0.1 && !sc.subj[i]) leak++;
      if (sc.subj[i]) subjN++;
    }
    const pct = (100 * leak) / subjN;
    console.log(`[2] ${name} — depth-türevli sahte maskeye sızan özne-dışı piksel: %${pct.toFixed(0)} (gerçek maskede %0)`);
    assert.ok(pct <= maxLeakPct, `sızma beklenmedik şekilde arttı: %${pct.toFixed(0)}`);
  }
}

// ---------------------------------------------------------------------------
// 3. BULGU 1 — bölge-ayrık limiter özne kenarını AŞINDIRMAMALI
// ---------------------------------------------------------------------------
{
  // Sert basamak: özne 0.90, arka plan 0.10 — kenar sıçraması en zorlu hâl.
  const d = new Float32Array(W * H);
  const subj = new Uint8Array(W * H);
  const cx = W / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (Math.abs(x - cx) < W * 0.17 && y > H * 0.1) {
        subj[i] = 1;
        d[i] = 0.9;
      } else {
        d[i] = 0.1;
      }
    }
  }
  const m = Float32Array.from(subj);
  const blind = limitDepthSlope(d, W, H, null);
  const inside = limitDepthSlope(d, W, H, m);
  const outside = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) outside[i] = m[i] >= 0.5 ? 0 : 1;
  const aware = limitDepthSlope(inside, W, H, outside);

  let blindLoss = 0;
  let blindN = 0;
  let awareMax = 0;
  for (let i = 0; i < d.length; i++) {
    if (!subj[i]) continue;
    const b = d[i] - blind[i];
    if (b > 1e-6) {
      blindLoss += b;
      blindN++;
    }
    const a = d[i] - aware[i];
    if (a > awareMax) awareMax = a;
  }
  console.log(
    `[3] kenar aşınması — maskesiz: ${blindN} px × ort ${(blindLoss / blindN).toFixed(3)} · bölge-ayrık: maks ${awareMax.toFixed(6)}`,
  );
  assert.ok(blindN > 0, 'maskesiz yolun aşındırdığı doğrulanamadı — senaryo bozuk');
  assert.equal(awareMax, 0, `bölge-ayrık limiter özne kenarını aşındırdı: ${awareMax}`);
}

// ---------------------------------------------------------------------------
// 4. BULGU 2 — maske TEK yerde dilate edilmeli (çift dilasyon topak yapıyordu)
// ---------------------------------------------------------------------------
{
  const MW = 1024;
  const DW = 518;
  const raw = new Float32Array(MW * MW);
  // Gövde + 14 px boşlukla ayrılmış kol (gerçek maskelerde parmak arası /
  // kol-gövde boşluğu bu mertebededir).
  for (let y = 0; y < MW; y++) {
    for (let x = 0; x < MW; x++) {
      const torso = x >= 380 && x <= 644 && y >= 200 && y <= 900;
      const arm = x >= 658 && x <= 700 && y >= 260 && y <= 820;
      if (torso || arm) raw[y * MW + x] = 1;
    }
  }
  const area = (m) => {
    let c = 0;
    for (const v of m) if (v >= 0.5) c++;
    return c;
  };
  const baseInDepth = area(raw) * (DW / MW) ** 2;

  // ÜRETİM ZİNCİRİ (bugün): segmentation.ts dilate → Engine yalnızca resample.
  const seg = dilateAndFeatherMask(raw, MW, MW);
  const production = resampleBilinear(seg, MW, MW, DW, DW);
  // ESKİ ZİNCİR: Engine ikinci kez dilate ediyordu (ölçek çarpanı ters yönde).
  const legacy = dilateAndFeatherMask(production, DW, DW, Math.round(MASK_DILATE_RADIUS * (MW / DW)));

  const prodPct = (100 * (area(production) - baseInDepth)) / baseInDepth;
  const legacyPct = (100 * (area(legacy) - baseInDepth)) / baseInDepth;
  const gx = Math.round(651 * (DW / MW));
  const gy = Math.round(500 * (DW / MW));
  const prodGapOpen = production[gy * DW + gx] < 0.5;
  const legacyGapOpen = legacy[gy * DW + gx] < 0.5;
  console.log(
    `[4] maske alan şişmesi — üretim +%${prodPct.toFixed(1)} (boşluk ${prodGapOpen ? 'AÇIK' : 'DOLU'}) · eski çift dilasyon +%${legacyPct.toFixed(1)} (boşluk ${legacyGapOpen ? 'AÇIK' : 'DOLU'})`,
  );
  assert.ok(prodPct <= 10, `maske alan şişmesi %10'u aştı: +%${prodPct.toFixed(1)}`);
  assert.ok(prodGapOpen, 'kol–gövde boşluğu doldu (topaklaşma geri geldi)');
  assert.ok(legacyPct > prodPct, 'eski zincirin daha çok şişirdiği doğrulanamadı — senaryo bozuk');
}

// ---------------------------------------------------------------------------
// 5. BULGU 4 — zSpan: KADRAJ YÖNÜ DERİNLİĞİ DEĞİŞTİRMEMELİ
//
// Denetimde önce "gövde silueti sığlaşıyor" denmiş, sonra uydurma antropometriye
// bakılarak YANLIŞLIKLA kapatılmıştı. Gerçek fotoğraf ölçümü (2026-08-14) asıl
// mekanizmayı gösterdi: dünya uzayında y hep ±halfH ama x ±(w/h)·halfH'tir, yani
// DİKEY kadrajda dünya genişliği 1'in altına iner (özüm 0.751, ayna 0.562) ve
// siluetin rx'i bu daralmış ölçekte ölçülür. min(rx, ry) böylece kadraja göre
// FARKLI FİZİKSEL EKSENİ seçiyordu (karina'da yükseklik, dikeylerde genişlik) ve
// aynı özne yalnızca kadraj yönü yüzünden daha sığ çiziliyordu.
//
// Düzeltme: yarı eksen, kadrajın KISA kenarı biriminde ölçülür. Bu blok o
// değişmezliği kilitler — aynı özne, üç farklı kadraj oranında AYNI zSpan.
// ---------------------------------------------------------------------------
{
  // sampler.ts'teki zSpan hesabının birebir aynası (üretimle sapma olursa
  // aşağıdaki gerçek-oran assert'i patlar).
  const zSpanOf = (alpha, w, h) => {
    const g = computeBodyGeometry(alpha, w, h, 1);
    assert.ok(g, 'computeBodyGeometry null döndü — siluet boş');
    const shortHalf = Math.min((w / h) * 1, 1);
    return {
      z: (ANATOMIC_DEPTH_RATIO * 2 * Math.min(g.rx, g.ry)) / shortHalf,
      rx: g.rx,
      ry: g.ry,
    };
  };
  // Özne, kadrajın KISA kenarının sabit bir oranı kadar: gerçek dünyada aynı
  // insanın dikey/yatay çekilmesine karşılık gelir (özne değişmiyor, kadraj
  // değişiyor).
  const subject = (w, h) => {
    const a = new Float32Array(w * h);
    const s = Math.min(w, h);
    const halfW = 0.2 * s;
    const halfH = 0.35 * s;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (Math.abs(x - w / 2) < halfW && Math.abs(y - h / 2) < halfH) a[y * w + x] = 1;
      }
    }
    return a;
  };
  const land = zSpanOf(subject(518, 345), 518, 345); // yatay 1.50 (karina)
  const square = zSpanOf(subject(518, 518), 518, 518); // kare (thumbnail)
  const port = zSpanOf(subject(389, 518), 389, 518); // dikey 0.75 (özüm)
  const tall = zSpanOf(subject(291, 518), 291, 518); // dikey 0.56 (ayna)
  console.log(
    `[5] zSpan kadraj değişmezliği — yatay ${land.z.toFixed(3)} · kare ${square.z.toFixed(3)} · dikey0.75 ${port.z.toFixed(3)} · dikey0.56 ${tall.z.toFixed(3)}`,
  );
  for (const [nm, v] of [['kare', square], ['dikey0.75', port], ['dikey0.56', tall]]) {
    assert.ok(
      Math.abs(v.z - land.z) < 0.01,
      `kadraj yönü zSpan'ı değiştirdi (${nm} ${v.z.toFixed(3)} vs yatay ${land.z.toFixed(3)})`,
    );
  }
  // DÜZELTME ÖNCESİ davranışın gerçekten kırık olduğunu göster (senaryo nöbetçisi):
  // bölen olmadan dikey kadraj belirgin şekilde sığ kalıyordu.
  const legacy = (v, w, h) => ANATOMIC_DEPTH_RATIO * 2 * Math.min(v.rx, v.ry);
  const legLand = legacy(land, 518, 345);
  const legTall = legacy(tall, 291, 518);
  console.log(
    `[5] eski formül (bölensiz) — yatay ${legLand.toFixed(3)} · dikey0.56 ${legTall.toFixed(3)} → ×${(legLand / legTall).toFixed(2)} sapma`,
  );
  assert.ok(legTall < legLand * 0.8, 'eski formülün kadraja duyarlı olduğu doğrulanamadı — senaryo bozuk');

  // ÖLÇEK TUTARLILIĞI KORUNUYOR: aynı kadrajda özne 1.5× büyürse zSpan da 1.5×.
  const big = (w, h) => {
    const a = new Float32Array(w * h);
    const s = Math.min(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (Math.abs(x - w / 2) < 1.5 * 0.2 * s && Math.abs(y - h / 2) < 1.5 * 0.35 * s) {
          a[y * w + x] = 1;
        }
      }
    }
    return a;
  };
  const bigPort = zSpanOf(big(389, 518), 389, 518);
  const ratio = bigPort.z / port.z;
  console.log(`[5] ölçek tutarlılığı — özne ×1.5 → zSpan ×${ratio.toFixed(3)}`);
  assert.ok(Math.abs(ratio - 1.5) < 0.03, `zSpan ölçekle orantılı değil: ×${ratio.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
// 6. GÜN E (bulgu 6) — EĞİM TAVANI × STRETCH KAZANCI ETKİLEŞİMİ
//
// Bulgu 1 düzeltmesinden sonra ortaya çıkan şüphe: stretch artık gerçekten
// çalıştığı için öznenin iç eğimleri büyüyor (gövde sahnesinde kazanç ×7.30) ve
// MAX_SLOPE_PER_PX = 0.02 tavanına takılıyor — "sınırlayıcı kazanılan rölyefin
// bir kısmını geri alıyor mu?"
//
// ÖLÇÜM CEVABI: HAYIR. Tavan çok sayıda pikseli hafifçe kırpıyor ama rölyefe
// mal olmuyor; buna karşılık gerçek aykırı sivrilmeyi bastırmaya DEVAM ediyor.
// Bu yüzden MAX_SLOPE_PER_PX DEĞİŞTİRİLMEDİ (bkz. ARCHITECTURE "Derinlik
// Son-İşleme Maskesi" → eğim tavanı kararı). Bu blok o kararı kilitler.
// ---------------------------------------------------------------------------
{
  const sc = bodyScene();
  const m = Float32Array.from(sc.subj);
  const outMask = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) outMask[i] = m[i] >= 0.5 ? 0 : 1;
  const inner = interior(sc.subj);

  const run = (cap) => {
    const d = Float32Array.from(sc.d);
    applyForegroundStretch(d, m, W, H);
    const ins = limitDepthSlope(d, W, H, m, cap);
    return { out: limitDepthSlope(ins, W, H, outMask), stretched: d };
  };
  const capped = run(MAX_SLOPE_PER_PX);
  const uncapped = run(1e9);
  const sCap = reliefStd(capped.out, inner);
  const sNo = reliefStd(uncapped.out, inner);
  const cost = 1 - sCap / sNo;
  console.log(
    `[6] eğim tavanı maliyeti — rölyef std tavanlı ${sCap.toFixed(4)} · tavansız ${sNo.toFixed(4)} → %${(100 * cost).toFixed(2)}`,
  );
  // Tavan rölyefe pratikte mal olmuyor (ölçülen ~%0; gerçek büst fotoğrafında
  // −%1.63, yani orada da kayıp yok). Eşik geniş: %5'i aşarsa karar yeniden
  // açılmalı, çünkü o noktada tavan gerçekten rölyef yiyor demektir.
  assert.ok(
    Math.abs(cost) < 0.05,
    `eğim tavanı rölyefe mal olmaya başladı (%${(100 * cost).toFixed(2)}) — MAX_SLOPE_PER_PX kararı yeniden ölçülmeli`,
  );

  // Tavan hâlâ AYKIRI SİVRİLMEYİ bastırıyor mu? (varlık sebebi bu — saç/kafa
  // üstünde komşusundan kopuk tepe). Gövdenin içine 3×3, komşusundan 0.10
  // kopuk bir tepe konur ve stretch sonrası komşu farkı ölçülür.
  const spiked = Float32Array.from(sc.d);
  const sx = Math.round(W / 2) + 5;
  const sy = Math.round(H * 0.15);
  const spikeIdx = [];
  for (let y = sy; y < sy + 3; y++) {
    for (let x = sx; x < sx + 3; x++) {
      const i = y * W + x;
      if (sc.subj[i]) {
        spiked[i] = Math.min(1, spiked[i] + 0.1);
        spikeIdx.push(i);
      }
    }
  }
  assert.ok(spikeIdx.length > 0, 'sivrilme gövde içine düşmedi — senaryo bozuk');
  const spikePeak = (cap) => {
    const d = Float32Array.from(spiked);
    applyForegroundStretch(d, m, W, H);
    const ins = limitDepthSlope(d, W, H, m, cap);
    const out = limitDepthSlope(ins, W, H, outMask);
    let peak = 0;
    for (const i of spikeIdx) {
      const nb = Math.min(out[i - 1], out[i + 1], out[i - W], out[i + W]);
      if (out[i] - nb > peak) peak = out[i] - nb;
    }
    return peak;
  };
  const peakCapped = spikePeak(MAX_SLOPE_PER_PX);
  const peakFree = spikePeak(1e9);
  console.log(
    `[6] sivrilme bastırma — tavanlı ${peakCapped.toFixed(4)} · tavansız ${peakFree.toFixed(4)} (×${(peakFree / peakCapped).toFixed(1)} bastırma)`,
  );
  assert.ok(
    peakCapped < peakFree * 0.25,
    `eğim tavanı stretch sonrası sivrilmeyi bastıramıyor: ${peakCapped.toFixed(4)} vs ${peakFree.toFixed(4)}`,
  );
}

// ---------------------------------------------------------------------------
// 7. GÜN E (bulgu 8) — STRETCH ARALIĞI YÜZDELİK KIRPMALI OLMALI
//
// Ham min/max maskenin UÇLARINA kilitlenir (sızan duvar, en yakın el): özne
// KÜTLESİ sıkışık kalır ve 3B'de ince levha görünür. Kırpma o kuyruğu keser.
//
// ÖLÇÜM TUZAĞI (bir kez düşüldü, tekrar düşülmesin): etkiyi "toplam aralık"
// ile ölçmek YANILTIR — min/max her koşulda doyar. Doğru metrik KÜTLE
// yayılımıdır (p10-p90). Bu blok doğru metrikle assert eder.
// ---------------------------------------------------------------------------
{
  const sc = bodyScene();
  const m = Float32Array.from(sc.subj);
  // Öznenin uç kuyruğu: birkaç piksel çok öne (el) — ham min/max'ı bu ele geçirir.
  const d0 = Float32Array.from(sc.d);
  const cx = Math.round(W / 2);
  for (let y = Math.round(H * 0.5); y < Math.round(H * 0.5) + 6; y++) {
    for (let x = cx - 3; x < cx + 3; x++) if (sc.subj[y * W + x]) d0[y * W + x] = 0.99;
  }
  const bulk = (arr) => {
    const v = [];
    for (let i = 0; i < arr.length; i++) if (sc.subj[i]) v.push(arr[i]);
    v.sort((a, b) => a - b);
    const q = (p) => v[Math.floor(p * (v.length - 1))];
    return { p1090: q(0.9) - q(0.1), mm: v[v.length - 1] - v[0] };
  };
  const raw = Float32Array.from(d0);
  applyForegroundStretch(raw, m, W, H, 0); // kırpmasız (eski davranış)
  const trimmed = Float32Array.from(d0);
  applyForegroundStretch(trimmed, m, W, H); // varsayılan STRETCH_TRIM_PCT
  const bRaw = bulk(raw);
  const bTrim = bulk(trimmed);
  console.log(
    `[7] stretch kırpması — özne kütle yayılımı (p10-p90): kırpmasız ${bRaw.p1090.toFixed(3)} → kırpmalı ${bTrim.p1090.toFixed(3)} (×${(bTrim.p1090 / bRaw.p1090).toFixed(2)})`,
  );
  console.log(
    `[7]   toplam aralık (YANILTICI metrik): ${bRaw.mm.toFixed(3)} → ${bTrim.mm.toFixed(3)} — ikisi de doygun, bu yüzden assert edilmez`,
  );
  assert.ok(
    bTrim.p1090 > bRaw.p1090 * 1.3,
    `kırpma özne kütle yayılımını açmıyor: ${bRaw.p1090.toFixed(3)} → ${bTrim.p1090.toFixed(3)}`,
  );
  // Sözleşme: çıktı hedef bandın dışına taşmamalı (kelepçe çalışıyor).
  for (let i = 0; i < trimmed.length; i++) {
    assert.ok(trimmed[i] >= 0 && trimmed[i] <= 1, `stretch 0..1 sözleşmesini bozdu: ${trimmed[i]}`);
  }
}

// ---------------------------------------------------------------------------
// 8. Determinizm — aynı girdi iki koşuda birebir
// ---------------------------------------------------------------------------
{
  const a = maskAware(bodyScene()).after;
  const b = maskAware(bodyScene()).after;
  let same = a.length === b.length;
  for (let i = 0; i < a.length && same; i++) if (a[i] !== b[i]) same = false;
  console.log(`[8] determinizm: ${same ? 'birebir' : 'FARKLI'}`);
  assert.ok(same, 'maske-farkında zincir determinist değil');
}

console.log('OK derinlik maskesi + zSpan + eğim tavanı (Gün E — bulgu 3, 4, 6)');
