// Derinlik denetimi doğrulaması (Gezinme Parça 4, Görev 1) — vendor eğiticinin
// derinlik kaybı (`depthWeight`, `frame.depth`), GPU'suz ortamda SwiftShader
// WebGPU ile:
//   1. WGSL özdeşliği (node): derinlik kapalıyken üretilen render ve zincir
//      çekirdekleri derinlik öncesi sürümle (git referansı) bayt bayt aynı.
//   2. Sayısal türev denetimi (tarayıcı): `gradCheckSmall` derinliksiz (taban),
//      `{ depth: true }` (renk + derinlik), `{ depth: 'only' }` (renk hedefi
//      geçersiz: yalnız derinlik), gölgelendirici varyantları ve poz türevi.
//   3. Determinizm: sentetik veri kümesi, ilk 50 adımın kayıp dizisi ve son
//      parametreler eski kodla birebir (depthWeight 0; ayrıca derinlik
//      karesi olmadan depthWeight > 0).
//   4. Kısa derinlikli eğitim: hedef = sentetik sahnenin analitik (ışın
//      izlenmiş) GT derinliği; 100 adımda tüm kameralar üzerinden depthLoss.
//
// Kullanım: node scripts/gradcheck-derinlik.mjs [--ref <git-ref>] [--chrome]
//   --ref: karşılaştırılacak eski kod (varsayılan: gs/shaders.js'te derinlik
//   desteği olmayan en yeni sürüm — HEAD ya da derinliği getiren commit'in ebeveyni).
// Çıkış kodu: herhangi bir denetim başarısızsa 1.
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tarayiciOturumu } from './tarayici-oturumu.mjs';

const REPO_KOKU = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GECICI = resolve(REPO_KOKU, '.bench-tmp/derinlik');
const SHADERS = 'src/vendor/splat.js/gs/shaders.js';
const argv = process.argv.slice(2);
const argDeger = (ad) => { const i = argv.indexOf(ad); return i >= 0 ? argv[i + 1] : undefined; };

const hatalar = [];
const denetle = (kosul, mesaj) => { if (!kosul) { hatalar.push(mesaj); console.log(`  BAŞARISIZ: ${mesaj}`); } };
const git = (...a) => execFileSync('git', a, { cwd: REPO_KOKU, maxBuffer: 64 << 20 }).toString();

/** Derinlik desteği olmayan en yeni shaders.js sürümü. */
function referansBul() {
  const verilen = argDeger('--ref');
  if (verilen) return verilen;
  const adaylar = ['HEAD', ...git('rev-list', 'HEAD', '--', SHADERS).trim().split('\n').filter(Boolean).map((r) => `${r}^`)];
  for (const a of adaylar) {
    if (!git('show', `${a}:${SHADERS}`).includes('feat.depth')) return a;
  }
  throw new Error('derinlik öncesi shaders.js bulunamadı (--ref verin)');
}

// ---- 1. WGSL özdeşliği ----
async function wgslOzdes(refDizin) {
  const yeni = await import(pathToFileURL(resolve(REPO_KOKU, SHADERS)).href);
  const eski = await import(pathToFileURL(resolve(refDizin, SHADERS)).href);
  let n = 0, fark = 0;
  for (const tileGrad of [false, true]) for (const sub of [false, true]) for (const mode of [0, 1, 2, 3])
    for (const batch of [1, 16]) for (const spread of [1, 2]) for (const zskip of [false, true]) for (const pvec of [false, true])
      for (const stats of [false, true]) for (const covW of [0, 1]) for (const randBg of [false, true]) for (const robust of [false, true]) {
        if (sub && !tileGrad) continue;
        const feat = { camGrad: true, stats, robust, covW, covSubjW: 0, randBg };
        const b = eski.makeRenderSrc(9, 1e-4, tileGrad, sub, mode, 0.2, 2, 0.1, spread, batch, zskip, pvec, feat);
        for (const f of [feat, { ...feat, depth: false }]) {
          n++;
          if (yeni.makeRenderSrc(9, 1e-4, tileGrad, sub, mode, 0.2, 2, 0.1, spread, batch, zskip, pvec, f) !== b) fark++;
        }
        // SSIM/SSAA modları derinliği yok sayar: bayrakla da aynı metin
        if (mode !== 0) {
          n++;
          if (yeni.makeRenderSrc(9, 1e-4, tileGrad, sub, mode, 0.2, 2, 0.1, spread, batch, zskip, pvec, { ...feat, depth: true }) !== b) fark++;
        }
      }
  for (const sh of [0, 3]) for (const compact of [false, true]) for (const statMax of [false, true]) for (const camGrad of [false, true]) {
    const b = eski.makeChainSrc(0, sh, 'sigmoid', statMax, 0.1, true, compact, camGrad, 0, 3, 0);
    n += 2;
    if (yeni.makeChainSrc(0, sh, 'sigmoid', statMax, 0.1, true, compact, camGrad, 0, 3, 0) !== b) fark++;
    if (yeni.makeChainSrc(0, sh, 'sigmoid', statMax, 0.1, true, compact, camGrad, 0, 3, 0, false) !== b) fark++;
  }
  return { n, fark };
}

