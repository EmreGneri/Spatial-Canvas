// GEZİNME ÖLÇÜMÜ RAPORU — saf biçimlendiriciler (DOM yok, dosya yok).
// `scripts/olc-gezinme.mjs` bunlarla `ozet.md`, `karsilastirma.md` ve
// `karsilastirma.html` yazar; `scripts/verify-olcum-rapor.mjs` test eder.
// Rapor şeması: docs/plans/2026-09-27-gezinme-1-olcum.md, Görev 5.

const BOLGELER = ['bas', 'orta', 'son'];
const YONLER = ['sag', 'sol', 'ileri', 'yukari'];
const BOS = '—';

// ── number formatting ────────────────────────────────────────────────────

const sayiMi = (v) => typeof v === 'number' && Number.isFinite(v);
/** Fixed decimals, blank for missing; Infinity (identical images) spelled out. */
function bicim(v, basamak) {
  if (v === Infinity) return '∞';
  return sayiMi(v) ? v.toFixed(basamak) : BOS;
}
/** Signed delta B − A with fixed decimals; blank when either side is missing. */
function fark(a, b, basamak) {
  if (!sayiMi(a) || !sayiMi(b)) return BOS;
  const d = Number((b - a).toFixed(basamak));
  return `${d < 0 ? '-' : '+'}${Math.abs(d).toFixed(basamak)}`;
}
const sn = (ms) => (sayiMi(ms) ? ms / 1000 : undefined);
const ortalama = (xs) => {
  const v = xs.filter(sayiMi);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
};
const tabloSatiri = (hucreler) => `| ${hucreler.join(' | ')} |`;
function tablo(baslik, satirlar) {
  return [tabloSatiri(baslik), tabloSatiri(baslik.map(() => '---')), ...satirlar.map(tabloSatiri)].join('\n');
}

// ── report accessors ─────────────────────────────────────────────────────

const merkezId = (bolge) => `${bolge}_merkez_0.00`;
const sondaId = (bolge, yon, d) => (d === 0 ? merkezId(bolge) : `${bolge}_${yon}_${d.toFixed(2)}`);
const sondaHaritasi = (r) => new Map((r.sondalar ?? []).map((s) => [s.id, s]));
const hucre = (tbl, bolge, yon) => tbl?.[bolge]?.[yon];
const ayrilanOrtalama = (r) => ({
  psnr: ortalama((r.ayrilan ?? []).map((a) => a.psnr)),
  ssim: ortalama((r.ayrilan ?? []).map((a) => a.ssim)),
});
/** Stage keys of both reports, in order of first appearance (A first). */
function asamaAnahtarlari(...raporlar) {
  const anahtarlar = [];
  for (const r of raporlar) for (const k of Object.keys(r.sureler ?? {})) if (!anahtarlar.includes(k)) anahtarlar.push(k);
  return anahtarlar;
}
function ayarMetni(r) {
  const a = r.ayar ?? {};
  return [
    a.tier && `katman ${a.tier}`,
    a.maxFrames != null && `kare ${a.maxFrames}`,
    a.maxIters != null && `iter ${a.maxIters}`,
    a.ayrilan != null && `ayrılan ${a.ayrilan}`,
    a.genislik != null && `genişlik ${a.genislik}`,
  ].filter(Boolean).join(', ');
}

// ── ozetMd ───────────────────────────────────────────────────────────────

/** One run's summary: header, region x direction table (today's bound,
 *  usable distance, the 0.10 probe), centre probes, held-out frames with
 *  their mean, stage durations. */
