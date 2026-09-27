// Görev 2 — yenilik/paralaks tabanlı kare seçimi: saf çekirdek (yenilikSec)
// sözleşme testi. Tarayıcı tarafı (yenilikIncelemesi, DOM/canvas gerektirir)
// burada KAPSAM DIŞI — bu betik yalnız Node'da çalışan saf çekirdeği sınar.
//   node scripts/verify-kare-secimi.mjs
import assert from 'node:assert/strict';
import { yenilikSec } from '../src/engine/reconstruction/kareSecimi.ts';

const ESIK = 0.06;

// --- yardımcı: sabit adımlı "hareket" — her adım arası birim hızda paralaks.
// hareket(a,b) = |t[b]-t[a]| * hiz (0..1 aralığına kelepçeli).
function sabitHizliHareket(adaylar, hiz) {
  return (a, b) => Math.min(1, Math.abs(adaylar[b].t - adaylar[a].t) * hiz);
}

// =====================================================================
// [1] sabit hızlı yürüyüş → eşit aralıklı seçim
// =====================================================================
{
  const n = 40;
  const adaylar = Array.from({ length: n }, (_, i) => ({ t: i, netlik: 1 })); // netlik SABİT: pencere içi eşitlikte İLK adayı korur (kesin aralık sınanabilir)
  const hiz = 0.02; // esik(0.06) / hiz = 3 → her 3 adayda bir eşik aşılır
  const hareket = sabitHizliHareket(adaylar, hiz);
  const secim = yenilikSec(adaylar, hareket, { esik: ESIK, enAz: 2, enCok: n, enUzunAralikSn: 1000 });
  console.log(`[1] sabit hız seçim indeksleri: ${secim.join(',')}`);
  assert.ok(secim.length >= 3, `en az birkaç seçim olmalı → ${secim.length}`);
  assert.equal(secim[0], 0, 'ilk aday her zaman seçilir');
  const araliklar = [];
  for (let i = 1; i < secim.length; i++) araliklar.push(secim[i] - secim[i - 1]);
  for (const a of araliklar) assert.equal(a, araliklar[0], `tüm aralıklar eşit olmalı → ${araliklar.join(',')}`);
  assert.equal(araliklar[0], 3, `beklenen aralık esik/hiz=3 → ${araliklar[0]}`);
}

// =====================================================================
// [2] durup bekleyen bölüm → seçim yok (maks. aralık dışında hariç)
// =====================================================================
{
  const n = 30;
  // t saniye cinsinden 0.1'er artıyor (3 saniyelik durağan çekim); hareket HER
  // ZAMAN 0 (kamera sabit) — yalnız enUzunAralikSn tetikleyebilir.
  const adaylar = Array.from({ length: n }, (_, i) => ({ t: i * 0.1, netlik: 1 }));
  const hareket = () => 0;
  const enUzunAralikSn = 1.0;
  const secim = yenilikSec(adaylar, hareket, { esik: ESIK, enAz: 1, enCok: n, enUzunAralikSn });
  console.log(`[2] durağan bölüm seçim indeksleri: ${secim.join(',')} (t: ${secim.map((i) => adaylar[i].t.toFixed(1)).join(',')})`);
  assert.equal(secim[0], 0, 'ilk aday her zaman seçilir');
  for (let i = 1; i < secim.length; i++) {
    const dt = adaylar[secim[i]].t - adaylar[secim[i - 1]].t;
    assert.ok(dt >= enUzunAralikSn - 1e-9, `hareket=0 iken seçim SADECE maks. aralık aşıldığında olur → dt=${dt.toFixed(2)}`);
  }
  // maks aralık ~1.0s, kareler 0.1s arayla → her ~10 adayda bir seçim beklenir
  assert.ok(secim.length >= 2, `en az bir maks-aralık seçimi olmalı (3s > 1.0s) → ${secim.length}`);
}