// ---- tarayıcı tarafı (page.evaluate içinde çalışır) ----

/** gradcheck yapılandırmalarını koşar. */
async function sayfaGradcheck(liste) {
  const m = await import('/src/vendor/splat.js/gs/gradcheck.js');
  const adp = await navigator.gpu.requestAdapter();
  const altGrup = adp && adp.features.has('subgroups');
  const out = [];
  for (const c of liste) {
    if (c.altGrup && !altGrup) { out.push({ ad: c.ad, atlandi: 'subgroups yok' }); continue; }
    const t0 = performance.now();
    const r = c.poz ? await m.gradCheckPose(c.opts) : await m.gradCheckSmall(c.opts);
    out.push({ ad: c.ad, poz: !!c.poz, r, sn: (performance.now() - t0) / 1000 });
  }
  return out;
}

/** SSIM / SSAA modları derinliği yok sayar (bir kez log); depthWeight > 0 ama
 *  derinlik karesi yoksa varyant kurulmaz. */
async function sayfaModlar() {
  const { GSTrainer } = await import('/src/vendor/splat.js/gs/trainer.js');
  const W = 32, H = 32;
  const data = new Float32Array(16 * 16);
  for (let i = 0; i < 16; i++) { const b = i * 16; data[b] = (i % 4 - 1.5) * 0.3; data[b + 1] = ((i >> 2) - 1.5) * 0.3; data[b + 2] = 3; data[b + 3] = data[b + 4] = data[b + 5] = Math.log(0.1); data[b + 6] = 1; data[b + 13] = 1; }
  const rgb = new Float32Array(W * H * 3).fill(0.5);
  // splat'ların hepsi z = 3'te: normalize derinlik Dn = D / O tam 3, hedef 4 ->
  // e = -0.25, piksel kaybı sqrt(0.0625 + 1e-4) - 0.01 = 0.24020 (her piksel)
  const depth = new Float32Array(W * H).fill(4);
  const cams = [{ imgIdx: 0, R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], f: 30, cx: W / 2, cy: H / 2, w: W, h: H }];
  const loglar = [];
  const eskiLog = console.log;
  console.log = (...a) => { loglar.push(a.join(' ')); eskiLog(...a); };
  const out = {};
  try {
    for (const [ad, o, im] of [
      ['ssim', { ssimWeight: 0.2 }, { tw: W, th: H, rgb, depth }],
      ['ssaa', { ssaa: 2 }, { tw: W, th: H, rgb, depth }],
      ['ssim-tekrar', { ssimWeight: 0.2 }, { tw: W, th: H, rgb, depth }],
      ['derinlik karesi yok', {}, { tw: W, th: H, rgb }],
      ['mod 0 + derinlik', {}, { tw: W, th: H, rgb, depth }],
    ]) {
      const tr = await GSTrainer.create({ depthWeight: 0.5, shDeg: 0, ...o });
      tr.setup({ data: data.slice(), n: 16 }, cams, [im], W, H, 1);
      tr.stepOnce();
      await tr.readLoss();
      out[ad] = { hasDepth: tr.hasDepth, depthLoss: tr.depthLoss, statsWords: tr.statsWords };
      tr.device.destroy();
    }
  } finally { console.log = eskiLog; }
  out.yoksayLog = loglar.filter((l) => l.includes('depthWeight ignored')).length;
  return out;
}

