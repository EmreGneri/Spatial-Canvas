import type { CSSProperties } from 'react';
import { egim, grafikDuzeni, type GrafikNoktasi } from './egitimIlerleme';
import { bosluk, MONO, renk, SANS, yaricap, yazi, yuzey } from './tema';

const EN = 260;
const BOY = 44;

/**
 * 3D EĞİTİM İLERLEME GRAFİĞİ — transport şeridinin ALTINDA.
 *
 * Eğitim görünümü sahnenin üstünü kaplıyor; grafik oraya konsaydı ya
 * görüntünün üstüne binerdi ya da eğitim tuvalini küçültürdü. Şeridin altı
 * eğitim boyunca boş duruyordu — kumandaların yanında, sahnenin dışında.
 *
 * Kütüphane yok: SVG `polyline`. Bu ölçekte (≤240 nokta) bir grafik kütüphanesi
 * 40+ KB getirip aynı çizgiyi çiziyor.
 */
export function EgitimGrafik({
  seri,
  hedefIter,
  bitti,
}: {
  seri: readonly GrafikNoktasi[];
  /** Bütçe — X ekseninin sonu. */
  hedefIter: number;
  bitti: boolean;
}) {
  const d = grafikDuzeni(seri, EN, BOY, hedefIter);
  const e = egim(seri);

  return (
    <div style={kutu}>
      <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: yazi.kucuk, color: renk.metinSolgun, fontWeight: 600 }}>
          {bitti ? '3D eğitim · bitti' : '3D eğitim · kalite'}
        </span>
        <span style={{ ...olcu, color: renk.metin, fontSize: yazi.orta }}>
          {d.son ? `${d.son.psnr.toFixed(1)} dB` : '—'}
        </span>
      </div>

      <svg
        width={EN}
        height={BOY}
        viewBox={`0 0 ${EN} ${BOY}`}
        role="img"
        aria-label={d.son
          ? `eğitim PSNR ${d.son.psnr.toFixed(1)} dB, ${d.son.iter} / ${hedefIter} iterasyon`
          : 'eğitim ölçümü henüz yok'}
        style={{ flex: '0 0 auto', display: 'block', borderRadius: yaricap.kontrol, background: renk.yuzey2 }}
      >
        {/* Bütçenin nerede olduğu görünür: ilerleme çubuğu grafiğin ZEMİNİ. */}
        <rect x={0} y={0} width={EN * d.ilerleme} height={BOY} fill={renk.vurguSakin} />
        {d.yol
          ? <polyline points={d.yol} fill="none" stroke={renk.vurgu} strokeWidth={1.5} strokeLinejoin="round" />
          : (
            <text x={EN / 2} y={BOY / 2 + 4} textAnchor="middle" fill={renk.metinSilik} fontSize={10} fontFamily={SANS}>
              ilk ölçüm bekleniyor
            </text>
          )}
      </svg>

      <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
        {/* Y aralığı yazılı: eksen etiketi olmadan "1 dB" ile "10 dB"lik bir
            tırmanış aynı görünür. */}
        <span style={olcu}>{d.yol ? `${d.yMin.toFixed(1)} – ${d.yMax.toFixed(1)} dB` : 'PSNR'}</span>
        <span style={olcu}>
          {d.son ? `${d.son.splats.toLocaleString('tr-TR')} Gaussian` : '— Gaussian'}
        </span>
      </div>

      {/* Doymuş mu, hâlâ tırmanıyor mu: "sürdür +4.000" kararı buna bakar. */}
      {e !== null && !bitti && (
        <span style={{ ...olcu, color: e >= 0.2 ? renk.iyi : renk.metinSilik }}>
          {e >= 0 ? '+' : ''}{e.toFixed(2)} dB / 1k iter
        </span>
      )}
      {e !== null && bitti && (
        <span style={{ ...olcu, color: e >= 0.2 ? renk.iyi : renk.metinSilik }}>
          {e >= 0.2 ? 'hâlâ tırmanıyordu; sürdürmek işe yarayabilir' : 'eğri düzleşmişti'}
        </span>
      )}
    </div>
  );
}

const kutu: CSSProperties = {
  ...yuzey(1, yaricap.kart),
  display: 'flex',
  alignItems: 'center',
  gap: bosluk.m,
  flexWrap: 'wrap',
  padding: bosluk.s,
  fontFamily: SANS,
};

const olcu: CSSProperties = {
  fontFamily: MONO,
  fontVariantNumeric: 'tabular-nums',
  fontSize: yazi.kucuk,
  color: renk.metinSolgun,
};
