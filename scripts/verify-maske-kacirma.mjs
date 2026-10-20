// MASKE TAZELEME ÖLÇÜTÜ — "maske özneyi hâlâ örtüyor mu?" doğrudan ölçülmeli.
//
// ── BULUNAN HATA (gerçek klip logu, 2026-08-30) ────────────────────────────
// Tazeleme kararı `maskeBayatMi` ile veriliyordu: derinliğin "en yakın %25"
// ağırlık merkezinin son maske olayından beri ne kadar KAYDIĞI. Bu büyüklük
// maskenin hizasını ölçmez — özne kolunu kaldırınca da, kameraya yaklaşınca
// da zıplar.
//
// Kullanıcının gerçek klip logunda sonucu:
//
//     6.4 Hz → maske bayat (%13) → RMBG 1153 ms → 4.4 Hz → 6.2 → 6.6 Hz
//            → maske bayat (%22) → RMBG 1175 ms → ...
//
// RMBG her ~8 sn'de bir koşuyor (koşu başına 1100–2165 ms) ve canlı tempo
// temiz aralıktaki 6.0–7.8 Hz'den 1.6–3.3 Hz'e düşüyor. Bayatlık gerekçeleri
// %12–%49 arasında gelişigüzel salınıyor.
//
// KESİN KANIT aynı logda: her yeniden üretimde maske BİREBİR aynı çıkıyor —
// `1024x576, ön plan %57` on beş kez üst üste. Maske bayat değildi.
//
// ── BU KAPI NE ÖLÇER ───────────────────────────────────────────────────────
// Yeni ölçüt `maskeKacirmaOrani`: yakın kütlenin kaçta kaçı maskenin DIŞINDA.
// Beklenen davranış:
//   · hizalı maske                        → ~0
//   · maske içinde uzuv hareketi          → DEĞİŞMEZ (eski ölçüt burada patlıyordu)
//   · maske kaydıkça                      → tekdüze artar
//
//   node scripts/verify-maske-kacirma.mjs
import assert from 'node:assert/strict';
import {
  MASK_MISS_LIMIT,
  maskeBayatMi,
  maskeKacirmaOrani,
  ustPercentilEsigi,
  kutleMerkezi,
} from '../src/engine/vision/liveDepth.ts';

const DW = 96;
const DH = 96;
const MW = 192; // maske BİLEREK farklı çözünürlükte (gerçek: 1024×576 vs 280×154)
const MH = 192;

// ÖZNE BOYUTU gerçek kliple uyumlu seçildi: kullanıcının logunda RMBG ön plan
// oranını sürekli %57 raporluyor. Küçük özne (ör. %15) ile "en yakın %25"
// eşiği DEJENERE olur — düz arka planın tamamı eşiğin üstünde kalır ve ölçüt
// hizadan bağımsız sabit bir sayı verir (ilk sürümde tam bu oldu: 0.849).
const OZNE = { ox: 0.25, oy: 0.1, ow: 0.5, oh: 0.8 }; // kadrajın %40'ı

/** Dikdörtgen özne: derinlik alanında `yakin`, dışarısı `uzak`. */
function sahne({ ox = OZNE.ox, oy = OZNE.oy, ow = OZNE.ow, oh = OZNE.oh, kol = null }) {
  const depth = new Float32Array(DW * DH);
  // Arka plan DÜZ DEĞİL: dikey rampa. Düz arka plan histogram yüzdeliğini
  // dejenere yapar; gerçek derinlik haritalarında arka plan da değişir.
  for (let y = 0; y < DH; y++) {
    const v = 0.05 + 0.2 * (y / DH);
    for (let x = 0; x < DW; x++) depth[y * DW + x] = v;
  }
  const ciz = (x0, y0, w, h, v) => {
    for (let y = Math.round(y0 * DH); y < Math.round((y0 + h) * DH); y++) {
      for (let x = Math.round(x0 * DW); x < Math.round((x0 + w) * DW); x++) {
        if (x >= 0 && x < DW && y >= 0 && y < DH) depth[y * DW + x] = v;
      }
    }
  };
  // ÖZNE DÜZ DEĞİL: soldan sağa derinlik gradyanı (gerçek bir insan gövdesi de
  // tek düzlem değildir). Düz özne, "en yakın %25" eşiğini öznenin TAMAMINA
  // düşürür ve ağırlık merkezi hiç oynamaz — eski ölçütün patladığı durum o
  // zaman temsil edilemez.
  for (let y = Math.round(oy * DH); y < Math.round((oy + oh) * DH); y++) {
    for (let x = Math.round(ox * DW); x < Math.round((ox + ow) * DW); x++) {
      if (x < 0 || x >= DW || y < 0 || y >= DH) continue;
      const u = (x / DW - ox) / ow; // 0 = sol kenar, 1 = sağ kenar
      depth[y * DW + x] = 0.6 + 0.3 * u;
    }
  }
  // Kol: öznenin İÇİNDE (maske hizası bozulmuyor) ama en yakın nokta —
  // yakın kütlenin ağırlık merkezini sola çeker.
  if (kol) ciz(kol.x, kol.y, kol.w, kol.h, 0.98);
  return depth;
}