/** Sentetik sahne + GT derinlik + tohum; eğitim kolları. */
async function sayfaEgitim({ refKok, adim, derinAdim, derinKollar, olcumAraligi }) {
  const syn = await import('/src/vendor/splat.js/synthetic.js');
  const { initGaussians } = await import('/src/vendor/splat.js/gs/init.js');
  const { makeRng } = await import('/src/vendor/splat.js/sfm/geometry.js');
  const YeniT = (await import('/src/vendor/splat.js/gs/trainer.js')).GSTrainer;
  const EskiT = (await import(`${refKok}/gs/trainer.js`)).GSTrainer;
  const NCAM = 12, CAP = 320;
  const raw = syn.generateSyntheticRaw(NCAM);
  const frames = syn.generateSyntheticDataset(NCAM, CAP);

  // synthetic.js buildScene geometrisi (y aşağı): köşe düzlemleri + kutu yüzleri
  const dik = (o, u, v) => ({ o, u, v });
  const bx = [-0.3, 0.45, -0.2], bs = 0.55;
  const c = (dx, dy, dz) => [bx[0] + dx * bs, bx[1] + dy * bs, bx[2] + dz * bs];
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const quad = (p0, p1, p3) => dik(p0, sub3(p1, p0), sub3(p3, p0));
  const yuzeyler = [
    dik([-1.6, 1.0, -1.6], [3.2, 0, 0], [0, 0, 3.2]),   // zemin
    dik([-1.6, 1.0, 1.6], [3.2, 0, 0], [0, -2.4, 0]),   // arka duvar
    dik([1.6, 1.0, 1.6], [0, 0, -3.2], [0, -2.4, 0]),   // yan duvar
    quad(c(0, 0, 0), c(1, 0, 0), c(0, -1, 0)), quad(c(0, 0, 1), c(1, 0, 1), c(0, -1, 1)),
    quad(c(0, 0, 0), c(0, 0, 1), c(0, -1, 0)), quad(c(1, 0, 0), c(1, 0, 1), c(1, -1, 0)),
    quad(c(0, -1, 0), c(1, -1, 0), c(0, -1, 1)),
  ].map((s) => {
    const n = [s.u[1] * s.v[2] - s.u[2] * s.v[1], s.u[2] * s.v[0] - s.u[0] * s.v[2], s.u[0] * s.v[1] - s.u[1] * s.v[0]];
    const l = Math.hypot(...n);
    return { ...s, n: n.map((x) => x / l), alan: l };
  });
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // ışın–dikdörtgen: o + s d, s > 0; parametreler [0,1]
  const kes = (org, dir) => {
    let best = Infinity;
    for (const y of yuzeyler) {
      const den = dot(dir, y.n);
      if (Math.abs(den) < 1e-12) continue;
      const s = dot(sub3(y.o, org), y.n) / den;
      if (!(s > 1e-6) || s >= best) continue;
      const q = sub3([org[0] + s * dir[0], org[1] + s * dir[1], org[2] + s * dir[2]], y.o);
      const a = dot(q, y.u) / dot(y.u, y.u), b = dot(q, y.v) / dot(y.v, y.v);
      if (a >= 0 && a <= 1 && b >= 0 && b <= 1) best = s;
    }
    return best;
  };
  const cams = raw.map((v, i) => {
    const fr = frames[i], sc = fr.tw / v.w;
    return { imgIdx: i, R: v.pose.R, t: v.pose.t, f: v.f * sc, cx: fr.tw / 2, cy: fr.th / 2, w: fr.tw, h: fr.th };
  });
  // GT derinlik: kamera uzayı z (yön vektörünün z'si 1 → s = z), ıska = NaN
  const derinlik = cams.map((cm) => {
    const { R, t } = cm;
    const org = [-(R[0] * t[0] + R[3] * t[1] + R[6] * t[2]), -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2]), -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2])];
    const dep = new Float32Array(cm.w * cm.h);
    for (let y = 0; y < cm.h; y++) for (let x = 0; x < cm.w; x++) {
      const dc = [(x + 0.5 - cm.cx) / cm.f, (y + 0.5 - cm.cy) / cm.f, 1];
      const dw = [R[0] * dc[0] + R[3] * dc[1] + R[6] * dc[2], R[1] * dc[0] + R[4] * dc[1] + R[7] * dc[2], R[2] * dc[0] + R[5] * dc[1] + R[8] * dc[2]];
      const s = kes(org, dw);
      dep[y * cm.w + x] = s < Infinity ? s : NaN;
    }
    return dep;
  });
  const gecerliOran = derinlik.reduce((a, d) => a + d.filter((z) => z > 0).length, 0) / derinlik.reduce((a, d) => a + d.length, 0);

  // tohum: yüzeylerden alana orantılı örnek + normal boyunca gürültü (σ 0.08);
  // renk: noktayı gören ilk kameradan (derinlik tutarlı)
  const rng = makeRng(99);
  const gauss = () => Math.sqrt(-2 * Math.log(rng() + 1e-12)) * Math.cos(2 * Math.PI * rng());
  const toplamAlan = yuzeyler.reduce((a, y) => a + y.alan, 0);
  const noktalar = [];
  for (let k = 0; k < 4000; k++) {
    let r = rng() * toplamAlan, y = yuzeyler[0];
    for (const yy of yuzeyler) { if (r < yy.alan) { y = yy; break; } r -= yy.alan; }
    const a = rng(), b = rng();
    const P = [0, 1, 2].map((j) => y.o[j] + a * y.u[j] + b * y.v[j]);
    let rgb = [0.5, 0.5, 0.5];
    for (let q = 0; q < NCAM; q++) {
      const cm = cams[(k + q) % NCAM], R = cm.R, t = cm.t;
      const pc = [0, 1, 2].map((j) => R[3 * j] * P[0] + R[3 * j + 1] * P[1] + R[3 * j + 2] * P[2] + t[j]);
      if (pc[2] < 0.1) continue;
      const u = Math.floor(cm.f * pc[0] / pc[2] + cm.cx), v = Math.floor(cm.f * pc[1] / pc[2] + cm.cy);
      if (u < 0 || v < 0 || u >= cm.w || v >= cm.h) continue;
      const z = derinlik[(k + q) % NCAM][v * cm.w + u];
      if (!(Math.abs(z - pc[2]) < 0.02 * pc[2])) continue;
      const i3 = (v * cm.w + u) * 3, im = frames[cm.imgIdx].rgb;
      rgb = [im[i3], im[i3 + 1], im[i3 + 2]];
      break;
    }
    const e = 0.08 * gauss();
    noktalar.push({ X: [P[0] + e * y.n[0], P[1] + e * y.n[1], P[2] + e * y.n[2]], rgb });
  }
  const model = initGaussians(noktalar, 2);
  const maxW = Math.max(...cams.map((m) => m.w)), maxH = Math.max(...cams.map((m) => m.h));

  const kur = async (Cls, opts, fr) => {
    const tr = await Cls.create({ seed: 1234, maxIters: 3000, ...opts });
    tr.setup({ data: model.data.slice(), n: model.n, dc: model.dc }, cams, fr, maxW, maxH, model.radius);
    return tr;
  };
  const parametreOzeti = async (tr) => {
    const d = tr.device, bytes = tr.n * 16 * 4;
    const rb = d.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(tr.bufParams, 0, rb, 0, bytes);
    d.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const u = new Uint32Array(rb.getMappedRange());
    let h = 0x811c9dc5;
    for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0;
    rb.unmap(); rb.destroy();
    return h.toString(16);
  };

  // ---- 3. determinizm ----
  const derinlikli = frames.map((f, i) => ({ ...f, depth: derinlik[i] }));
  const derinliksiz = frames.map((f) => ({ ...f, depth: undefined }));
  const kollar = [
    { ad: 'eski kod', Cls: EskiT, opts: {}, fr: frames },
    { ad: 'yeni, depthWeight 0 (kareler derinlikli)', Cls: YeniT, opts: { depthWeight: 0 }, fr: derinlikli },
    { ad: 'yeni, depthWeight 0.2, derinlik karesi yok', Cls: YeniT, opts: { depthWeight: 0.2 }, fr: derinliksiz },
  ];
  const det = [];
  for (const k of kollar) {
    const t0 = performance.now();
    const tr = await kur(k.Cls, k.opts, k.fr);
    const kayip = [];
    for (let s = 0; s < adim; s++) { tr.stepOnce(); kayip.push(await tr.readLoss()); }
    det.push({ ad: k.ad, kayip, ozet: await parametreOzeti(tr), hasDepth: !!tr.hasDepth, sn: (performance.now() - t0) / 1000 });
    console.log(`[derinlik] determinizm kolu bitti: ${k.ad} (${det[det.length - 1].sn.toFixed(0)} sn)`);
    tr.device.destroy();
  }

  // ---- 4. derinlikli eğitim ----
  const olc = async (tr) => {
    let dl = 0, ps = 0, nd = 0;
    for (let ci = 0; ci < tr.camMeta.length; ci++) {
      const r = await tr._evalPass(ci);
      ps += r.psnr;
      if (r.depthLoss != null) { dl += r.depthLoss; nd++; }
    }
    return { depthLoss: nd ? dl / nd : null, psnr: ps / tr.camMeta.length };
  };
  const derin = [];
  for (const lam of derinKollar) {
    const t0 = performance.now();
    const tr = await kur(YeniT, { depthWeight: lam }, derinlikli);
    const seri = [{ adim: 0, ...(await olc(tr)) }];
    for (let s = 1; s <= derinAdim; s++) {
      tr.stepOnce();
      if (s % olcumAraligi === 0) {
        seri.push({ adim: s, ...(await olc(tr)) });
        console.log(`[derinlik] λ ${lam} @${s}: depthLoss ${seri[seri.length - 1].depthLoss?.toFixed(4)}`);
      }
    }
    derin.push({ lam, seri, n: tr.n, sn: (performance.now() - t0) / 1000 });
    tr.device.destroy();
  }
  return { splat: model.n, W: cams[0].w, H: cams[0].h, gecerliOran, det, derin };
}

