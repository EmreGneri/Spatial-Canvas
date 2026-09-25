import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Engine } from '../engine';
import { exportPly, exportPNG, exportWebM } from '../engine/export';
import { SPLAT_FLATTEN } from '../shaders/splatMaterial';
import { imzaCiz } from './imzaCiz';

/**
 * ÇIKTI ŞERİDİ — Z1 (render katmanı, Zeynep).
 *
 * Eskiden PNG / PLY / WebM üç ayrı düğmeydi ve akış hamdı:
 *  · WebM süresi "⏱" düğmesinin arkasında gizliydi (5→10→20 döngüsü);
 *    kullanıcı kaç saniye kaydedeceğini görmeden basıyordu,
 *  · kayıt sırasında HİÇBİR geri bildirim yoktu — ekranda bir şey değişmiyor,
 *    dosya de 5-20 saniye boyunca gelmiyordu; iki kez basmak kolaydı,
 *  · çıktının nereye gittiği yalnız en alttaki log şeridinden okunuyordu.
 *
 * Burada üçü tek şeritte toplanır: süre açıkça seçilir, kayıt geri sayımla
 * ilerler, sonuç şeridin kendi durum satırında görünür.
 *
 * SAHİPLİK: `engine/export.ts` (Emre) DEĞİŞMEDİ — bu dosya yalnız onu çağırır.
 * İmza da motor tarafına dokunmadan, ara bir 2D canvas üzerinde çizilir.
 */

const SURELER = [5, 10, 20] as const;

type Durum =
  | { tip: 'bos' }
  | { tip: 'calisiyor'; etiket: string; kalanSn?: number }
  | { tip: 'bitti'; mesaj: string }
  | { tip: 'hata'; mesaj: string };

export function ExportBar({ engine, say }: { engine: Engine | null; say: (mesaj: string) => void }) {
  const [sure, setSure] = useState<number>(5);
  const [imza, setImza] = useState(true);
  const [durum, setDurum] = useState<Durum>({ tip: 'bos' });
  const sayacRef = useRef<number | null>(null);

  useEffect(() => () => { if (sayacRef.current !== null) clearInterval(sayacRef.current); }, []);

  const mesgul = durum.tip === 'calisiyor';

  function bitir(mesaj: string) {
    setDurum({ tip: 'bitti', mesaj });
    say(mesaj);
  }

  function hata(onEk: string, e: unknown) {
    const mesaj = `${onEk}: ${e instanceof Error ? e.message : String(e)}`;
    setDurum({ tip: 'hata', mesaj });
    say(mesaj);
  }

  async function pngIndir() {
    if (!engine || mesgul) return;
    setDurum({ tip: 'calisiyor', etiket: 'PNG hazırlanıyor' });
    try {
      const canvas = engine.renderer.domElement;
      if (imza) {
        // İmzalı yol: motorun karesi 2D kopyaya alınır, imza üstüne çizilir.
        // WebGL tamponu compositing sonrası geçersiz olduğu için kopyalamadan
        // HEMEN ÖNCE bir kare çizdirilir (export.ts'in onBeforeCapture ile
        // yaptığının aynısı).
        engine.renderFrame();
        const kopya = imzaliKopya(canvas);
        await exportPNG(kopya, 'spatial-canvas');
      } else {
        await exportPNG(canvas, 'spatial-canvas', { onBeforeCapture: () => engine.renderFrame() });
      }
      bitir('PNG indirildi');
    } catch (e) {
      hata('PNG HATA', e);
    }
  }

  async function webmKaydet() {
    if (!engine || mesgul) return;
    const canvas = engine.renderer.domElement;
    setDurum({ tip: 'calisiyor', etiket: 'kaydediliyor', kalanSn: sure });
    const bitis = performance.now() + sure * 1000;
    sayacRef.current = window.setInterval(() => {
      const kalan = Math.max(0, Math.ceil((bitis - performance.now()) / 1000));
      setDurum((d) => (d.tip === 'calisiyor' ? { ...d, kalanSn: kalan } : d));
    }, 250);

    // İmzalı yolda kaydedilen yüzey ara canvas'tır: her karede motorun
    // görüntüsü kopyalanır, imza üstüne çizilir. `captureStream` bu canvas'tan
    // alınır, motorun kendi tamponu değişmez.
    let raf = 0;
    let hedef = canvas;
    if (imza) {
      const ara = document.createElement('canvas');
      ara.width = canvas.width;
      ara.height = canvas.height;
      const ctx = ara.getContext('2d')!;
      const pompa = () => {
        raf = requestAnimationFrame(pompa);
        engine.renderFrame();
        ctx.drawImage(canvas, 0, 0);
        imzaCiz(ctx, ara.width, ara.height);
      };
      pompa();
      hedef = ara;
    }

    try {
      await exportWebM(hedef, { durationSec: sure });
      bitir(`WebM indirildi · ${sure} sn${imza ? ' · imzalı' : ''}`);
    } catch (e) {
      hata('WebM HATA', e);
    } finally {
      if (raf) cancelAnimationFrame(raf);
      if (sayacRef.current !== null) {
        clearInterval(sayacRef.current);
        sayacRef.current = null;
      }
    }
  }

  function plyIndir() {
    if (!engine || mesgul) return;
    const snap = engine.gaussianSnapshot();
    if (!snap) {
      // Sessizce boş dosya indirmek yerine sebebi söyle (E1 kararı).
      const mesaj = 'PLY: sahnede splat yok (önce "video → 3B" ya da "3D eğit" çalıştır)';
      setDurum({ tip: 'hata', mesaj });
      say(mesaj);
      return;
    }
    try {
      exportPly({ ...snap, flatten: SPLAT_FLATTEN }, 'spatial-canvas');
      bitir(`PLY indirildi · ${snap.count.toLocaleString('tr-TR')} splat`);
    } catch (e) {
      hata('PLY HATA', e);
    }
  }

  return (
    <div style={seritStyle}>
      <span style={{ color: '#667' }}>çıktı:</span>

      <button type="button" style={dugme} disabled={!engine || mesgul} onClick={pngIndir} title="tek kareyi PNG olarak indir">
        PNG
      </button>

      <span style={grupStyle}>
        <button
          type="button"
          style={dugme}
          disabled={!engine || mesgul}
          onClick={webmKaydet}
          title={`sahneyi ${sure} saniye kaydet ve WebM olarak indir`}
        >
          WebM
        </button>
        {/* Süre artık gizli bir döngünün arkasında değil: hangi süreye
            basacağın önceden görünüyor. */}
        {SURELER.map((s) => (
          <button
            key={s}
            type="button"
            disabled={mesgul}
            onClick={() => setSure(s)}
            style={sureDugmesi(s === sure)}
            title={`kayıt süresi ${s} saniye`}
          >
            {s}sn
          </button>
        ))}
      </span>

      <button
        type="button"
        style={dugme}
        disabled={!engine || mesgul}
        onClick={plyIndir}
        title="sahneyi 3D Gaussian Splat (.ply) olarak indir — SuperSplat vb. açar"
      >
        PLY
      </button>

      <label style={{ display: 'flex', gap: 4, alignItems: 'center', color: '#889', cursor: 'pointer' }} title="çıktının köşesine küçük proje imzası ekle">
        <input type="checkbox" checked={imza} disabled={mesgul} onChange={(e) => setImza(e.target.checked)} />
        imza
      </label>

      <span style={durumStyle(durum)}>{durumMetni(durum)}</span>
    </div>
  );
}

