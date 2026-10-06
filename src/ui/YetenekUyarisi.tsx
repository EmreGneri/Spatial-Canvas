import { useEffect, useState, type CSSProperties } from 'react';
import { yetenekRaporu, type YetenekRaporu } from '../engine/vision/yetenek';
import { yetenekGorunumu } from './yetenekGorunum';
import { kenarDurum } from './tema';

/**
 * YETENEK UYARISI — Z2 (render katmanı, Zeynep). Emre'nin `yetenekRaporu()`
 * sözleşmesinin (E2) arayüz karşılığı.
 *
 * NEDEN VAR: WebGPU yoksa canlı derinlik sessizce parlaklık vekiline düşüyor
 * (parlak = yakın). Kullanıcı ekranda bozuk bir görüntü görüyor ama sebebini
 * bilmiyordu — projenin dürüstlük kuralına aykırı "sessiz bozulma".
 *
 * GÜRÜLTÜ YAPMAZ: `sebep === null` (her şey çalışıyor) durumunda HİÇBİR ŞEY
 * çizilmez — çalışan bir kurulumda "her şey yolunda" rozeti göstermek, sonraki
 * gerçek uyarının okunmamasına yol açar. Kullanıcı kapatabilir; karar oturum
 * boyunca saklanır (kalıcı değil: yeni oturumda tarayıcı gerçekten değişmiş
 * olabilir).
 *
 * Rapor oturumda bir kez ölçülür (yetenek.ts memoize eder), bu bileşen yalnız
 * okur — ölçümü kendi yapmaz, sonucu yorumlamaz.
 */
export function YetenekUyarisi({ say }: { say?: (mesaj: string) => void }) {
  const [rapor, setRapor] = useState<YetenekRaporu | null>(null);
  const [kapatildi, setKapatildi] = useState(false);

  useEffect(() => {
    let iptal = false;
    yetenekRaporu()
      .then((r) => {
        if (iptal) return;
        setRapor(r);
        // Log şeridine de düşsün: uyarıyı kapatan kullanıcı sebebi sonradan
        // arayabilsin.
        if (r.sebep) say?.(`yetenek: ${r.sebep}`);
      })
      .catch((e) => {
        // Raporun kendisi patlarsa sessiz kalmak bu bileşenin varlık sebebine
        // aykırı olurdu.
        if (!iptal) say?.(`yetenek raporu okunamadı: ${e instanceof Error ? e.message : String(e)}`);
      });
    return () => {
      iptal = true;
    };
    // `say` her render'da yeni fonksiyon olabilir; rapor oturumda bir kez
    // okunur, bağımlılık listesi bilerek boş.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gorunum = yetenekGorunumu(rapor, kapatildi);
  if (!gorunum.goster) return null;

  return (
    <div style={seritStyle} role="status">
      <span style={{ color: '#f0b429' }}>▲</span>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {gorunum.rozetler.map((r) => (
            <Rozet key={r.ad} ad={r.ad} acik={r.acik} />
          ))}
        </div>
        <span style={{ color: '#c8c8d4' }}>{gorunum.sebep}</span>
      </div>
      <button
        type="button"
        onClick={() => setKapatildi(true)}
        title="uyarıyı gizle (sebep log şeridinde kalır)"
        style={kapatStyle}
      >
        ×
      </button>
    </div>
  );
}

/** Tek yeteneğin durumu. Kapalı olan vurgulanır; açık olan geri çekilir. */
function Rozet({ ad, acik }: { ad: string; acik: boolean }) {
  return (
    <span
      style={{
        fontSize: 11,
        padding: '4px 8px',
        borderRadius: 2,
        border: `1px solid ${acik ? '#2a3a2a' : '#6b4a12'}`,
        background: acik ? 'transparent' : '#2a1f08',
        color: acik ? '#5a6b5a' : '#f0b429',
      }}
    >
      {ad}: {acik ? 'açık' : 'kapalı'}
    </span>
  );
}

const seritStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  maxWidth: 'min(960px, 100%)',
  boxSizing: 'border-box',
  padding: '8px 8px',
  background: '#17130a',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: kenarDurum.uyari,
  borderRadius: 3,
  fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
  fontSize: 12,
  color: '#c8c8d4',
};

const kapatStyle: CSSProperties = {
  marginLeft: 'auto',
  fontFamily: 'inherit',
  fontSize: 14,
  lineHeight: 1,
  padding: '0 4px',
  background: 'none',
  color: '#8a7a5a',
  borderWidth: 0,
  cursor: 'pointer',
};
