import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ekranaProjekte, ekranYaricapiniDunyaya, enYakinSplat, fircaSecimi, geriAl, gorunurSayisi,
  hepsiniGeriAl, kureSecimi, lassoSecimi, silmeUygula, type SecimAraci, type SilmeKaydi,
} from './splatSecim';
import { bosluk, cam, dugme, MONO, renk, SANS, yaricap, yazi } from './tema';

/**
 * SPLAT TEMİZLEME ARACI — sahnenin üstünde 2D seçim katmanı.
 *
 * Sahne WebGL'de çizilir; seçim ve vurgu 2D kanvasta. Vurgu için GaussianBuffer'ın
 * RENK kanalına (gSplatC) DOKUNULMAZ: renk yazmak orijinal veriyi bozar ve geri
 * alma iki kanalı birden takip etmek zorunda kalırdı. Vurgu yalnız bu katmanda
 * yaşar — seçim kaybolunca sahne bit bit aynı kalır.
 *
 * DÖRT MOD, BİRİ SEÇİM DEĞİL: `gez` açıkken katman hiçbir olayı almaz
 * (`pointerEvents: none`) ve OrbitControls eskisi gibi çalışır. Sebep ölçülebilir:
 * katman sahnenin ÜSTÜNDE olduğu için olayları yakaladığında kamera kilitlenir —
 * floater'ı bulmak için döndürmek gerekiyor, dolayısıyla "gez" varsayılan mod.
 * Seçim modlar arasında KORUNUR: seç → gez → doğrula → sil akışı bozulmaz.
 *
 * KAPSAM (dürüstlük kaydı): bu araç MOTORUN GaussianBuffer'ını temizler (splat
 * modu, füzyon/köprü çıktısı). 3D eğitim görünümündeki sahne splat.js'in KENDİ
 * tamponunda yaşar ve dışarıya açılmıyor — PLY çıktısındaki floater'lar orada.
 * Onu temizlemek için eğitim oturumunun Gaussian dizisine bir tutamaç gerekiyor
 * (veri katmanı işi); araç o tutamaç gelince aynı seçim mantığıyla çalışır,
 * çünkü `splatSecim.ts` yalnız bir xyzw dizisi ister.
 */