function durumMetni(d: Durum): string {
  if (d.tip === 'calisiyor') return d.kalanSn !== undefined ? `● ${d.etiket} · ${d.kalanSn} sn` : `● ${d.etiket}…`;
  if (d.tip === 'bitti') return `✓ ${d.mesaj}`;
  if (d.tip === 'hata') return `✕ ${d.mesaj}`;
  return '';
}

/** Motorun karesini 2D kopyaya alır ve imzayı çizer. */
function imzaliKopya(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const kopya = document.createElement('canvas');
  kopya.width = canvas.width;
  kopya.height = canvas.height;
  const ctx = kopya.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  imzaCiz(ctx, kopya.width, kopya.height);
  return kopya;
}

const seritStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
  maxWidth: 640,
  fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
  fontSize: 12,
};

const dugme: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 12,
  padding: '4px 10px',
  background: '#1a1a22',
  color: '#c8c8d4',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#26262e',
  borderRadius: 3,
  cursor: 'pointer',
};

const grupStyle: CSSProperties = {
  display: 'flex',
  gap: 2,
  alignItems: 'center',
  padding: 2,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#26262e',
  borderRadius: 3,
};

function sureDugmesi(secili: boolean): CSSProperties {
  return {
    fontFamily: 'inherit',
    fontSize: 11,
    padding: '2px 6px',
    background: secili ? '#8ab' : 'transparent',
    color: secili ? '#101014' : '#667',
    borderWidth: 0,
    borderRadius: 2,
    cursor: secili ? 'default' : 'pointer',
  };
}

function durumStyle(d: Durum): CSSProperties {
  const renk = d.tip === 'hata' ? '#c66' : d.tip === 'calisiyor' ? '#f0b429' : '#6a6';
  return { color: renk, fontSize: 12, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' };
}
