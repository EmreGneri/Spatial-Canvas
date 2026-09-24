import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { egitimBaslat, kameraMerkezi, yorunge, type Egitim, type EgitimMetrik } from '../engine/reconstruction/egitim3dgs';
import { bindWheelZoom, boundedZoomFactor } from './egitimControls';
import { egitimGpuHint } from './egitimGpuHint';

/**
 * The splat.js training view overlays the engine canvas. Training starts
 * after the preflight choice; unmount releases the GPU session. The training
 * rasterizer renders its own scene, independent of the engine's render modes.
 */
export function Egitim3D({ dosya, onKapat, say }: { dosya: File; onKapat(): void; say(m: string): void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const egitimRef = useRef<Egitim | null>(null);
  const homeDistanceRef = useRef(0);
  const [started, setStarted] = useState(false);
  const [subjectOnly, setSubjectOnly] = useState(false);
  const [asama, setAsama] = useState('başlıyor');
  const [metrik, setMetrik] = useState<EgitimMetrik | null>(null);
  const [bitti, setBitti] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [plyBusy, setPlyBusy] = useState(false);
  const [gpu, setGpu] = useState<{ ad: string; entegre: boolean; iter: number } | null>(null);
  // App'in `say`'ı her render'da yeni fonksiyon: effect bağımlılığı olursa
  // her render eğitimi baştan başlatır. Ref üzerinden çağrılır.
  const sayRef = useRef(say);
  sayRef.current = say;

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
    if (e) e.kameraAyarla(yorunge(e.kamera, e.pivot, e.yukari, yaw, pitch, yakin));
  };

  useEffect(() => {
    // The preflight view has no canvas; attach the wheel listener after Start.
    const canvas = canvasRef.current;
    if (!canvas) return;
    return bindWheelZoom(canvas, (factor) => {
      const e = egitimRef.current;
      if (!e) return;
      const center = kameraMerkezi(e.kamera);
      const distance = Math.hypot(...center.map((value, i) => value - e.pivot[i]));
      const bounded = boundedZoomFactor(distance, homeDistanceRef.current, factor);
      e.kameraAyarla(yorunge(e.kamera, e.pivot, e.yukari, 0, 0, bounded));
    });
  }, [started]);

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
          <button style={dugme} onClick={() => setStarted(true)}>eğitimi başlat</button>
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
        style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'grab', touchAction: 'none' }}
        onPointerDown={(ev) => {
          if (ev.button !== 0) return;
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
              ? `bitti · ${metrik?.splats.toLocaleString('tr-TR')} Gaussian · test ${subjectOnly ? 'özne ' : ''}PSNR ${metrik?.psnrHold?.toFixed(1) ?? '?'} · sürükle = döndür`
              : metrik
                ? `eğitim ${metrik.iter}/${gpu?.iter} · ${metrik.itersPerSec} iter/sn · ${metrik.splats.toLocaleString('tr-TR')} Gaussian`
                : asama}
        </span>
        {bitti && gpu?.entegre && (
          <button style={dugme} onClick={devamEt} title="Aynı sahnede 4.000 iterasyon daha; kalite etkisi videoya göre değişir">
            sürdür +4.000 (deneysel)
          </button>
        )}
        {bitti && <button style={dugme} disabled={plyBusy} onClick={plyIndir}>{plyBusy ? 'PLY hazırlanıyor…' : '.ply indir'}</button>}
        <button style={dugme} onClick={onKapat}>kapat</button>
      </div>
      {!bitti && !hata && <div style={{ ...cubuk, width: `${yuzde}%` }} />}
      {gpuHint && (
        <div role="status" style={{ ...serit, top: 0, bottom: 'auto', color: '#db6', padding: '8px' }}>
          {gpuHint}
        </div>
      )}
    </div>
  );
}

const kaplama: CSSProperties = { position: 'absolute', inset: 0, background: '#000', zIndex: 5 };
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