// =====================================================================
// [3] hızlanan bölüm → daha sık seçim (yavaş bölümden daha yoğun)
// =====================================================================
{
  const n = 60;
  const yavasHiz = 0.005;
  const hizliHiz = 0.03;
  // ilk yarı yavaş, ikinci yarı hızlı — t birimi adım başına 1
  const adaylar = Array.from({ length: n }, (_, i) => ({ t: i, netlik: 1 }));
  const yarim = n / 2;
  const hareket = (a, b) => {
    // adım-adım entegre et (a<b varsayımı; algoritma zaten a<b çağırır)
    let toplam = 0;
    for (let i = a; i < b; i++) toplam += i < yarim ? yavasHiz : hizliHiz;
    return Math.min(1, toplam);
  };
  const secim = yenilikSec(adaylar, hareket, { esik: ESIK, enAz: 2, enCok: n, enUzunAralikSn: 1000 });
  console.log(`[3] hızlanan bölüm seçim indeksleri: ${secim.join(',')}`);
  const yavasSecim = secim.filter((i) => i < yarim);
  const hizliSecim = secim.filter((i) => i >= yarim);
  const yavasArlk = yavasSecim.length > 1 ? (yavasSecim[yavasSecim.length - 1] - yavasSecim[0]) / (yavasSecim.length - 1) : Infinity;
  const hizliArlk = hizliSecim.length > 1 ? (hizliSecim[hizliSecim.length - 1] - hizliSecim[0]) / (hizliSecim.length - 1) : Infinity;
  console.log(`[3] yavaş ort. aralık ${yavasArlk.toFixed(2)}, hızlı ort. aralık ${hizliArlk.toFixed(2)}`);
  assert.ok(hizliSecim.length > yavasSecim.length, `hızlı bölümde DAHA ÇOK seçim olmalı → yavaş ${yavasSecim.length} hızlı ${hizliSecim.length}`);
  assert.ok(hizliArlk < yavasArlk, `hızlı bölüm seçimleri daha SIK (küçük aralık) olmalı → yavaş ${yavasArlk} hızlı ${hizliArlk}`);
}

// =====================================================================
// [4] netlik penceresi: eşiği geçen ilk aday değil, pencere (kendisi + sonraki 2)
//     içindeki EN NET aday seçilir
// =====================================================================
{
  // 0: başlangıç. hareket(0,1) esik'i geçer (i=1 tetikleyici) → pencere {1,2,3}.
  // netlik: 1=düşük, 2=düşük, 3=YÜKSEK → 3 seçilmeli, 1 değil.
  const adaylar = [
    { t: 0, netlik: 5 },
    { t: 1, netlik: 1 }, // eşiği geçen aday (tetikleyici) ama netliği düşük
    { t: 2, netlik: 2 },
    { t: 3, netlik: 9 }, // pencere içindeki EN NET aday
    { t: 4, netlik: 1 },
  ];
  const hareket = (a, b) => (a === 0 && b >= 1 ? 1 : 0); // 0'dan sonrası hep eşik üstü
  const secim = yenilikSec(adaylar, hareket, { esik: ESIK, enAz: 1, enCok: 5, enUzunAralikSn: 1000 });
  console.log(`[4] netlik penceresi seçim indeksleri: ${secim.join(',')}`);
  assert.equal(secim[0], 0, 'ilk aday her zaman seçilir');
  assert.equal(secim[1], 3, `pencere {1,2,3} içinde en net (idx 3, netlik 9) seçilmeli, TETİKLEYİCİ (idx 1) DEĞİL → seçilen ${secim[1]}`);
}

