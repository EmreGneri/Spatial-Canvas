import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ekranaProjekte, ekranYaricapiniDunyaya, enYakinSplat, fircaSecimi, gorunurSayisi,
  kureSecimi, lassoSecimi, type SecimAraci,
} from './splatSecim';
import { elemandanKameraya, icerikDonusumu, kameradanElemana } from './gsKamera';
import type { TemizlemeGeri, TemizlemeKaynagi } from './temizlemeKaynagi';
import { bosluk, cam, dugme, MONO, renk, SANS, yaricap, yazi } from './tema';

/**
 * SPLAT TEMİZLEME ARACI — sahnenin üstünde 2D seçim katmanı.
 *
 * Sahne (motorun WebGL'i ya da eğitim oturumunun WebGPU'su) altta çizilir;
 * seçim ve vurgu bu 2D kanvasta. Vurgu splat verisinin RENK kanalına
 * DOKUNMAZ: renk yazmak orijinal veriyi bozar ve geri alma iki kanalı birden
 * takip etmek zorunda kalırdı. Vurgu yalnız bu katmanda yaşar — seçim
 * kaybolunca sahne bit bit aynı kalır.
 *
 * DÖRT MOD, BİRİ SEÇİM DEĞİL: `gez` açıkken katman hiçbir olayı almaz
 * (`pointerEvents: none`) ve alttaki kamera denetimi eskisi gibi çalışır.
 * Sebep ölçülebilir: katman sahnenin ÜSTÜNDE olduğu için olayları
 * yakaladığında kamera kilitlenir — floater'ı bulmak için döndürmek
 * gerekiyor, dolayısıyla "gez" varsayılan mod. Seçim modlar arasında
 * KORUNUR: seç → gez → doğrula → sil akışı bozulmaz.
 *
 * İKİ SAHNE, TEK ARAÇ: hangi sahnede olduğunu `kaynak` biliyor
 * (`temizlemeKaynagi.ts`). Motor yolunda silme yerinde opaklık yazmak,
 * eğitim yolunda oturumun `temizle()`si. Araç ikisini de yalnız ASENKRON
 * arayüzden görür.
 *
 * KADRAJ: eğitim tuvali `object-fit: contain` ile gösteriliyor ve izdüşüm
 * kameranın KENDİ piksel ölçüsünde. İmleç eleman koordinatından kamera
 * pikseline çevrilir (`icerikDonusumu`); fırça yarıçapı da aynı ölçeğe
 * bölünür, yoksa daire eleman büyüdükçe sahnede küçülürdü.
 */