/** Maske: aynı dikdörtgen, `kaydir` kadar yatay ötelenmiş (kadraj oranı). */
function maske(kaydir = 0, { ox = OZNE.ox, oy = OZNE.oy, ow = OZNE.ow, oh = OZNE.oh } = {}) {
  const m = new Float32Array(MW * MH);
  for (let y = Math.round(oy * MH); y < Math.round((oy + oh) * MH); y++) {
    for (let x = Math.round((ox + kaydir) * MW); x < Math.round((ox + kaydir + ow) * MW); x++) {
      if (x >= 0 && x < MW && y >= 0 && y < MH) m[y * MW + x] = 1;
    }
  }
  return m;
}

const oran = (d, m) => maskeKacirmaOrani(d, DW, DH, m, MW, MH, ustPercentilEsigi(d, 25));

// ---------------------------------------------------------------------------
// [1] KAYDIRMAYA DUYARLI, TEKDÜZE ARTAN.
// ---------------------------------------------------------------------------
// KAYDIRMA YÖNÜ: özne gradyanlı olduğu için yakın kütle SAĞ kenarda toplanır.
// Maskeyi sağa kaydırmak o kenarı örtmeye DEVAM eder (ölçüt haklı olarak
// tepki vermez — maske hâlâ önemli yeri kapsıyor). Ölçütün yakalaması gereken
// durum, maskenin yakın kütleyi AÇIKTA bırakmasıdır; o yüzden sola kaydırılır.
const d0 = sahne({});
const olcumler = [0, -0.1, -0.2, -0.3].map((k) => ({ k, r: oran(d0, maske(k)) }));
for (const o of olcumler) assert.ok(o.r !== null, `kaçırma oranı ölçülemedi (kaydırma ${o.k})`);
console.log(
  `[1] kaçırma oranı: ${olcumler.map((o) => `${(100 * o.k).toFixed(0)}%→${o.r.toFixed(3)}`).join(' · ')}`,
);
assert.ok(olcumler[0].r < 0.02, `hizalı maskede oran sıfıra yakın olmalı (${olcumler[0].r.toFixed(3)})`);
for (let i = 1; i < olcumler.length; i++) {
  assert.ok(
    olcumler[i].r > olcumler[i - 1].r,
    `oran tekdüze artmıyor: ${olcumler[i - 1].r.toFixed(3)} → ${olcumler[i].r.toFixed(3)}`,
  );
}

// ---------------------------------------------------------------------------
// [2] EŞİK DOĞRU YERDE — küçük kıpırdanma tazeleme TETİKLEMEZ, gerçek kayma eder.
// ---------------------------------------------------------------------------
{
  const k10 = oran(d0, maske(-0.1));
  const k20 = oran(d0, maske(-0.2));
  assert.ok(k10 < MASK_MISS_LIMIT, `%10 kayma tazeleme tetikliyor (${k10.toFixed(3)} ≥ ${MASK_MISS_LIMIT})`);
  assert.ok(k20 > MASK_MISS_LIMIT, `%20 kayma tazeleme tetiklemiyor (${k20.toFixed(3)} ≤ ${MASK_MISS_LIMIT})`);
  console.log(`[2] eşik ${MASK_MISS_LIMIT}: %10 → ${k10.toFixed(3)} (tazelemez) · %20 → ${k20.toFixed(3)} (tazeler) ✓`);
}