export function SplatTemizleme({
  engine,
  onKapat,
  say,
}: {
  engine: {
    gaussianSnapshot(): { a: Float32Array; count: number } | null;
    splatViewProjection(): Float32Array | null;
    commitSplatOpacity(): void;
    /** Çizimin kullandığı opaklık kapısı — seçimin "görünür" tanımı buna eşit olmalı. */
    splatOpacityThreshold: number;
  };
  onKapat(): void;
  say(m: string): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [arac, setArac] = useState<SecimAraci | 'gez'>('gez');
  const [boyut, setBoyut] = useState(28);
  /** Seçili indeksler — Set, fırça darbeleri birikerek genişlesin diye. */
  const secimRef = useRef<Set<number>>(new Set());
  const [secimSayisi, setSecimSayisi] = useState(0);
  const gecmisRef = useRef<SilmeKaydi[]>([]);
  const [gecmisBoy, setGecmisBoy] = useState(0);
  const [kalan, setKalan] = useState<{ gorunur: number; toplam: number } | null>(null);

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

  /** Splat verisi + o ANIN matrisi; her seçimde tazelenir (kamera döner). */
  function veri(genislik: number, yukseklik: number) {
    const snap = engine.gaussianSnapshot();
    const vp = engine.splatViewProjection();
    if (!snap || !vp) return null;
    const ekran = ekranaProjekte(snap.a, snap.count, vp, genislik, yukseklik, ekranRef.current ?? undefined);
    ekranRef.current = ekran;
    return { a: snap.a, count: snap.count, vp, ekran };
  }

  function kalanTazele() {
    const snap = engine.gaussianSnapshot();
    // Kapı motordan okunur: nesne ayırma açıkken 0.50'ye çıkıyor ve arka plan
    // splat'ları ZATEN çizilmiyor. Sabit eşik burada yalan bir "kalan" yazardı.
    if (snap) {
      setKalan({
        gorunur: gorunurSayisi(snap.a, snap.count, engine.splatOpacityThreshold),
        toplam: snap.count,
      });
    }
  }

  useEffect(() => {
    kalanTazele();
    // Araç kapanırken seçim vurgusu da gitmeli; motor sahnesine hiçbir iz
    // bırakılmaz (vurgu zaten yalnız bu katmanda yaşıyordu).
    return () => { secimRef.current.clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * ÇİZİM DÖNGÜSÜ. Kamera motorun kendi rAF'ında döndüğü için vurgu her karede
   * yeniden projekte edilmeli, yoksa noktalar sahnenin gerisinde kalır.
   * Matris DEĞİŞMEDİYSE projeksiyon atlanır — durağan sahnede 147k çarpma boşa
   * gitmesin.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let sonVp: Float32Array | null = null;
    let sonSecim = -1;

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

      const secim = secimRef.current;
      const vp = engine.splatViewProjection();
      const snap = engine.gaussianSnapshot();
      if (vp && snap && secim.size > 0) {
        const degisti = !sonVp || vp.some((v, i) => v !== sonVp![i]) || sonSecim !== secim.size;
        if (degisti) {
          ekranRef.current = ekranaProjekte(snap.a, snap.count, vp, w, h, ekranRef.current ?? undefined);
          sonVp = Float32Array.from(vp);
          sonSecim = secim.size;
        }
        const ekran = ekranRef.current!;
        // Seçim vurgusu: tek renk, tek geçiş. Parlama YOK (tema kuralı: tek
        // ışık kaynağı) — dolgu opaklığı yeterli ayrım veriyor.
        ctx.fillStyle = 'rgba(248,113,113,0.85)';
        for (const i of secim) {
          const k = i * 3;
          if (!(ekran[k + 2] > 0)) continue;
          ctx.fillRect(ekran[k] - 1, ekran[k + 1] - 1, 2.5, 2.5);
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
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  function yerel(ev: ReactPointerEvent<HTMLCanvasElement>) {
    const r = ev.currentTarget.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top, w: r.width, h: r.height };
  }

  function fircaVur(x: number, y: number, w: number, h: number) {
    const d = veri(w, h);
    if (!d) return;
    const bulunan = fircaSecimi(d.ekran, d.a, d.count, w, h, x, y, boyut, engine.splatOpacityThreshold);
    const s = secimRef.current;
    for (const i of bulunan) s.add(i);
    setSecimSayisi(s.size);
  }

  function kureVur(x: number, y: number, w: number, h: number) {
    const d = veri(w, h);
    if (!d) return;
    const merkezIdx = enYakinSplat(d.ekran, d.a, d.count, w, h, x, y, boyut, engine.splatOpacityThreshold);
    if (merkezIdx === null) {
      sayRef.current('temizleme: imleç altında splat yok');
      return;
    }
    const o = merkezIdx * 4;
    const wClip = d.ekran[merkezIdx * 3 + 2];
    const r = ekranYaricapiniDunyaya(d.vp, wClip, boyut, w);
    const bulunan = kureSecimi(d.a, d.count, [d.a[o], d.a[o + 1], d.a[o + 2]], r, engine.splatOpacityThreshold);
    const s = secimRef.current;
    for (const i of bulunan) s.add(i);
    setSecimSayisi(s.size);
  }

  function lassoBitir(w: number, h: number) {
    const yol = lassoRef.current;
    if (yol.length >= 6) {
      const d = veri(w, h);
      if (d) {
        const bulunan = lassoSecimi(d.ekran, d.a, d.count, w, h, yol, engine.splatOpacityThreshold);
        const s = secimRef.current;
        for (const i of bulunan) s.add(i);
        setSecimSayisi(s.size);
      }
    }
    lassoRef.current = [];
  }

  function sil() {
    const snap = engine.gaussianSnapshot();
    const s = secimRef.current;
    if (!snap || s.size === 0) return;
    const kayit = silmeUygula(snap.a, Int32Array.from(s));
    s.clear();
    setSecimSayisi(0);
    if (!kayit) { sayRef.current('temizleme: seçilenler zaten silinmişti'); return; }
    gecmisRef.current.push(kayit);
    setGecmisBoy(gecmisRef.current.length);
    engine.commitSplatOpacity();
    kalanTazele();
    sayRef.current(`temizleme: ${kayit.indeksler.length.toLocaleString('tr-TR')} splat silindi · geri alınabilir`);
  }

  function sonuGeriAl() {
    const snap = engine.gaussianSnapshot();
    const kayit = gecmisRef.current.pop();
    if (!snap || !kayit) return;
    const n = geriAl(snap.a, kayit);
    setGecmisBoy(gecmisRef.current.length);
    engine.commitSplatOpacity();
    kalanTazele();
    sayRef.current(`temizleme: ${n.toLocaleString('tr-TR')} splat geri geldi`);
  }

  function tumunuGeriAl() {
    const snap = engine.gaussianSnapshot();
    if (!snap || gecmisRef.current.length === 0) return;
    const n = hepsiniGeriAl(snap.a, gecmisRef.current);
    gecmisRef.current = [];
    setGecmisBoy(0);
    engine.commitSplatOpacity();
    kalanTazele();
    sayRef.current(`temizleme: tüm silmeler geri alındı · ${n.toLocaleString('tr-TR')} splat`);
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
          // GEZ modunda katman saydam bir seyirci: olaylar OrbitControls'a gider.
          pointerEvents: arac === 'gez' ? 'none' : 'auto',
          cursor: arac === 'lasso' ? 'crosshair' : 'none',
          touchAction: 'none',
          zIndex: 4,
        }}
        onPointerDown={(ev) => {
          if (ev.button !== 0) return;
          const { x, y, w, h } = yerel(ev);
          // Yakalama BAŞARISIZ OLABİLİR (işaretçi artık etkin değilse tarayıcı
          // NotFoundError atar). Atarsa seçim hiç başlamıyordu — tek bir fırça
          // darbesi sessizce yutuluyordu. Yakalama bir KOLAYLIK (imleç tuvalden
          // çıkınca da boyamaya devam etsin); seçimin ön koşulu değil.
          try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* yakalamasız devam */ }
          basiliRef.current = true;
          imlecRef.current = { x, y };
          if (arac === 'firca') fircaVur(x, y, w, h);
          else if (arac === 'kure') kureVur(x, y, w, h);
          else if (arac === 'lasso') lassoRef.current = [x, y];
        }}
        onPointerMove={(ev) => {
          const { x, y, w, h } = yerel(ev);
          imlecRef.current = { x, y };
          if (!basiliRef.current) return;
          if (arac === 'firca') fircaVur(x, y, w, h);
          else if (arac === 'lasso') {
            const yol = lassoRef.current;
            // Nokta seyreltme: her pixelde bir nokta eklemek poligonu 2000
            // köşeye çıkarıyordu; ışın atma maliyeti köşe sayısıyla çarpılır.
            const n = yol.length;
            if (n < 2 || Math.hypot(x - yol[n - 2], y - yol[n - 1]) > 4) yol.push(x, y);
          }
        }}
        onPointerUp={(ev) => {
          const { w, h } = yerel(ev);
          basiliRef.current = false;
          if (arac === 'lasso') lassoBitir(w, h);
        }}
        onPointerCancel={() => { basiliRef.current = false; lassoRef.current = []; }}
        onLostPointerCapture={() => { basiliRef.current = false; }}
        onPointerLeave={() => { imlecRef.current = null; }}
      />

      <div style={serit}>
        <span style={{ fontSize: yazi.kucuk, color: renk.metinSolgun, fontWeight: 600 }}>temizle</span>
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
          style={{ ...dugme(secimVar), minHeight: 32, padding: '7px 12px', opacity: secimVar ? 1 : 0.5 }}
          disabled={!secimVar}
          title="seçili splat'ların opaklığı 0'a çekilir — geri alınabilir"
          onClick={sil}
        >
          sil{secimVar ? ` (${secimSayisi.toLocaleString('tr-TR')})` : ''}
        </button>
        <button
          type="button"
          style={{ ...dugme(), minHeight: 32, padding: '7px 10px', opacity: gecmisBoy ? 1 : 0.5 }}
          disabled={!gecmisBoy}
          onClick={sonuGeriAl}
          title="son silmeyi geri al"
        >
          ↶ geri al{gecmisBoy ? ` (${gecmisBoy})` : ''}
        </button>
        <button
          type="button"
          style={{ ...dugme(), minHeight: 32, padding: '7px 10px', opacity: gecmisBoy ? 1 : 0.5 }}
          disabled={!gecmisBoy}
          onClick={tumunuGeriAl}
          title="tüm silmeleri geri al"
        >
          hepsi
        </button>

        <span style={ayrac} />
        {/* Zeigarnik: yapılan iş sayı olarak görünür kalsın. */}
        <span style={{ fontFamily: MONO, fontSize: yazi.kucuk, color: renk.metinSilik, fontVariantNumeric: 'tabular-nums' }}>
          {kalan ? `${kalan.gorunur.toLocaleString('tr-TR')} / ${kalan.toplam.toLocaleString('tr-TR')}` : '—'}
        </span>
        <button type="button" style={{ ...dugme(), minHeight: 32, padding: '7px 10px' }} onClick={onKapat}>kapat</button>
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
  zIndex: 6,
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