export function SplatTemizleme({
  kaynak,
  onKapat,
  say,
}: {
  kaynak: TemizlemeKaynagi;
  onKapat(): void;
  say(m: string): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [arac, setArac] = useState<SecimAraci | 'gez'>('gez');
  const [boyut, setBoyut] = useState(28);
  /** Seçili indeksler — Set, fırça darbeleri birikerek genişlesin diye. */
  const secimRef = useRef<Set<number>>(new Set());
  const [secimSayisi, setSecimSayisi] = useState(0);
  const gecmisRef = useRef<TemizlemeGeri[]>([]);
  const [gecmisBoy, setGecmisBoy] = useState(0);
  const [kalan, setKalan] = useState<{ gorunur: number; toplam: number } | null>(null);
  /** Eğitim oturumu tek işlem kabul ediyor: sürerken düğmeler kilitlenir. */
  const [mesgul, setMesgul] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  /** İmleç (fırça halkası) ve lasso yolu — çizim döngüsü bunları okur. */
  const imlecRef = useRef<{ x: number; y: number } | null>(null);
  const lassoRef = useRef<number[]>([]);
  const basiliRef = useRef(false);
  const ekranRef = useRef<Float32Array | null>(null);
  const aracRef = useRef(arac);
  aracRef.current = arac;
  const boyutRef = useRef(boyut);
  boyutRef.current = boyut;
  const sayRef = useRef(say);
  sayRef.current = say;
  const kaynakRef = useRef(kaynak);
  kaynakRef.current = kaynak;

  /**
   * Splat verisi + o ANIN matrisi. `kaynak.oku()` eğitim yolunda önbellekli
   * olduğu için her fırça darbesinde çağrılabilir; matris her seferinde taze
   * alınır (kamera dönüyor olabilir).
   */
  async function veri() {
    const k = kaynakRef.current.kare();
    const s = await kaynakRef.current.oku();
    if (!k || !s) return null;
    const ekran = ekranaProjekte(s.xyzw, s.count, k.vp, k.en, k.boy, ekranRef.current ?? undefined);
    ekranRef.current = ekran;
    return { ...s, ...k, ekran, esik: kaynakRef.current.esik() };
  }

  async function kalanTazele() {
    const s = await kaynakRef.current.oku();
    if (s) {
      setKalan({
        gorunur: gorunurSayisi(s.xyzw, s.count, kaynakRef.current.esik()),
        toplam: s.count,
      });
    }
  }

  useEffect(() => {
    void kalanTazele();
    const k = kaynakRef.current;
    return () => { secimRef.current.clear(); k.birak?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * ÇİZİM DÖNGÜSÜ. Kamera alttaki sahnenin kendi döngüsünde döndüğü için
   * vurgu her karede yeniden projekte edilmeli, yoksa noktalar sahnenin
   * gerisinde kalır. Matris DEĞİŞMEDİYSE projeksiyon atlanır — durağan
   * sahnede yüz binlerce çarpma boşa gitmesin.
   *
   * Döngü `kaynak.oku()`yu BEKLEMEZ: son okunan anlık görüntüyü kullanır,
   * çünkü bir rAF karesinde `await` etmek bir sonraki kareyi de geciktirirdi.
   * Anlık görüntü seçimde ve saniyede bir tazelenir.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let sonVp: Float32Array | null = null;
    let sonSecim = -1;
    let anlik: { xyzw: Float32Array; count: number } | null = null;
    void kaynakRef.current.oku().then((s) => { anlik = s; });

    const ciz = () => {
      raf = requestAnimationFrame(ciz);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const kare = kaynakRef.current.kare();
      if (!kare) return;
      const d = icerikDonusumu(w, h, kare.en, kare.boy);
      const secim = secimRef.current;

      if (anlik && secim.size > 0) {
        const degisti = !sonVp || kare.vp.some((v, i) => v !== sonVp![i]) || sonSecim !== secim.size;
        if (degisti) {
          ekranRef.current = ekranaProjekte(
            anlik.xyzw, anlik.count, kare.vp, kare.en, kare.boy, ekranRef.current ?? undefined,
          );
          sonVp = Float32Array.from(kare.vp);
          sonSecim = secim.size;
        }
        const ekran = ekranRef.current!;
        // Seçim vurgusu: tek renk, tek geçiş. Parlama YOK (tema kuralı: tek
        // ışık kaynağı) — dolgu opaklığı yeterli ayrım veriyor.
        ctx.fillStyle = 'rgba(248,113,113,0.85)';
        for (const i of secim) {
          const k = i * 3;
          if (!(ekran[k + 2] > 0)) continue;
          const p = kameradanElemana(d, ekran[k], ekran[k + 1]);
          ctx.fillRect(p.x - 1, p.y - 1, 2.5, 2.5);
        }
      } else if (secim.size === 0) {
        sonSecim = -1;
      }

      // Fırça/küre halkası: hedefin boyutu tıklamadan ÖNCE görünür (Fitts).
      const im = imlecRef.current;
      if (im && (aracRef.current === 'firca' || aracRef.current === 'kure')) {
        ctx.strokeStyle = 'rgba(233,236,242,0.75)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(im.x, im.y, boyutRef.current, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Lasso yolu.
      const yol = lassoRef.current;
      if (aracRef.current === 'lasso' && yol.length >= 4) {
        ctx.strokeStyle = 'rgba(77,141,255,0.9)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(yol[0], yol[1]);
        for (let p = 2; p < yol.length; p += 2) ctx.lineTo(yol[p], yol[p + 1]);
        if (!basiliRef.current) ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };
    ciz();
    const tazele = window.setInterval(() => {
      void kaynakRef.current.oku().then((s) => { anlik = s; });
    }, 1000);
    return () => { cancelAnimationFrame(raf); clearInterval(tazele); };
  }, []);

  function yerel(ev: ReactPointerEvent<HTMLCanvasElement>) {
    const r = ev.currentTarget.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top, w: r.width, h: r.height };
  }

  /** Eleman noktası + fırça yarıçapı → kamera piksel uzayı. */
  function kameraya(x: number, y: number, w: number, h: number, en: number, boy: number) {
    const d = icerikDonusumu(w, h, en, boy);
    const p = elemandanKameraya(d, x, y);
    return { ...p, yaricap: boyutRef.current / (d.olcek || 1) };
  }

  async function fircaVur(x: number, y: number, w: number, h: number) {
    const d = await veri();
    if (!d) return;
    const c = kameraya(x, y, w, h, d.en, d.boy);
    const bulunan = fircaSecimi(d.ekran, d.xyzw, d.count, d.en, d.boy, c.x, c.y, c.yaricap, d.esik);
    const s = secimRef.current;
    for (const i of bulunan) s.add(i);
    setSecimSayisi(s.size);
  }

  async function kureVur(x: number, y: number, w: number, h: number) {
    const d = await veri();
    if (!d) return;
    const c = kameraya(x, y, w, h, d.en, d.boy);
    const merkezIdx = enYakinSplat(d.ekran, d.xyzw, d.count, d.en, d.boy, c.x, c.y, c.yaricap, d.esik);
    if (merkezIdx === null) {
      sayRef.current('temizleme: imleç altında splat yok');
      return;
    }
    const o = merkezIdx * 4;
    const wClip = d.ekran[merkezIdx * 3 + 2];
    const r = ekranYaricapiniDunyaya(d.vp, wClip, c.yaricap, d.en);
    const bulunan = kureSecimi(d.xyzw, d.count, [d.xyzw[o], d.xyzw[o + 1], d.xyzw[o + 2]], r, d.esik);
    const s = secimRef.current;
    for (const i of bulunan) s.add(i);
    setSecimSayisi(s.size);
  }

  async function lassoBitir(w: number, h: number) {
    const yol = lassoRef.current;
    lassoRef.current = [];
    if (yol.length < 6) return;
    const d = await veri();
    if (!d) return;
    const donusum = icerikDonusumu(w, h, d.en, d.boy);
    const kameraYolu: number[] = [];
    for (let p = 0; p < yol.length; p += 2) {
      const q = elemandanKameraya(donusum, yol[p], yol[p + 1]);
      kameraYolu.push(q.x, q.y);
    }
    const bulunan = lassoSecimi(d.ekran, d.xyzw, d.count, d.en, d.boy, kameraYolu, d.esik);
    const s = secimRef.current;
    for (const i of bulunan) s.add(i);
    setSecimSayisi(s.size);
  }

  /** Kaynak çağrılarını tek sarmalayıcıdan geçir: kilit + hata görünür olsun. */
  async function islem(ad: string, f: () => Promise<void>) {
    if (mesgul) return;
    setMesgul(true);
    setHata(null);
    try {
      await f();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setHata(m);
      sayRef.current(`temizleme ${ad} HATA: ${m}`);
    } finally {
      setMesgul(false);
    }
  }

  function sil() {
    void islem('silme', async () => {
      const s = secimRef.current;
      if (s.size === 0) return;
      const geri = await kaynakRef.current.sil(Int32Array.from(s));
      s.clear();
      setSecimSayisi(0);
      if (!geri) { sayRef.current('temizleme: seçilenler zaten silinmişti'); return; }
      gecmisRef.current.push(geri);
      setGecmisBoy(gecmisRef.current.length);
      await kalanTazele();
      sayRef.current(
        `temizleme (${kaynakRef.current.ad}): ${geri.adet.toLocaleString('tr-TR')} splat silindi · geri alınabilir`,
      );
    });
  }

  function sonuGeriAl() {
    void islem('geri alma', async () => {
      const geri = gecmisRef.current[gecmisRef.current.length - 1];
      if (!geri) return;
      // Jeton reddedebilir (devamEt/kapat sonrası süresi dolar). Hata
      // YUTULMAZ; jeton yığından da düşer, çünkü bir daha çalışmayacak.
      try {
        await geri.geriAl();
      } finally {
        gecmisRef.current.pop();
        setGecmisBoy(gecmisRef.current.length);
      }
      await kalanTazele();
      sayRef.current(`temizleme: ${geri.adet.toLocaleString('tr-TR')} splat geri geldi`);
    });
  }

  function tumunuGeriAl() {
    void islem('toplu geri alma', async () => {
      let n = 0;
      // TERS SIRADA: eğitim oturumu başka sırayı reddediyor.
      while (gecmisRef.current.length) {
        const geri = gecmisRef.current[gecmisRef.current.length - 1];
        try {
          await geri.geriAl();
          n += geri.adet;
        } finally {
          gecmisRef.current.pop();
        }
      }
      setGecmisBoy(0);
      await kalanTazele();
      sayRef.current(`temizleme: tüm silmeler geri alındı · ${n.toLocaleString('tr-TR')} splat`);
    });
  }

  const secimVar = secimSayisi > 0;

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          // GEZ modunda katman saydam bir seyirci: olaylar alttaki kamera
          // denetimine gider.
          pointerEvents: arac === 'gez' ? 'none' : 'auto',
          cursor: arac === 'lasso' ? 'crosshair' : 'none',
          touchAction: 'none',
          zIndex: 6,
        }}
        onPointerDown={(ev) => {
          if (ev.button !== 0 || mesgul) return;
          const { x, y, w, h } = yerel(ev);
          // Yakalama BAŞARISIZ OLABİLİR (işaretçi artık etkin değilse tarayıcı
          // NotFoundError atar). Atarsa seçim hiç başlamıyordu — tek bir fırça
          // darbesi sessizce yutuluyordu. Yakalama bir KOLAYLIK, ön koşul değil.
          try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* yakalamasız devam */ }
          basiliRef.current = true;
          imlecRef.current = { x, y };
          if (arac === 'firca') void fircaVur(x, y, w, h);
          else if (arac === 'kure') void kureVur(x, y, w, h);
          else if (arac === 'lasso') lassoRef.current = [x, y];
        }}
        onPointerMove={(ev) => {
          const { x, y, w, h } = yerel(ev);
          imlecRef.current = { x, y };
          if (!basiliRef.current) return;
          if (arac === 'firca') void fircaVur(x, y, w, h);
          else if (arac === 'lasso') {
            const yol = lassoRef.current;
            // Nokta seyreltme: her pikselde bir nokta eklemek poligonu 2000
            // köşeye çıkarıyordu; ışın atma maliyeti köşe sayısıyla çarpılır.
            const n = yol.length;
            if (n < 2 || Math.hypot(x - yol[n - 2], y - yol[n - 1]) > 4) yol.push(x, y);
          }
        }}
        onPointerUp={(ev) => {
          const { w, h } = yerel(ev);
          basiliRef.current = false;
          if (arac === 'lasso') void lassoBitir(w, h);
        }}
        onPointerCancel={() => { basiliRef.current = false; lassoRef.current = []; }}
        onLostPointerCapture={() => { basiliRef.current = false; }}
        onPointerLeave={() => { imlecRef.current = null; }}
      />

      <div style={serit}>
        <span style={{ fontSize: yazi.kucuk, color: renk.metinSolgun, fontWeight: 600 }}>
          temizle · {kaynak.ad}
        </span>
        <span style={ayrac} />
        {(['gez', 'firca', 'lasso', 'kure'] as const).map((a) => (
          <button
            key={a}
            type="button"
            style={{ ...dugme(arac === a), minHeight: 32, padding: '7px 10px' }}
            aria-pressed={arac === a}
            title={ARAC_IPUCU[a]}
            onClick={() => { setArac(a); lassoRef.current = []; }}
          >
            {ARAC_ADI[a]}
          </button>
        ))}

        {arac !== 'gez' && arac !== 'lasso' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: yazi.kucuk, color: renk.metinSolgun }}>
            boyut
            <input
              type="range"
              min={6}
              max={120}
              step={2}
              value={boyut}
              onChange={(e) => setBoyut(Number(e.target.value))}
              style={{ width: 84 }}
            />
            <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>{boyut}</span>
          </label>
        )}

        <span style={ayrac} />
        <button
          type="button"
          style={{ ...dugme(secimVar), minHeight: 32, padding: '7px 12px', opacity: secimVar && !mesgul ? 1 : 0.5 }}
          disabled={!secimVar || mesgul}
          title="seçili splat'lar öldürülür — geri alınabilir"
          onClick={sil}
        >
          {mesgul ? '…' : `sil${secimVar ? ` (${secimSayisi.toLocaleString('tr-TR')})` : ''}`}
        </button>
        <button
          type="button"
          style={{ ...dugme(), minHeight: 32, padding: '7px 10px', opacity: gecmisBoy && !mesgul ? 1 : 0.5 }}
          disabled={!gecmisBoy || mesgul}
          onClick={sonuGeriAl}
          title="son silmeyi geri al (yalnız ters sırada çalışır)"
        >
          ↶ geri al{gecmisBoy ? ` (${gecmisBoy})` : ''}
        </button>
        <button
          type="button"
          style={{ ...dugme(), minHeight: 32, padding: '7px 10px', opacity: gecmisBoy && !mesgul ? 1 : 0.5 }}
          disabled={!gecmisBoy || mesgul}
          onClick={tumunuGeriAl}
          title="tüm silmeleri ters sırada geri al"
        >
          hepsi
        </button>

        <span style={ayrac} />
        {/* Zeigarnik: yapılan iş sayı olarak görünür kalsın. */}
        <span style={{ fontFamily: MONO, fontSize: yazi.kucuk, color: renk.metinSilik, fontVariantNumeric: 'tabular-nums' }}>
          {kalan ? `${kalan.gorunur.toLocaleString('tr-TR')} / ${kalan.toplam.toLocaleString('tr-TR')}` : '—'}
        </span>
        <button type="button" style={{ ...dugme(), minHeight: 32, padding: '7px 10px' }} onClick={onKapat}>kapat</button>
        {/* Hata sessizce yutulmaz: jetonun süresi dolduysa kullanıcı bilmeli. */}
        {hata && <span style={hataSatiri}>{hata}</span>}
      </div>
    </>
  );
}