// ---------------------------------------------------------------------------
// [3] ASIL KAZANÇ — MASKE İÇİNDE UZUV HAREKETİ YENİ ÖLÇÜTÜ OYNATMAZ.
// Eski ölçüt tam burada patlıyordu ve gereksiz RMBG'yi o tetikliyordu.
// ---------------------------------------------------------------------------
{
  const m = maske(0);
  const durgun = sahne({});
  // Kol öznenin İÇİNDE kalkıyor (maske hizası hiç bozulmadı).
  // Kol, öznenin SOL yarısında ve büyük: yakın kütlenin (sağ kenarda toplanan)
  // ağırlık merkezini eski ölçütün eşiğini (%12) aşacak kadar sola çeker.
  // Maske sınırlarının İÇİNDE kalır (özne x ∈ [0.25, 0.75]) — yani maske hizası
  // hiç bozulmaz, yalnız özne kendi içinde hareket eder.
  const hareketli = sahne({ kol: { x: 0.26, y: 0.15, w: 0.22, h: 0.5 } });

  const yeniDurgun = oran(durgun, m);
  const yeniHareketli = oran(hareketli, m);
  const yeniFark = Math.abs(yeniHareketli - yeniDurgun);

  // ESKİ ölçüt: yakın kütle ağırlık merkezinin kayması.
  const eskiA = kutleMerkezi(durgun, DW, DH, ustPercentilEsigi(durgun, 25));
  const eskiB = kutleMerkezi(hareketli, DW, DH, ustPercentilEsigi(hareketli, 25));
  const eskiKayma = Math.hypot(eskiB.x - eskiA.x, eskiB.y - eskiA.y);
  const eskiTetikler = maskeBayatMi(eskiB, eskiA);

  console.log(
    `[3] maske içinde uzuv hareketi → ESKİ ölçüt kayma ${eskiKayma.toFixed(3)} (tetikler: ${eskiTetikler}) · ` +
      `YENİ ölçüt ${yeniDurgun.toFixed(3)} → ${yeniHareketli.toFixed(3)} (fark ${yeniFark.toFixed(3)})`,
  );
  // NOT: eski ölçütün gerçekten patladığının KANITI bu sentetik sahne DEĞİL,
  // kullanıcının gerçek klip logudur (dosya başındaki alıntı: aynı maske
  // `1024x576, ön plan %57` on beş kez üst üste yeniden üretiliyor). Buradaki
  // `eskiKayma` yalnız teşhis olarak yazdırılır; sentetik bir sahneyi o
  // patlamayı üretene kadar zorlamak, kapıyı sahneye uydurmak olurdu.
  assert.ok(
    eskiKayma > 0,
    'senaryo yakın kütle merkezini hiç oynatmıyor — maske içi hareket temsil edilmiyor',
  );
  assert.ok(
    yeniHareketli < MASK_MISS_LIMIT,
    `yeni ölçüt maske içi hareketle tazeleme tetikliyor (${yeniHareketli.toFixed(3)}) — kazanç yok`,
  );
  assert.ok(
    yeniFark < 0.1,
    `yeni ölçüt maske içi harekete fazla duyarlı (fark ${yeniFark.toFixed(3)})`,
  );
}

// ---------------------------------------------------------------------------
// [4] DEJENERE GİRDİ — yakın kütle yoksa karar VERİLMEZ (null), tazeleme yok.
// ---------------------------------------------------------------------------
{
  const bos = new Float32Array(DW * DH).fill(0.15);
  const r = maskeKacirmaOrani(bos, DW, DH, maske(0), MW, MH, 0.99);
  assert.equal(r, null, 'yakın kütle yokken null dönmeli — yanlış tazeleme yapılmamalı');
  console.log('[4] yakın kütle yokken karar verilmiyor (null) ✓');
}

// ---------------------------------------------------------------------------
// [5] TABAN-GÖRELİ KARAR — mutlak eşik gerçek klipte tutmuyor.
//
// ÖLÇÜLDÜ (tarayıcı, 6 sn'lik gerçek klip, 768x1024 maske / 154x210 derinlik):
// TAZE üretilmiş maskede bile kaçırma oranı %55–60 çıkıyor ve mutlak eşiği
// (0.5) sürekli aşıyor — 32 saniyede 6 RMBG koşusu, her biri ~1.2 sn.
//
// Sebep ölçütün varsayımı: "özne en yakın şeydir". Sentetik sahnede özne
// kadrajın %40'ıydı ve arka plan uzaktı; gerçek klipte özne %29 ve "en yakın
// %25" bol bol arka plan içeriyor. Mutlak sayı bu yüzden klipten klibe kayar.
//
// Kararı KLİBE GÖRE kalibre etmek gerekiyor: taze maske o klip için bir TABAN
// belirler, tazeleme yalnız oran o tabanın belirgin ÜSTÜNE çıkınca tetiklenir.
// ---------------------------------------------------------------------------
{
  const { MASK_MISS_RISE, maskeYenilenmeliMi } = await import('../src/engine/vision/liveDepth.ts');
  // Taban yokken (ilk ölçüm) mutlak eşik korunur — geriye dönük davranış.
  assert.equal(maskeYenilenmeliMi(0.7, null), true, 'taban yokken mutlak eşik uygulanmalı');
  assert.equal(maskeYenilenmeliMi(0.2, null), false, 'taban yokken düşük oran tazelememeli');
  // Taban varken: taze maskenin kendi yüksek oranı tazeleme TETİKLEMEZ.
  assert.equal(
    maskeYenilenmeliMi(0.60, 0.58),
    false,
    'taze maskenin kendi taban oranı tazeleme tetikliyor — gerçek klipteki RMBG döngüsü bu',
  );
  // Gerçek kayma: oran tabanın belirgin üstüne çıkarsa tazelenir.
  assert.equal(
    maskeYenilenmeliMi(0.58 + MASK_MISS_RISE + 0.01, 0.58),
    true,
    'tabanın üstüne çıkan gerçek kayma yakalanmıyor',
  );
  assert.equal(maskeYenilenmeliMi(null, 0.58), false, 'ölçülemeyen oran karar vermemeli');
  console.log(`[5] taban-göreli karar: taban 0.58'de 0.60 tazelemez, 0.${String(58 + Math.round(100 * MASK_MISS_RISE))}+ tazeler ✓`);
}

console.log('OK maske kaçırma ölçütü — hizayı ölçüyor, uzuv hareketini tazelemeye çevirmiyor');
