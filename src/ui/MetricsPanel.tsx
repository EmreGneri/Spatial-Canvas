import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { EvalReport, MetricColumn } from '../engine/vision/types';
import { parseEvalReport } from './metricsReport';

/**
 * METRİK PANELİ (render/UI katmanı — Zeynep, Gün 7).
 *
 * `eval-out/report.json`'ı (D.5 şeması) okur ve ekranda gösterir. Amaç,
 * ARCHITECTURE.md D.5'teki "UI okuyup gösterebilir" maddesini kapatmak:
 * demoyu izleyen biri sayıları koda bakmadan görebilsin.
 *
 * ── KAYNAK ─────────────────────────────────────────────────────────────────
 * `eval-out/` GITIGNORE'DADIR ve `public/` altında değildir — yani üretim
 * derlemesinde SERVİS EDİLMEZ. Bu yüzden panel iki yolu birden sunar:
 *   1. dev sunucusunda `/eval-out/report.json` denenir (Vite kök dizinden
 *      servis eder; `npm run eval` çalıştırıldıysa gelir),
 *   2. gelmezse kullanıcı dosyayı elle yükler.
 * Sessizce boş kalmaz: hangi yolun neden başarısız olduğunu yazar.
 *
 * ── DÜRÜSTLÜK ──────────────────────────────────────────────────────────────
 * Panel raporu YORUMLAMAZ ve "iyi/kötü" demez — D.5'in ablasyon kuralı gereği
 * uygulanmamış kollar `null` gelir ve `uygulanmadı` olarak gösterilir; sayı
 * uydurulmaz. Şema dışı bir dosya verilirse hata gösterilir, kısmi veri
 * gerçekmiş gibi çizilmez.
 */

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 8,
  border: '1px solid #26262e',
  borderRadius: 4,
  background: '#101014',
  fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
  fontSize: 12,
  color: '#c8c8d4',
};

const buttonStyle: CSSProperties = {
  font: 'inherit',
  padding: '4px 8px',
  background: '#1a1a22',
  color: '#c8c8d4',
  border: '1px solid #26262e',
  borderRadius: 3,
  cursor: 'pointer',
};

const headingStyle: CSSProperties = { color: '#8ab', fontSize: 12, letterSpacing: 0.4 };

const COLUMN_ORDER: MetricColumn[] = ['depth', 'seg', 'pose', 'timing'];

export function MetricsPanel() {
  const [report, setReport] = useState<EvalReport | null>(null);
  const [note, setNote] = useState<string>('yükleniyor…');
  const [source, setSource] = useState('');

  const load = useCallback(async () => {
    setNote('yükleniyor…');
    try {
      const res = await fetch('/eval-out/report.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReport(parseEvalReport(await res.json()));
      setSource('yerel eval-out/report.json');
      setNote('');
    } catch (e) {
      setReport(null);
      setSource('');
      setNote(
        `yerel rapor okunamadı (${e instanceof Error ? e.message : String(e)}). Geliştirme ortamında "npm run eval" çalıştırın ya da report.json yükleyin`,
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = new Map<MetricColumn, EvalReport['results']>();
  if (report) {
    for (const row of report.results) {
      const list = grouped.get(row.column) ?? [];
      list.push(row);
      grouped.set(row.column, list);
    }
  }

  return (
    <div style={panelStyle}>
      <strong style={headingStyle}>çevrimdışı değerlendirme · rapor</strong>
      <div style={{ color: '#889', lineHeight: 1.4 }}>
        Bu sayılar seçtiğiniz videonun canlı derinlik kalitesini ölçmez; rapordaki veri kümesine aittir.
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button type="button" style={buttonStyle} onClick={() => void load()}>
          yerel raporu yenile
        </button>
        <label style={{ ...buttonStyle, display: 'inline-block' }}>
          dosya yükle
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                setReport(parseEvalReport(JSON.parse(await f.text())));
                setSource(`yüklenen dosya: ${f.name}`);
                setNote('');
              } catch (err) {
                setReport(null);
                setSource('');
                setNote(`geçersiz rapor: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
          />
        </label>
      </div>

      {note && <div style={{ color: '#dc6', lineHeight: 1.4 }}>{note}</div>}

      {report && (
        <>
          <div style={{ color: '#667' }}>
            {source} · {report.run} · {report.commit} · {report.date.slice(0, 19).replace('T', ' ')}
          </div>

          {COLUMN_ORDER.filter((c) => grouped.has(c)).map((col) => (
            <div key={col}>
              <div style={{ color: '#8ab', marginBottom: 4 }}>{col}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 8px' }}>
                {grouped.get(col)!.map((row, i) => (
                  <ReportRow key={`${row.metric}-${i}`} metric={`${row.metric} (${row.dataset}/${row.split})`} value={row.value} />
                ))}
              </div>
            </div>
          ))}

          <div>
            <div style={{ color: '#8ab', marginBottom: 4 }}>ablasyon kolları (D.5 — sabit 7)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 8px' }}>
              {Object.entries(report.params).map(([k, v]) => (
                <ReportRow key={k} metric={k} value={v as number | null} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ReportRow({ metric, value }: { metric: string; value: number | null }) {
  return (
    <>
      <span style={{ color: '#889' }}>{metric}</span>
      <span
        style={{
          color: value === null ? '#667' : '#c8c8d4',
          fontVariantNumeric: 'tabular-nums',
          fontStyle: value === null ? 'italic' : 'normal',
        }}
      >
        {/* D.5: null = kol UYGULANMADI. "0" yazmak asılsız sayı üretmek olurdu. */}
        {value === null ? 'uygulanmadı' : Number.isInteger(value) ? value : value.toFixed(4)}
      </span>
    </>
  );
}