export function ozetMd(r) {
  if (r.yalnizSfm) {
    return [
      `# Kamera çözümü — ${r.etiket} / ${r.klip}`, '',
      `- GPU: ${r.gpu ?? BOS}`,
      `- ayar: ${ayarMetni(r) || BOS}`,
      `- mod: ${JSON.stringify(r.mod ?? {})}`,
      `- kayıt: ${r.sfm?.kayitli ?? BOS}/${r.sfm?.toplamKare ?? BOS}`,
      `- çift: ${r.sfm?.ciftSayisi ?? BOS}`,
      `- medyan yeniden izdüşüm: ${bicim(r.sfm?.medErr, 3)} px`,
      `- BA RMS: ${bicim(r.sfm?.rmsBA, 3)} px`,
      ...(r.hizalama ? [`- GT konum RMS/yol: ${bicim(r.hizalama.rmsOrani, 4)}`] : []),
      '', '## Aşama süreleri', '',
      tablo(['aşama', 'süre (sn)'], Object.entries(r.sureler ?? {}).map(([k, v]) => [k, bicim(sn(v), 1)])),
      '',
    ].join('\n');
  }
  const s = sondaHaritasi(r);
  const out = [];
  out.push(`# Gezinme ölçümü — ${r.etiket} / ${r.klip}`, '');
  out.push(`- tarayıcı: ${r.tarayici ?? BOS}`);
  out.push(`- GPU: ${r.gpu ?? BOS}`);
  out.push(`- ayar: ${ayarMetni(r) || BOS}`);
  if (r.mod) out.push(`- mod: ${JSON.stringify(r.mod)}`);
  out.push(`- çekim türü: ${r.tur}, ölçüm birimi: ${bicim(r.birim, 4)}`);
  out.push(`- SfM: ${r.sfm?.kayitli ?? BOS}/${r.sfm?.toplamKare ?? BOS} kare kayıtlı` +
    `${sayiMi(r.sfm?.medErr) ? `, medErr ${bicim(r.sfm.medErr, 3)}` : ''}` +
    `${sayiMi(r.sfm?.rmsBA) ? `, rmsBA ${bicim(r.sfm.rmsBA, 3)}` : ''}`);
  out.push(`- Gaussian: ${r.gauss ?? BOS}`);
  if (r.hizalama) {
    out.push(`- hizalama rms: ${bicim(r.hizalama.rms, 4)} (GT dünyası), rms/yol = ${bicim(r.hizalama.rmsOrani, 4)}`);
  }
  if (r.esikler) {
    const e = r.esikler;
    out.push(`- "iyi" ölçütü: ${e.olcut === 'gt'
      ? `ssim ≥ ssim₀ − ${e.ssimDusus} ve psnr ≥ psnr₀ − ${e.psnrDusus} (GT'ye karşı)`
      : `keskinlik/keskinlik₀ ≥ ${e.keskinlikOrani} ve kaplama ≥ ${e.kaplamaMin}`} (₀ = bölgenin merkez sondası)`);
  }
  out.push('');

  out.push('## Bölge × yön', '', 'Mesafeler ölçüm biriminin kesri. "@0.10" = o yönde 0.10 birim kaydırılmış sonda.', '');
  const satirlar = [];
  for (const bolge of BOLGELER) {
    for (const yon of YONLER) {
      const p = s.get(sondaId(bolge, yon, 0.1));
      satirlar.push([
        bolge, yon, bicim(hucre(r.bugunku, bolge, yon), 2), bicim(hucre(r.kullanilabilir, bolge, yon), 2),
        bicim(p?.psnr, 2), bicim(p?.ssim, 3), bicim(p?.kaplama, 3), bicim(p?.keskinlik, 1),
      ]);
    }
  }
  out.push(tablo(['bölge', 'yön', 'bugünkü sınır', 'kullanılabilir', 'psnr @0.10', 'ssim @0.10', 'kaplama @0.10', 'keskinlik @0.10'], satirlar), '');
  if (r.bosAlan) {
    out.push('## Derinlikle doğrulanmış boş alan', '');
    out.push(`- hizalı kare: ${r.bosAlan.hizaliKare}, voksel: ${bicim(r.bosAlan.voksel, 4)}, ızgara: ${r.bosAlan.boyut.join('×')}`, '');
    if (r.bosAlan.gtBosOrnek != null) out.push(`- GT engel ihlali (ham boş): ${r.bosAlan.gtEngelIhlali}/${r.bosAlan.gtBosOrnek} örnek`,
      `- GT engel ihlali (kameranın erişebildiği boşluk): ${r.bosAlan.gtErisilirIhlal}/${r.bosAlan.gtErisilirOrnek} örnek`, '');
    out.push(tablo(['bölge', 'yön', 'bugünkü sınır', 'boş alan sınırı'], BOLGELER.flatMap((bolge) =>
      YONLER.map((yon) => [bolge, yon, bicim(hucre(r.bugunku, bolge, yon), 2), bicim(hucre(r.bosAlan.kullanilabilir, bolge, yon), 2)]))), '');
  }

  out.push('## Merkez sondaları', '');
  out.push(tablo(['bölge', 'psnr', 'ssim', 'kaplama', 'keskinlik'], BOLGELER.map((bolge) => {
    const p = s.get(merkezId(bolge));
    return [bolge, bicim(p?.psnr, 2), bicim(p?.ssim, 3), bicim(p?.kaplama, 3), bicim(p?.keskinlik, 1)];
  })), '');

  out.push('## Ayrılan kareler', '');
  const ort = ayrilanOrtalama(r);
  out.push(tablo(['kare', 'psnr (dB)', 'ssim'], [
    ...(r.ayrilan ?? []).map((a) => [a.ad, bicim(a.psnr, 2), bicim(a.ssim, 3)]),
    ['**ortalama**', bicim(ort.psnr, 2), bicim(ort.ssim, 3)],
  ]), '');

  out.push('## Aşama süreleri', '');
  const anahtarlar = asamaAnahtarlari(r);
  const toplam = anahtarlar.reduce((t, k) => t + (sayiMi(r.sureler[k]) ? r.sureler[k] : 0), 0);
  out.push(tablo(['aşama', 'süre (sn)'], [
    ...anahtarlar.map((k) => [k, bicim(sn(r.sureler[k]), 1)]),
    ['**toplam**', bicim(sn(toplam), 1)],
  ]), '');
  return out.join('\n');
}

// ── karsilastirmaMd ──────────────────────────────────────────────────────

/** Side-by-side comparison of two reports, B − A delta columns. Probes are
 *  matched by id; a probe present on one side only is marked `yok`. */
export function karsilastirmaMd(a, b) {
  if (a.yalnizSfm || b.yalnizSfm) {
    if (!a.yalnizSfm || !b.yalnizSfm) throw new Error('Camera-only and full training reports cannot be compared');
    return [
      `# Kamera çözümü karşılaştırması — A: ${a.etiket}, B: ${b.etiket}`, '',
      `- klip: A ${a.klip}, B ${b.klip}`,
      `- GPU: A ${a.gpu}, B ${b.gpu}`, '',
      tablo(['ölçü', 'A', 'B', 'Δ'], [
        ['kayıtlı', bicim(a.sfm?.kayitli, 0), bicim(b.sfm?.kayitli, 0), fark(a.sfm?.kayitli, b.sfm?.kayitli, 0)],
        ['çift', bicim(a.sfm?.ciftSayisi, 0), bicim(b.sfm?.ciftSayisi, 0), fark(a.sfm?.ciftSayisi, b.sfm?.ciftSayisi, 0)],
        ['medErr px', bicim(a.sfm?.medErr, 3), bicim(b.sfm?.medErr, 3), fark(a.sfm?.medErr, b.sfm?.medErr, 3)],
        ['GT RMS/yol', bicim(a.hizalama?.rmsOrani, 4), bicim(b.hizalama?.rmsOrani, 4), fark(a.hizalama?.rmsOrani, b.hizalama?.rmsOrani, 4)],
      ]), '',
      '## Aşama süreleri (sn)', '',
      tablo(['aşama', 'A', 'B', 'Δ'], asamaAnahtarlari(a, b).map((k) => {
        const x = sn(a.sureler?.[k]), y = sn(b.sureler?.[k]);
        return [k, bicim(x, 1), bicim(y, 1), fark(x, y, 1)];
      })), '',
    ].join('\n');
  }
  const sa = sondaHaritasi(a), sb = sondaHaritasi(b);
  const out = [];
  out.push(`# Gezinme ölçümü karşılaştırması — A: ${a.etiket}, B: ${b.etiket}`, '');
  out.push(`- klip: A ${a.klip}, B ${b.klip}${a.klip !== b.klip ? ' (**farklı klip!**)' : ''}`);
  out.push(`- ayar: A ${ayarMetni(a) || BOS}; B ${ayarMetni(b) || BOS}`);
  out.push(`- GPU: A ${a.gpu ?? BOS}; B ${b.gpu ?? BOS}`);
  out.push('- Δ = B − A', '');

  out.push('## Genel', '');
  out.push(tablo(['ölçü', 'A', 'B', 'Δ'], [
    ['çekim türü', a.tur ?? BOS, b.tur ?? BOS, a.tur === b.tur ? '=' : '≠'],
    ['ölçüm birimi', bicim(a.birim, 4), bicim(b.birim, 4), fark(a.birim, b.birim, 4)],
    ['SfM kayıtlı', bicim(a.sfm?.kayitli, 0), bicim(b.sfm?.kayitli, 0), fark(a.sfm?.kayitli, b.sfm?.kayitli, 0)],
    ['Gaussian', bicim(a.gauss, 0), bicim(b.gauss, 0), fark(a.gauss, b.gauss, 0)],
    ['hizalama rms/yol', bicim(a.hizalama?.rmsOrani, 4), bicim(b.hizalama?.rmsOrani, 4), fark(a.hizalama?.rmsOrani, b.hizalama?.rmsOrani, 4)],
  ]), '');

  out.push('## Bölge × yön', '');
  const satirlar = [];
  for (const bolge of BOLGELER) {
    for (const yon of YONLER) {
      const bgA = hucre(a.bugunku, bolge, yon), bgB = hucre(b.bugunku, bolge, yon);
      const kuA = hucre(a.kullanilabilir, bolge, yon), kuB = hucre(b.kullanilabilir, bolge, yon);
      satirlar.push([bolge, yon, bicim(bgA, 2), bicim(bgB, 2), fark(bgA, bgB, 2), bicim(kuA, 2), bicim(kuB, 2), fark(kuA, kuB, 2)]);
    }
  }
  out.push(tablo(['bölge', 'yön', 'bugünkü A', 'bugünkü B', 'Δ', 'kullanılabilir A', 'kullanılabilir B', 'Δ'], satirlar), '');

  out.push('## Ayrılan kareler (ortalama)', '');
  const oa = ayrilanOrtalama(a), ob = ayrilanOrtalama(b);
  out.push(tablo(['metrik', 'A', 'B', 'Δ'], [
    ['psnr', bicim(oa.psnr, 2), bicim(ob.psnr, 2), fark(oa.psnr, ob.psnr, 2)],
    ['ssim', bicim(oa.ssim, 3), bicim(ob.ssim, 3), fark(oa.ssim, ob.ssim, 3)],
  ]), '');

  out.push('## Aşama süreleri (sn)', '');
  out.push(tablo(['aşama', 'A', 'B', 'Δ'], asamaAnahtarlari(a, b).map((k) => {
    const x = sn(a.sureler?.[k]), y = sn(b.sureler?.[k]);
    return [k, bicim(x, 1), bicim(y, 1), fark(x, y, 1)];
  })), '');

  out.push('## Sondalar', '');
  const idler = [...sa.keys(), ...[...sb.keys()].filter((id) => !sa.has(id))];
  const iyiMetni = (p, taraf) => (p ? (p.iyi ? 'iyi' : 'kötü') : `yok (${taraf})`);
  out.push(tablo(
    ['sonda', 'psnr A', 'psnr B', 'Δ', 'ssim A', 'ssim B', 'Δ', 'kaplama A', 'kaplama B', 'Δ', 'keskinlik A', 'keskinlik B', 'Δ', 'A', 'B'],
    idler.map((id) => {
      const p = sa.get(id), q = sb.get(id);
      return [
        id,
        bicim(p?.psnr, 2), bicim(q?.psnr, 2), fark(p?.psnr, q?.psnr, 2),
        bicim(p?.ssim, 3), bicim(q?.ssim, 3), fark(p?.ssim, q?.ssim, 3),
        bicim(p?.kaplama, 3), bicim(q?.kaplama, 3), fark(p?.kaplama, q?.kaplama, 3),
        bicim(p?.keskinlik, 1), bicim(q?.keskinlik, 1), fark(p?.keskinlik, q?.keskinlik, 1),
        iyiMetni(p, 'A'), iyiMetni(q, 'B'),
      ];
    }),
  ), '');
  return out.join('\n');
}