const ARAC_ADI: Record<SecimAraci | 'gez', string> = {
  gez: '✥ gez',
  firca: '● fırça',
  lasso: '◌ lasso',
  kure: '◎ küre',
};

const ARAC_IPUCU: Record<SecimAraci | 'gez', string> = {
  gez: 'seçim kapalı — sahneyi döndür, yakınlaş (seçim korunur)',
  firca: 'sürükleyerek boya: daire içindeki splat’lar seçilir (derinlik bakılmaz)',
  lasso: 'serbest çiz: kapalı alanın içindeki splat’lar seçilir',
  kure: 'tıkla: imleç altındaki EN YAKIN splat çevresinde küre — arkadaki yüzeyi almaz',
};

const serit: CSSProperties = {
  position: 'absolute',
  left: bosluk.s,
  top: bosluk.s,
  right: bosluk.s,
  zIndex: 8,
  ...cam({ blur: 20, radius: yaricap.kart }),
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: bosluk.s,
  padding: bosluk.s,
  fontFamily: SANS,
};

const ayrac: CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  minHeight: 20,
  background: renk.kenar,
  flex: '0 0 auto',
};

const hataSatiri: CSSProperties = {
  flexBasis: '100%',
  fontSize: yazi.kucuk,
  color: renk.kotu,
};