// =====================================================================
// [5] enCok/enAz sıkıştırması: eşik adaptasyonu
// =====================================================================
{
  // enCok: çok düşük eşikle fazla seçim olur → eşik ×1.25 döngüsüyle azalmalı
  {
    const n = 50;
    const adaylar = Array.from({ length: n }, (_, i) => ({ t: i, netlik: 1 }));
    const hareket = sabitHizliHareket(adaylar, 0.05); // esik(0.06)/hiz(0.05) → her adayda tetiklenir (>=1 adımda esik aşar mı? 0.05<0.06 tek adımda geçmez, 2 adımda 0.10>0.06 geçer)
    const enCok = 5;
    const secim = yenilikSec(adaylar, hareket, { esik: ESIK, enAz: 1, enCok, enUzunAralikSn: 1000 });
    console.log(`[5a] enCok=${enCok} sıkıştırması sonrası: ${secim.length} seçim (indeksler ${secim.join(',')})`);
    assert.ok(secim.length <= enCok, `sonuç enCok'u AŞMAMALI (≤12 deneme sonrası) → ${secim.length} > ${enCok}`);
  }
  // enAz: çok yüksek eşikle az seçim olur → eşik ×0.7 döngüsüyle artmalı
  {
    const n = 50;
    const adaylar = Array.from({ length: n }, (_, i) => ({ t: i, netlik: 1 }));
    const hareket = sabitHizliHareket(adaylar, 0.002); // çok yavaş hareket — yüksek esik'te neredeyse hiç seçim yok
    const enAz = 10;
    const oncekiSecim = yenilikSec(adaylar, () => 0, { esik: ESIK, enAz: 0, enCok: n, enUzunAralikSn: 1000 }).length;
    const secim = yenilikSec(adaylar, hareket, { esik: ESIK, enAz, enCok: n, enUzunAralikSn: 1000 });
    console.log(`[5b] enAz=${enAz} gevşetmesi sonrası: ${secim.length} seçim (indeksler ${secim.join(',')})`);
    assert.ok(secim.length >= Math.min(enAz, n), `sonuç enAz'ın ALTINDA KALMAMALI (≤8 deneme sonrası, mümkünse) → ${secim.length} < ${enAz}`);
    assert.ok(secim.length > oncekiSecim || oncekiSecim >= enAz, 'eşik gevşetme öncesine göre DAHA FAZLA (ya da zaten yeterli) seçim vermeli');
  }
}

// =====================================================================
// [6] hareket memoizasyonu: aynı (a,b) çifti birden fazla kez SORULMAZ
//     (adaptasyon döngüleri boyunca dahi) — çağrı sayısı benzersiz çift
//     sayısına eşit olmalı.
// =====================================================================
{
  const n = 50;
  const adaylar = Array.from({ length: n }, (_, i) => ({ t: i, netlik: 1 }));
  const cagrilar = [];
  const gercekHareket = sabitHizliHareket(adaylar, 0.05);
  const sayilanHareket = (a, b) => {
    cagrilar.push(`${a},${b}`);
    return gercekHareket(a, b);
  };
  // enCok çok düşük tutularak birden fazla ×1.25 adaptasyon turu ZORLANIR —
  // her tur eşiği farklı bir değere değiştirip birGecisSec'i BAŞTAN çalıştırır;
  // memoizasyon olmadan erken (a,b) çiftleri her turda TEKRAR sorulurdu.
  const enCok = 3;
  const secim = yenilikSec(adaylar, sayilanHareket, { esik: ESIK, enAz: 1, enCok, enUzunAralikSn: 1000 });
  const benzersiz = new Set(cagrilar);
  console.log(`[6] toplam hareket() çağrısı: ${cagrilar.length}, benzersiz çift: ${benzersiz.size} (seçim: ${secim.length}, ≤${enCok})`);
  assert.ok(cagrilar.length > 0, 'test anlamlı olsun diye en az bir çağrı olmalı');
  assert.equal(cagrilar.length, benzersiz.size, `AYNI (a,b) çifti birden fazla kez ÇAĞRILMAMALI (önbellek) → ${cagrilar.length} çağrı, ${benzersiz.size} benzersiz`);
}

console.log('OK kare-secimi (Görev 2 — saf çekirdek yenilikSec)');