// ── karsilastirmaHtml ────────────────────────────────────────────────────

const kacis = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function sondaMetni(p) {
  return [
    sayiMi(p.psnr) && `psnr ${p.psnr.toFixed(2)}`,
    sayiMi(p.ssim) && `ssim ${p.ssim.toFixed(3)}`,
    sayiMi(p.kaplama) && `kaplama ${p.kaplama.toFixed(3)}`,
    sayiMi(p.keskinlik) && `keskinlik ${p.keskinlik.toFixed(1)}`,
    p.iyi ? 'iyi' : 'kötü',
  ].filter(Boolean).join(' · ');
}

/** Probe PNGs side by side (A, B and the GT render when a report has one),
 *  one row per probe id; `pngA` / `pngB` are directory paths relative to the
 *  HTML file. A probe missing on one side gets an `eksik` cell. */
export function karsilastirmaHtml(a, b, { pngA, pngB }) {
  if (a.yalnizSfm || b.yalnizSfm) {
    return `<!doctype html><html lang="tr"><meta charset="utf-8"><title>Kamera çözümü karşılaştırması</title><pre>${kacis(karsilastirmaMd(a, b))}</pre></html>`;
  }
  const sa = sondaHaritasi(a), sb = sondaHaritasi(b);
  const idler = [...sa.keys(), ...[...sb.keys()].filter((id) => !sa.has(id))];
  const gtVar = Boolean(a.hizalama || b.hizalama);
  const img = (dizin, dosya) => `<img src="${kacis(`${dizin}/${dosya}`)}" alt="${kacis(dosya)}" loading="lazy">`;
  const goruntu = (p, dizin, taraf) => (p
    ? `<td>${img(dizin, `${p.id}.png`)}<div class="m">${kacis(sondaMetni(p))}</div></td>`
    : `<td class="eksik">${taraf}'da yok</td>`);
  const satirlar = idler.map((id) => {
    const p = sa.get(id), q = sb.get(id);
    let gt = '';
    if (gtVar) {
      const kaynak = p && a.hizalama ? pngA : q && b.hizalama ? pngB : null;
      gt = kaynak ? `<td>${img(kaynak, `${id}_gt.png`)}</td>` : '<td class="eksik">GT yok</td>';
    }
    return `<tr><th class="id">${kacis(id)}</th>${goruntu(p, pngA, 'A')}${goruntu(q, pngB, 'B')}${gt}</tr>`;
  });
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gezinme karşılaştırması</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #1a1a1a; --muted: #666; --line: #ddd; --warn: #b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg: #151515; --fg: #eee; --muted: #aaa; --line: #333; --warn: #f2b8b5; } }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid var(--line); padding: 6px; vertical-align: top; text-align: left; }
  td img { display: block; width: 100%; max-width: 480px; height: auto; }
  .m { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .eksik { color: var(--warn); font-weight: 600; }
  .id { white-space: nowrap; font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<h1>Gezinme karşılaştırması</h1>
<p>A: ${kacis(a.etiket)} (${kacis(a.klip)}) · B: ${kacis(b.etiket)} (${kacis(b.klip)})</p>
<table>
<thead><tr><th>sonda</th><th>A · ${kacis(a.etiket)}</th><th>B · ${kacis(b.etiket)}</th>${gtVar ? '<th>GT</th>' : ''}</tr></thead>
<tbody>
${satirlar.join('\n')}
</tbody>
</table>
</body>
</html>
`;
}