async function main() {
  const ref = referansBul();
  console.log(`derinlik denetimi: referans (eski kod) = ${ref}`);
  rmSync(GECICI, { recursive: true, force: true });
  mkdirSync(GECICI, { recursive: true });
  execSync(`git archive ${ref} src/vendor/splat.js | tar -x -C "${GECICI}"`, { cwd: REPO_KOKU });
  // düz metin "sayfa": Vite HTML'e HMR istemcisi ekler ve bir kaynak dosya
  // değişince sayfayı yeniden yükler (koşu ortasında bağlam kaybolur); metin
  // belgesinde istemci yok, dinamik import aynı kökenden çalışır
  writeFileSync(resolve(GECICI, 'sayfa.txt'), 'derinlik denetimi\n');

  console.log('\n[1] WGSL özdeşliği (derinlik kapalı)');
  const w = await wgslOzdes(GECICI);
  console.log(`  ${w.n} varyant, fark: ${w.fark}`);
  denetle(w.fark === 0, 'derinlik kapalıyken üretilen WGSL eski kodla aynı değil');

  const oturum = await tarayiciOturumu({ yazilimGpu: !argv.includes('--chrome'), chrome: argv.includes('--chrome') });
  try {
    const page = oturum.page;
    page.setDefaultTimeout(60 * 60 * 1000);
    page.on('console', (m) => { if (m.text().startsWith('[derinlik]')) console.log(`  ${m.text()}`); });
    await page.goto(oturum.url('/.bench-tmp/derinlik/sayfa.txt'), { waitUntil: 'load' });

    console.log('\n[2] sayısal türev denetimi (gradCheckSmall: 160 splat, 64x64; medyan/maks göreli hata, tol 0.05 medyan)');
    const liste = [
      { ad: 'taban (derinliksiz)', opts: {} },
      { ad: 'renk + derinlik, λ 4', opts: { depth: true, depthWeight: 4 } },
      { ad: 'yalnız derinlik, λ 4', opts: { depth: 'only', depthWeight: 4 } },
      { ad: 'yalnız derinlik, λ 1', opts: { depth: 'only', depthWeight: 1 } },
      { ad: 'yalnız derinlik, doğrudan atomik (tileGrad kapalı)', opts: { depth: 'only', depthWeight: 4, trainer: { tileGrad: false } } },
      { ad: 'yalnız derinlik, K=1 boşaltma (gradBatch 1)', opts: { depth: 'only', depthWeight: 4, trainer: { gradBatch: 1 } } },
      { ad: 'yalnız derinlik, istatistik yuvaları (useStats)', opts: { depth: 'only', depthWeight: 4, trainer: { useStats: true } } },
      { ad: 'yalnız derinlik, subgroup toplama', opts: { depth: 'only', depthWeight: 4, trainer: { subgroupAgg: true } }, altGrup: true },
      { ad: 'poz türevi, taban', opts: {}, poz: true },
      { ad: 'poz türevi, yalnız derinlik λ 4', opts: { depth: 'only', depthWeight: 4 }, poz: true },
    ];
    const gc = await page.evaluate(sayfaGradcheck, liste);
    for (const g of gc) {
      if (g.atlandi) { console.log(`  ${g.ad}: ATLANDI (${g.atlandi})`); continue; }
      const r = g.r;
      if (g.poz) {
        console.log(`  ${g.ad}: ok=${r.ok}  ` + r.results.map((x) => `${x.name} ${x.relErr}`).join(', '));
      } else {
        const gruplar = Object.entries(r.summary).sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k} ${v.median}/${v.max}`).join(', ');
        console.log(`  ${g.ad}: ok=${r.ok}, ${r.checked} örnek, tol üstü ${r.failsOverTol}` +
          (r.depthPixels ? `, denetlenen derinlik pikseli ${r.depthPixels.supervised} (O≈0.5 bandı dışlanan ${r.depthPixels.gated})` : ''));
        console.log(`    ${gruplar}`);
      }
      denetle(r.ok, `gradcheck: ${g.ad}`);
    }

    console.log('\n[2b] SSIM / SSAA / derinliksiz kare: derinlik varyantı kurulmaz');
    const md = await page.evaluate(sayfaModlar);
    console.log(`  ${JSON.stringify(md)}`);
    denetle(!md.ssim.hasDepth && !md.ssaa.hasDepth && !md['ssim-tekrar'].hasDepth, 'SSIM/SSAA modunda derinlik varyantı kuruldu');
    denetle(md.yoksayLog === 1, `SSIM/SSAA yok sayma logu bir kez değil (${md.yoksayLog})`);
    denetle(!md['derinlik karesi yok'].hasDepth && md['derinlik karesi yok'].statsWords === 4, 'derinlik karesi yokken varyant/istatistik değişti');
    denetle(md['mod 0 + derinlik'].hasDepth && Math.abs(md['mod 0 + derinlik'].depthLoss - 0.2402) < 1e-3,
      `mod 0 + derinlik: depthLoss ${md['mod 0 + derinlik'].depthLoss}, beklenen 0.2402 (Dn = D/O = 3, hedef 4)`);

    console.log('\n[3-4] sentetik veri: determinizm (50 adım) ve derinlikli eğitim (100 adım)…');
    const e = await page.evaluate(sayfaEgitim, {
      refKok: '/.bench-tmp/derinlik/src/vendor/splat.js', adim: 50, derinAdim: 100, derinKollar: [1e-6, 0.2, 1], olcumAraligi: 20,
    });
    console.log(`  sahne: 12 kamera ${e.W}x${e.H}, ${e.splat} splat, GT derinlik geçerli piksel %${(e.gecerliOran * 100).toFixed(1)}`);
    const taban = e.det[0];
    for (const k of e.det) {
      const ayni = k.kayip.length === taban.kayip.length && k.kayip.every((v, i) => v === taban.kayip[i]);
      console.log(`  ${k.ad}: ${k.sn.toFixed(0)} sn, kayıp[0] ${k.kayip[0]?.toExponential(6)}, kayıp[49] ${k.kayip[k.kayip.length - 1]?.toExponential(6)}, ` +
        `parametre özeti ${k.ozet}, hasDepth=${k.hasDepth}${k === taban ? '' : `, eskiyle ${ayni && k.ozet === taban.ozet ? 'BİREBİR AYNI' : 'FARKLI'}`}`);
      if (k !== taban) {
        denetle(ayni, `determinizm: ${k.ad} kayıp dizisi eski koddan farklı`);
        denetle(k.ozet === taban.ozet, `determinizm: ${k.ad} son parametreler eski koddan farklı`);
        denetle(!k.hasDepth, `determinizm: ${k.ad} derinlik varyantını kurdu`);
      }
    }
    for (const d of e.derin) {
      console.log(`  λ ${d.lam}: ${d.sn.toFixed(0)} sn — ` + d.seri.map((s) => `@${s.adim} dL ${s.depthLoss?.toFixed(4)} (PSNR ${s.psnr.toFixed(2)})`).join(', '));
    }
    const olcum = e.derin.find((d) => d.lam < 1e-3);
    for (const d of e.derin.filter((x) => x.lam >= 0.1)) {
      const ilk = d.seri[0].depthLoss, son = d.seri[d.seri.length - 1].depthLoss;
      denetle(son < ilk, `derinlikli eğitim λ ${d.lam}: depthLoss düşmedi (${ilk} → ${son})`);
      if (olcum) {
        const oSon = olcum.seri[olcum.seri.length - 1].depthLoss;
        denetle(son < oSon, `derinlikli eğitim λ ${d.lam}: depthLoss (${son}) λ≈0 kolundan (${oSon}) düşük değil`);
      }
    }
  } finally {
    await oturum.kapat();
  }
  console.log(hatalar.length ? `\nSONUÇ: ${hatalar.length} denetim BAŞARISIZ` : '\nSONUÇ: tüm denetimler geçti');
  process.exit(hatalar.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
