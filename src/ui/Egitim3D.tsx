import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { egitimBaslat, kameraMerkezi, yorunge, type Egitim, type EgitimMetrik } from '../engine/reconstruction/egitim3dgs';
import { bindWheelZoom, boundedZoomFactor, flyAxes, flyRadius, flyStep, lookAround } from './egitimControls';
import { egitimGpuHint } from './egitimGpuHint';
import { ayarOzeti, egitimOnKontrol, type OnKontrol } from './egitimOnKontrol';
import { ayarSec, type EgitimAyari } from '../engine/reconstruction/egitim3dgs';

/**
 * The splat.js training view overlays the engine canvas. Training starts
 * after the preflight choice; unmount releases the GPU session. The training
 * rasterizer renders its own scene, independent of the engine's render modes.
 */
export function Egitim3D({ dosya, onKapat, say }: { dosya: File; onKapat(): void; say(m: string): void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const egitimRef = useRef<Egitim | null>(null);
  const homeDistanceRef = useRef(0);
  const homeCameraRef = useRef<Egitim['kamera'] | null>(null);
  // Free-fly is opt-in; orbit stays the default. The ref lets the wheel and
  // pointer handlers read the mode without re-binding.
  const [ucus, setUcus] = useState(false);
  const ucusRef = useRef(false);
  ucusRef.current = ucus;
  const heldKeys = useRef(new Set<string>());
  const [started, setStarted] = useState(false);
  const [subjectOnly, setSubjectOnly] = useState(false);
  const [asama, setAsama] = useState('başlıyor');
  const [metrik, setMetrik] = useState<EgitimMetrik | null>(null);
  const [bitti, setBitti] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [plyBusy, setPlyBusy] = useState(false);
  const [gpu, setGpu] = useState<{ ad: string; entegre: boolean; iter: number } | null>(null);
  /** Z2 — ön kontrol: eğitim BAŞLAMADAN cihazın yapabildiği söylenir. */
  const [onKontrol, setOnKontrol] = useState<OnKontrol | null>(null);
  const [onAyar, setOnAyar] = useState<EgitimAyari | null>(null);
  // App'in `say`'ı her render'da yeni fonksiyon: effect bağımlılığı olursa
  // her render eğitimi baştan başlatır. Ref üzerinden çağrılır.
  const sayRef = useRef(say);
  sayRef.current = say;

  // Ön ayar ekranı açılır açılmaz cihaz sorulur: WebGPU var mı, hangi GPU
  // seçilir, hangi ayar katmanı uygulanır. Eskiden bu ancak "başlat"tan
  // SONRA, kare çıkarma sırasında öğreniliyordu.
  useEffect(() => {
    if (started) return;
    let iptal = false;
    ayarSec()
      .then((a) => {
        if (iptal) return;
        setOnAyar(a);
        setOnKontrol(egitimOnKontrol({ webgpu: true, ua: navigator.userAgent }));
      })
      .catch(() => {
        if (iptal) return;
        setOnAyar(null);
        setOnKontrol(egitimOnKontrol({ webgpu: false, ua: navigator.userAgent }));
      });
    return () => {
      iptal = true;
    };
  }, [started]);

  useEffect(() => {
    if (!started) return;
    let iptal = false;
    const controller = new AbortController();
    const t0 = performance.now();
    egitimBaslat(dosya, canvasRef.current!, {
      ayar: (selected) => { if (!iptal) setGpu({ ad: selected.gpu, entegre: selected.entegreGpu, iter: selected.maxIters }); },
      asama: (m) => { if (!iptal) setAsama(m); },
      metrik: (m) => { if (!iptal) setMetrik(m); },
      bitti: (m) => {
        if (iptal) return;
        setBitti(true);
        sayRef.current(`3D eğitim bitti · ${Math.round((performance.now() - t0) / 1000)} sn · ` +
          `${m?.splats.toLocaleString('tr-TR') ?? '?'} Gaussian · test ${subjectOnly ? 'özne ' : ''}PSNR ${m?.psnrHold?.toFixed(1) ?? '?'}`);
      },
      hata: (e) => { if (!iptal) setHata(e.message); },
    }, undefined, controller.signal, { subjectOnly }).then((e) => {
      // An abort may win just as setup resolves; do not attach a closed session.
      if (iptal) { e.kapat(); return; }
      egitimRef.current = e;
      homeCameraRef.current = e.kamera;
      const center = kameraMerkezi(e.kamera);
      homeDistanceRef.current = Math.hypot(...center.map((value, i) => value - e.pivot[i]));
    }).catch((e: unknown) => {
      if (!iptal) setHata(e instanceof Error ? e.message : String(e));
    });
    return () => {
      iptal = true;
      controller.abort();
      egitimRef.current?.kapat();
      egitimRef.current = null;
    };
  }, [dosya, started, subjectOnly]);

  // Sürükle = yörünge. 1000 px ≈ 180°: videolar tipik olarak dar bir yay
  // çeker, eğitim görüntülerinin dışı bulanıktır — hassas döndürme orada kalır.
  const surukle = useRef<{ x: number; y: number } | null>(null);
  const dondur = (yaw: number, pitch: number, yakin = 1) => {
    const e = egitimRef.current;
    if (!e) return;
    e.kameraAyarla(ucusRef.current
      ? lookAround(e.kamera, e.yukari, yaw, pitch)
      : yorunge(e.kamera, e.pivot, e.yukari, yaw, pitch, yakin));
  };
  const ucusYaricapi = (e: Egitim) => flyRadius(homeDistanceRef.current, e.yaricap);

  useEffect(() => {
    // The preflight view has no canvas; attach the wheel listener after Start.
    const canvas = canvasRef.current;
    if (!canvas) return;
    return bindWheelZoom(canvas, (factor) => {
      const e = egitimRef.current;
      if (!e) return;
      if (ucusRef.current) {
        // Orbit zoom toward a pivot the camera may no longer face would feel
        // random; in free-fly the wheel dollies along the view instead.
        const radius = ucusYaricapi(e);
        e.kameraAyarla(flyStep(e.kamera, { forward: factor < 1 ? 1 : -1, right: 0, vertical: 0 },
          Math.abs(Math.log(factor)) * radius * 0.1, e.pivot, radius, e.yukari));
        return;
      }
      const center = kameraMerkezi(e.kamera);
      const distance = Math.hypot(...center.map((value, i) => value - e.pivot[i]));
      const bounded = boundedZoomFactor(distance, homeDistanceRef.current, factor);
      e.kameraAyarla(yorunge(e.kamera, e.pivot, e.yukari, 0, 0, bounded));
    });
  }, [started]);

  useEffect(() => {
    if (!ucus) return;
    const keys = heldKeys.current;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      // Clamp dt so a backgrounded tab does not teleport the camera on return.
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const e = egitimRef.current;
      const axes = flyAxes(keys);
      if (e && (axes.forward || axes.right || axes.vertical)) {
        const radius = ucusYaricapi(e);
        const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1;
        e.kameraAyarla(flyStep(e.kamera, axes, radius * 0.25 * boost * dt, e.pivot, radius, e.yukari));
      }
      frame = requestAnimationFrame(tick);
    });
    return () => { cancelAnimationFrame(frame); keys.clear(); };
  }, [ucus]);

  function gorunumuSifirla() {
    const e = egitimRef.current;
    heldKeys.current.clear();
    if (e && homeCameraRef.current) e.kameraAyarla(homeCameraRef.current);
  }

  async function plyIndir() {
    const e = egitimRef.current;
    if (!e || plyBusy) return;
    setPlyBusy(true);
    try {
      const url = URL.createObjectURL(await e.plyBlob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dosya.name.replace(/\.[^.]+$/, '')}-3dgs.ply`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      sayRef.current('3DGS .ply indirildi');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHata(`PLY dışa aktarılamadı: ${message}`);
      sayRef.current(`3DGS PLY HATA: ${message}`);
    } finally {
      setPlyBusy(false);
    }
  }

  function devamEt() {
    const e = egitimRef.current;
    if (!e) return;
    try {
      const target = e.devamEt();
      setGpu((current) => current ? { ...current, iter: target } : current);
      setBitti(false);
      setHata(null);
      setAsama(`eğitim sürüyor · hedef ${target} iterasyon`);
      sayRef.current(`3D eğitim aynı sahnede sürdürüldü · hedef ${target} iterasyon · kalite sonucu test PSNR ile izlenir`);
    } catch (error) {
      setHata(error instanceof Error ? error.message : String(error));
    }
  }

  const yuzde = metrik && gpu ? Math.min(100, (metrik.iter / gpu.iter) * 100) : 0;
  const gpuHint = gpu ? egitimGpuHint(gpu.ad, gpu.entegre, navigator.userAgent) : null;

  if (!started) return (
    <div style={{ ...kaplama, display: 'grid', placeItems: 'center' }}>
      <div style={onAyarlama}>
        <strong>3D eğit</strong>
        <p>{dosya.name}</p>
        {/* Z2 — CİHAZ ÖN KONTROLÜ: ne olacağı baştan söylenir. */}
        <div style={onKontrolKutusu(onKontrol?.calisir !== false)}>
          <div>{onKontrol ? onKontrol.baslik : 'cihaz kontrol ediliyor…'}</div>
          {onAyar && (
            <div style={{ color: '#8ab', marginTop: 4 }}>{ayarOzeti(onAyar)}</div>
          )}
          {onKontrol && onKontrol.adimlar.length > 0 && (
            <ol style={{ margin: '6px 0 0', paddingLeft: 18, color: '#c8c8d4', lineHeight: 1.5 }}>
              {onKontrol.adimlar.map((adim) => (
                <li key={adim}>{adim}</li>
              ))}
            </ol>
          )}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={subjectOnly} onChange={(event) => setSubjectOnly(event.target.checked)} />
          Yalnız özneyi eğit (deneysel)
        </label>
        <p style={{ color: '#aaa', lineHeight: 1.5 }}>
          Bu seçenek her seçilen kareye IS-Net maskesi uygular; hazırlık süresi artar.
          Nesne videolarında arka planı azaltabilir, kalite artışı henüz ölçülmedi.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={dugme} onClick={onKapat}>kapat</button>
          <button
            style={{ ...dugme, opacity: onKontrol?.calisir === false ? 0.5 : 1 }}
            disabled={onKontrol?.calisir === false}
            title={onKontrol?.calisir === false ? 'WebGPU olmadan eğitim başlatılamaz' : 'eğitimi başlat'}
            onClick={() => setStarted(true)}
          >
            eğitimi başlat
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={kaplama}>
      <canvas
        ref={canvasRef}
        width={960}
        height={540}
        tabIndex={0}
        style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'grab', touchAction: 'none' }}
        onKeyDown={(ev) => {
          if (!ucus || ev.ctrlKey || ev.metaKey || ev.altKey) return;
          heldKeys.current.add(ev.code);
          if (/^Key[WASDQE]$/.test(ev.code)) ev.preventDefault();
        }}
        onKeyUp={(ev) => { heldKeys.current.delete(ev.code); }}
        onBlur={() => heldKeys.current.clear()}
        onPointerDown={(ev) => {
          if (ev.button !== 0) return;
          ev.currentTarget.focus();
          surukle.current = { x: ev.clientX, y: ev.clientY };
          ev.currentTarget.setPointerCapture(ev.pointerId);
        }}
        onPointerMove={(ev) => {
          const s = surukle.current;
          if (!s) return;
          dondur(-(ev.clientX - s.x) * (Math.PI / 1000), -(ev.clientY - s.y) * (Math.PI / 1000));
          surukle.current = { x: ev.clientX, y: ev.clientY };
        }}
        onPointerUp={() => { surukle.current = null; }}
        onPointerCancel={() => { surukle.current = null; }}
        onLostPointerCapture={() => { surukle.current = null; }}
      />
      <div style={serit}>
        <span style={{ flex: 1 }}>
          {hata
            ? <b style={{ color: '#e66' }}>HATA: {hata}</b>
            : bitti
              ? `bitti · ${metrik?.splats.toLocaleString('tr-TR')} Gaussian · test ${subjectOnly ? 'özne ' : ''}PSNR ${metrik?.psnrHold?.toFixed(1) ?? '?'} · ${ucus ? 'WASD gez · Q/E alçal/yüksel · Shift hızlı · sürükle = bak' : 'sürükle = döndür'}`
              : metrik
                ? `eğitim ${metrik.iter}/${gpu?.iter} · ${metrik.itersPerSec} iter/sn · ${metrik.splats.toLocaleString('tr-TR')} Gaussian`
                : asama}
        </span>
        <button
          style={dugme}
          aria-pressed={ucus}
          title="Açıkken WASD ile sahnede yürü, Q/E ile alçal/yüksel, sürükleyerek etrafa bak"
          onClick={() => { setUcus((on) => !on); canvasRef.current?.focus(); }}
        >
          {ucus ? 'yörüngeye dön' : 'serbest gezin (WASD)'}
        </button>
        <button style={dugme} onClick={gorunumuSifirla}>görünümü sıfırla</button>
        {bitti && gpu?.entegre && (
          <button style={dugme} onClick={devamEt} title="Aynı sahnede 4.000 iterasyon daha; kalite etkisi videoya göre değişir">
            sürdür +4.000 (deneysel)
          </button>
        )}
        {bitti && <button style={dugme} disabled={plyBusy} onClick={plyIndir}>{plyBusy ? 'PLY hazırlanıyor…' : '.ply indir'}</button>}
        {/* Z2 — KURTARMA YOLU: hata sonrası tek yol "kapat" idi; kullanıcı
            videoyu yeniden seçmek zorunda kalıyordu. Şimdi aynı dosyayla ön
            ayara dönülür (oturum kapatılır, GPU serbest bırakılır). */}
        {hata && (
          <button
            style={dugme}
            title="aynı videoyla ön ayar ekranına dön ve yeniden dene"
            onClick={() => {
              egitimRef.current?.kapat();
              egitimRef.current = null;
              setHata(null);
              setMetrik(null);
              setBitti(false);
              setAsama('başlıyor');
              setStarted(false);
            }}
          >
            tekrar dene
          </button>
        )}
        <button style={dugme} onClick={onKapat}>kapat</button>
      </div>
      {!bitti && !hata && <div style={{ ...cubuk, width: `${yuzde}%` }} />}
      {/* Z2 — SEÇİLEN GPU VE AYAR KATMANI her cihazda görünür. Eskiden yalnız
          Intel iGPU'ya özel ipucu vardı; başka bir GPU'da kullanıcı hangi
          ayarla koştuğunu hiç öğrenmiyordu. */}
      {(onAyar || gpuHint) && (
        <div role="status" style={{ ...serit, top: 0, bottom: 'auto', color: gpuHint ? '#db6' : '#89a', padding: '8px', display: 'grid', gap: 4 }}>
          {onAyar && <span>{ayarOzeti(onAyar)}</span>}
          {gpuHint && <span>{gpuHint}</span>}
        </div>
      )}
    </div>
  );
}

const kaplama: CSSProperties = { position: 'absolute', inset: 0, background: '#000', zIndex: 5 };
function onKontrolKutusu(calisir: boolean): CSSProperties {
  return {
    padding: '6px 8px',
    borderRadius: 3,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: calisir ? '#2a3a4a' : '#6b4a12',
    background: calisir ? '#12161c' : '#17130a',
    color: calisir ? '#c8c8d4' : '#f0b429',
    fontSize: 12,
  };
}

const onAyarlama: CSSProperties = {
  width: 'min(430px, calc(100% - 32px))', padding: 20, border: '1px solid #333',
  borderRadius: 8, background: '#15151d', color: '#c8c8d4', fontSize: 13,
};
const serit: CSSProperties = {
  position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', gap: 8, alignItems: 'center',
  padding: '4px 8px', background: 'rgba(0,0,0,0.7)', color: '#c8c8d4', fontSize: 12,
};
const cubuk: CSSProperties = { position: 'absolute', left: 0, bottom: 0, height: 2, background: '#6af', transition: 'width 0.5s' };
const dugme: CSSProperties = {
  fontFamily: 'inherit', fontSize: 12, padding: '2px 8px', background: '#1a1a22', color: '#c8c8d4',
  border: '1px solid #333', borderRadius: 3, cursor: 'pointer',
};
