# Gezinme Parça 1 — Gezilebilirlik Ölçümü: Uygulama Planı

> Uygulama yöntemi: görev başına bir uygulayıcı alt-ajan, ardından şartname
> denetimi ve kod kalitesi denetimi (subagent-driven development). Adımlar
> `- [ ]` ile izlenir.

**Hedef:** Bugünkü dar gezinme alanını, aynı kamera pozlarında tekrar
ölçülebilen sayılara dökmek. Yolun başı / ortası / sonunda yana ve öne kayınca
görüntünün ne kadar bozulduğu, sabit ayrılmış karelerde kalite ve aşama süreleri
tek bir rapora yazılır. 2–5. parçaların her kararı bu raporun eski/yeni
karşılaştırmasıyla verilir.

**Mimari:** Saf TypeScript ölçüm çekirdeği (Node'da test edilir) + tarayıcıda
koşan ölçüm sayfası (`bench/`, üretim build'ine girmez) + Playwright ile onu
süren Node komutu. Gerçek klip ölçümü kullanıcının GPU'lu makinesinde aynı
komutla koşar; bu ortamda (GPU yok) yalnız sentetik sahne, SwiftShader WebGPU
ile koşar. Sentetik sahnenin geometrisi bilindiği için her sonda pozunda gerçek
görüntü (GT) üretilir: "yan bakış referansı" budur.

**Teknoloji:** TypeScript (Node 22 type-stripping ile doğrudan import), three.js
(sentetik sahne), vendored splat.js (SfM + 3DGS), vendored mediabunny (WebM),
`playwright-core` (devDependency; tarayıcı indirmez, kurulu Chrome veya
verilen yürütülebilir kullanılır).

## Değişmez kurallar (her görev için)

- `src/vendor/splat.js/` altına bu parçada DOKUNULMAZ.
- Üretim davranışı değişmez: `egitimBaslat`'a eklenen her şey isteğe bağlıdır,
  verilmezse bugünkü yol bit bit aynıdır.
- Git geçmişinde yapay zekâ izi yok (CHANGELOG "KURAL"): commit mesajı yalnız
  ne + neden, `Co-authored-by` yok, yazar Emre.
- Yeni `verify-*.mjs` betikleri `package.json` `verify` zincirinin sonuna eklenir.
  Bunu ve commit'i ana ajan yapar: uygulayıcı alt-ajanlar `package.json`'a ve
  git'e dokunmaz (görevler aynı çalışma ağacında paralel koşar, dosyaları ayrıktır).
- Kod yorumları İngilizce, tanımlayıcılar mevcut dosyaların diliyle (Türkçe
  ağırlıklı), CHANGELOG/ARCHITECTURE Türkçe.

## Koordinat ve birim sözleşmesi

- `GsKamera`: `R` satır sıralı dünya→kamera, COLMAP (x sağ, y aşağı, z ileri),
  `t`; merkez `C = −Rᵀt` (`kameraMerkezi`). R'nin 0. satırı kameranın sağ
  ekseni, 2. satırı bakış yönü (dünyada).
- Ölçüm birimi (`olcumBirimi`): `yol` çekimde yürünen yolun uzunluğu `L`
  (`flySiniri(...,'yol')` ile aynı toplam), `yorunge`/`karma` çekimde medyan
  kamera–pivot uzaklığı (`flySiniri(...).olcek`). Tüm sonda mesafeleri bu
  birimin kesri olarak tanımlanır → SfM'nin keyfi ölçeği ve dünya çerçevesi
  sonuçları etkilemez; iki farklı koşu aynı sondaları üretir.

## Dosya haritası

| Dosya | Sorumluluk |
|---|---|
| `src/engine/reconstruction/gezinmeOlcum.ts` (yeni) | Sonda pozları, bugünkü sınır mesafesi, görüntü metrikleri, kullanılabilir mesafe, rapor tipleri |
| `src/engine/reconstruction/hizalama.ts` (yeni) | Umeyama Sim(3), poz dönüşümü, COLMAP kamerasından three.js matrisleri |
| `scripts/verify-gezinme-olcum.mjs`, `scripts/verify-hizalama.mjs`, `scripts/verify-olcum-kancasi.mjs` (yeni) | Node testleri |
| `src/bench/sentetikSahne.ts` (yeni) | Sentetik orman yolu: tohumlu sahne tanımı, GT kamera yolu, analitik engel uzaklığı (saf, three'siz) |
| `src/bench/sentetikCizim.ts` (yeni) | Sahneyi three.js ile çizer (verilen `GsKamera` → piksel) |
| `bench/klip.html`, `bench/klip.ts` (yeni) | Sentetik klibi WebM + `gt.json` olarak üretir |
| `scripts/verify-sentetik-sahne.mjs` (yeni) | Sentetik sahnenin saf kısmının testleri |
| `src/engine/reconstruction/egitim3dgs.ts` (değişir) | İsteğe bağlı ölçüm kancası: ek (ayrılmış) kareler + `degerlendir()` |
| `bench/gezinme.html`, `bench/gezinme.ts` (yeni) | Tarayıcı tarafı: eğit → sondala → ölç → rapor |
| `scripts/olc-gezinme.mjs` (yeni) | Vite + Playwright ile sayfayı sürer, raporu ve PNG'leri yazar, iki raporu karşılaştırır |
| `scripts/sentetik-klip.mjs` (yeni) | `bench/klip.html`'i sürer, klibi `assets/test-clips/`e yazar |
| `docs/benchmarks/gezinme-taban.md` (yeni) | Taban ölçüm sonuçları |

---

### Görev 1: Ölçüm çekirdeği (`gezinmeOlcum.ts`) — model: sonnet

**Dosyalar:** oluştur `src/engine/reconstruction/gezinmeOlcum.ts`,
`scripts/verify-gezinme-olcum.mjs`; değiştir `package.json` (verify zinciri).

Arayüz (birebir):

```ts
import type { GsKamera } from './egitim3dgs.ts';
import type { CekimTuru, FlySiniri } from '../../ui/egitimControls.ts';
type Vec3 = [number, number, number];

export type Bolge = 'bas' | 'orta' | 'son';
export type Yon = 'sag' | 'sol' | 'ileri' | 'yukari';
export interface Sonda { id: string; bolge: Bolge; s: number; yon: Yon; d: number; kamera: GsKamera }
export const BOLGELER: Record<Bolge, number> = { bas: 0.1, orta: 0.5, son: 0.9 };
/** Offsets in units of `olcumBirimi`; 0 is the on-path reference. */
export const MESAFELER: Record<Yon, number[]> = {
  sag: [0, 0.02, 0.04, 0.06, 0.1, 0.15, 0.2, 0.3],
  sol: [0, 0.02, 0.04, 0.06, 0.1, 0.15, 0.2, 0.3],
  ileri: [0, 0.05, 0.1, 0.2, 0.3],
  yukari: [0, 0.02, 0.04, 0.06, 0.1],
};
export function olcumBirimi(kameralar: Vec3[], pivot: Vec3, tur: CekimTuru): number;
export function tabanKamera(pozlar: readonly GsKamera[], yukari: Vec3, tur: CekimTuru, s: number): GsKamera;
export function sondaPozlari(pozlar: readonly GsKamera[], yukari: Vec3, pivot: Vec3, tur: CekimTuru,
  secim?: { bolgeler?: Bolge[]; yonler?: Yon[] }): Sonda[];
export function bugunkuSinir(taban: GsKamera, yon: Yon, sinir: FlySiniri, yukari: Vec3, birim: number): number;
export function psnr(a: Uint8ClampedArray, b: Uint8ClampedArray, maske?: Uint8Array): number;
export function ssim(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number): number;
export function keskinlik(img: Uint8ClampedArray, w: number, h: number): number;
export function kaplama(siyah: Uint8ClampedArray, beyaz: Uint8ClampedArray): number;
export function kullanilabilirMesafe(seri: { d: number; iyi: boolean }[]): number;
```

Davranış:

- `tabanKamera`: `tur === 'yol'` ise `yolKamerasi(pozlar, yukari, s)`; değilse
  çekim sırasındaki `round(s·(n−1))` indisli eğitim pozu (değiştirilmeden).
- `sondaPozlari`: her bölge × yön × mesafe için tabandan yalnız ÖTELENMİŞ kamera
  (R aynı). `sag` = +R satır 0, `sol` = −R satır 0, `ileri` = +R satır 2,
  `yukari` = dünya `yukari` vektörü (birimlenmiş). Mesafe `d · olcumBirimi`.
  `id` = `${bolge}_${yon}_${d.toFixed(2)}`. `d = 0` her bölge için tek kez
  (`${bolge}_merkez_0.00`, `yon: 'sag'`) üretilir, yinelenmez.
- `bugunkuSinir`: tabandan `yon` doğrultusunda `flyStep`'i `birim·0.005`
  adımlarla en çok 400 kez çağırır (`yukari` yönü için `axes.vertical`), her
  adımda merkezin istenen doğrultudaki ilerlemesini ölçer; ilerleme adımın
  %10'unun altına düşünce durur. Döner: kat edilen mesafe / `birim`.
  (`yol` çekimde yan yön için beklenen ≈ `YOL_PAY` = 0.06.)
- `psnr`: RGB kanalları (alfa hariç), 0..255, `maske` verilirse yalnız maske
  1 olan pikseller; özdeş girdide `Infinity`.
- `ssim`: lüminans (0.299/0.587/0.114), 8×8 kayan pencere adım 4, C1 = (0.01·255)²,
  C2 = (0.03·255)², pencere ortalaması.
- `keskinlik`: lüminans üzerinde 4-komşu Laplasyen varyansı (kenar pikseller hariç).
- `kaplama`: aynı pozun siyah ve beyaz arka planla çizimi; piksel başına
  geçirgenlik `T = mean_rgb(beyaz − siyah)/255`; döner `1 − ortalama(T)`
  (0..1'e sıkıştırılmış).
- `kullanilabilirMesafe`: `d`'ye göre sıralı seride `d = 0`'dan başlayıp
  kesintisiz `iyi` olan en büyük `d`; `d = 0` bile iyi değilse 0.

Adımlar:

- [ ] Testi yaz (`scripts/verify-gezinme-olcum.mjs`), statik `.ts` import'larıyla
  (bkz. `scripts/verify-cekim-yolu.mjs`). En az: düz 40 kameralık ileri yürüyüşte
  (`verify-cekim-yolu.mjs`'deki `poz` yardımcısı gibi) `olcumBirimi` = yol
  uzunluğu; sonda sayısı = 3 bölge × (1 merkez + 7 sag + 7 sol + 4 ileri + 4 yukari);
  `orta_sag_0.10` merkezi tabandan tam `0.1·L` sağda ve R değişmemiş;
  `bugunkuSinir(yol, 'sag')` ∈ [0.055, 0.065]; yörüngede `birim` = medyan
  kamera–pivot uzaklığı; `psnr` bilinen MSE'de doğru (MSE 100 → 28.13 dB),
  özdeşte Infinity; `ssim` özdeşte 1, rastgele gürültüde < 0.5; `keskinlik`
  dama tahtasında > düz renkte (düz = 0); `kaplama` T=0 → 1, T=1 → 0, yarı
  yarıya → 0.5; `kullanilabilirMesafe` örnekleri (kesinti, hiç iyi değil, hepsi iyi).
- [ ] `node scripts/verify-gezinme-olcum.mjs` → modül yok hatasıyla KIRMIZI.
- [ ] Modülü yaz; test YEŞİL.
- [ ] `package.json` `verify` zincirinin sonuna ekle; `npx tsc --noEmit` temiz.
- [ ] Commit: `feat(olcum): gezinme sonda pozlari ve goruntu metrikleri`.

### Görev 2: Hizalama (`hizalama.ts`) — model: opus

**Dosyalar:** oluştur `src/engine/reconstruction/hizalama.ts`,
`scripts/verify-hizalama.mjs`.

```ts
export interface Sim3 { s: number; R: number[] /* 3x3 row-major */; t: Vec3 }
/** Least-squares similarity dst ≈ s·R·src + t (Umeyama 1991), reflection-safe. */
export function umeyama(src: Vec3[], dst: Vec3[]): Sim3 & { rms: number };
export function simUygula(T: Sim3, p: Vec3): Vec3;
/** Camera re-expressed in the target frame of `T` (world_target = T(world_src)):
 *  centre maps through T, R_target = R_src · T.Rᵀ, intrinsics unchanged. */
export function kamerayiDonustur(k: GsKamera, T: Sim3): GsKamera;
/** Column-major 4x4 matrices for a three.js camera reproducing `k` exactly:
 *  view (world→three camera, y up / looking down −z) and projection from
 *  f, fy ?? f, cx, cy, w, h with the given near/far. */
export function threeMatrisleri(k: GsKamera, near: number, far: number): { view: number[]; proj: number[] };
```

- [ ] Testler önce: rastgele Sim(3) (s = 2.7, keyfi dönme, öteleme) ve 30 nokta
  → `umeyama` onu 1e-9 içinde geri bulur, `rms` ≈ 0; gürültülü girdide rms > 0;
  yansıma üretmez (det R = +1). `kamerayiDonustur` sonrası bir dünya noktasının
  piksel izdüşümü, noktanın kendisi de aynı T ile taşındığında birebir aynı
  (1e-9). `threeMatrisleri`: rastgele 20 dünya noktası için `proj·view·p`
  NDC'si → piksel (`x = (ndc.x+1)/2·w`, `y = (1−ndc.y)/2·h`) = COLMAP izdüşümü
  `(f·X/Z + cx, fy·Y/Z + cy)` (1e-6), derinlik NDC'si near/far aralığında.
- [ ] KIRMIZI → uygula → YEŞİL; tsc temiz.
- [ ] Commit: `feat(olcum): Sim(3) hizalama ve three.js kamera matrisleri`.

### Görev 3: Sentetik orman yolu + yan bakış GT'si — model: sonnet

**Dosyalar:** oluştur `src/bench/sentetikSahne.ts`, `src/bench/sentetikCizim.ts`,
`bench/klip.html`, `bench/klip.ts`, `scripts/sentetik-klip.mjs`,
`scripts/verify-sentetik-sahne.mjs`; `.gitignore`'a `olcum-out/`.

Sahne (`sentetikSahne.ts`, saf, three import etmez):

- Dünya COLMAP gibi: y aşağı (zemin `y = +1.6`, göz yüksekliği 0), yürüyüş +z.
- Tohumlu (`mulberry32`) içerik: patika boyunca iki yanda 70 ağaç gövdesi
  (dikey silindir, yarıçap 0.12–0.35, x ∈ ±[1.2, 7], z ∈ [−2, 26]; patika
  şeridi |x| < 0.9 boş), 40 çalı (küre, yarıçap 0.2–0.5), zemin düzlemi,
  z = 34'te uzak fon duvarı. Her nesnenin prosedürel doku tohumu.
- `yolPozu(t01): GsKamera` — GT kamera: z 0 → 14 m, x'te ±0.15 m yavaş
  kıvrım, 0.03 m yürüme salınımı, ±4° bakış sapması; `f = 0.9·w`, `w×h = 960×540`.
- `engelUzakligi(p: Vec3): number` — p'nin en yakın gövde/çalı yüzeyine ve
  zemine işaretli uzaklığı (içeride negatif). 3. parçanın GT boş alanı.
- `sahneTanimi(tohum)` — çizimin kullanacağı nesne listesi (tip, konum, boyut,
  renk, doku tohumu).

Çizim (`sentetikCizim.ts`): three.js `WebGLRenderer` (preserveDrawingBuffer),
nesnelere prosedürel `CanvasTexture` (ağaç kabuğu çizgileri, zemin çakıl
lekeleri, fon dağ/bulut) — SIFT'in tutunacağı yüksek frekanslı doku şart. Işık
sabit (ambient + tek yönlü), gölge yok, sis yok (GT deterministik olsun).
`ciz(k: GsKamera): ImageData` — `threeMatrisleri` ile kamerayı birebir kurar
(`camera.matrixWorldInverse` ve `projectionMatrix` doğrudan atanır,
`matrixAutoUpdate = false`).

Klip (`bench/klip.ts` + `scripts/sentetik-klip.mjs`): 12 sn, 30 fps, 960×540,
`yolPozu(i/(n−1))` karelerini mediabunny ile VP9 WebM'e kodlar (bkz.
`src/ui/klipRender.ts` kodlama deseni), `gt.json` = `{ tohum, w, h, fps,
kareler: [{ t, R, t_, f, cx, cy }] }` (ad çakışmasın diye kamera ötelemesi
`tv`). Çıktı: `assets/test-clips/sentetik-orman-yolu.webm` ve
`assets/test-clips/sentetik-orman-yolu.gt.json` (dizin gitignore'lı).
Komut Vite dev sunucusunu (`createServer`) ve `playwright-core`'u kullanır;
tarayıcı: `--chrome` → `channel: 'chrome'`, yoksa `PLAYWRIGHT_BROWSERS_PATH`
altındaki chromium; `--yazilim-gpu` bayrağı SwiftShader argümanlarını ekler
(`--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader
--use-webgpu-adapter=swiftshader --disable-vulkan-surface`).

- [ ] `verify-sentetik-sahne.mjs` önce: aynı tohum → aynı sahne; patika şeridi
  boş (|x| < 0.9 içinde gövde yok); `yolPozu(0)` ve `(1)` z = 0 / 14; tüm GT
  pozlarında `engelUzakligi(C) > 0.5`; bilinen bir gövdenin yüzeyinde uzaklık
  ≈ 0 ve merkezinde negatif; kamera R ortonormal, det +1.
- [ ] KIRMIZI → uygula → YEŞİL; `package.json`'a `playwright-core`
  devDependency ve verify zincirine test.
- [ ] Bu ortamda `node scripts/sentetik-klip.mjs --yazilim-gpu` çalıştır;
  klibin ilk/orta/son karesini PNG olarak `olcum-out/sentetik-onizleme/`e yaz
  ve gözle kontrol et (dokulu, gövdeler seçiliyor, patika görünüyor).
- [ ] Commit: `feat(olcum): yan bakis GT'li sentetik orman yolu klibi`.

### Görev 4: `egitimBaslat` ölçüm kancası — model: sonnet

**Dosya:** değiştir `src/engine/reconstruction/egitim3dgs.ts`.

- `egitimBaslat(..., options?: { subjectOnly?: boolean; olcum?: OlcumKancasi })`
  ```ts
  export interface OlcumKancasi {
    /** Frames appended to the extracted set; their names become the session's
     *  `evalFrames` (poses solved, excluded from the loss, scored). Names must
     *  be unique and must not collide with extracted `frame_#####.jpg`. */
    ayrilanKareler?: { source: Blob; name: string; t: number }[];
  }
  ```
  `createSession`'a `evalFrames: ayrilanKareler.map(k => k.name)` geçer.
- `Egitim.degerlendir(): Promise<{ ad: string; kamera: GsKamera; psnr: number }[]>`
  — oturumun `testCams`'i için `trainer.evalCamPsnr(ci)` ve kanvas ölçekli poz
  (`kameraOlcekle`). Ölçüm kancası yoksa boş dizi.
- `Egitim.pozlar` ve `kameralar` ayrılan kareleri İÇERMEZ (gezinme sınırı ve
  çekim türü eğitim karelerinden hesaplanmaya devam eder); ayrılanların pozu
  yalnız `degerlendir()`'den gelir.
- Saf bir yardımcı `olcumKareleriniBirlestir(cikan, ayrilan)` yinelenen / çakışan
  adda hata fırlatır; `scripts/verify-olcum-kancasi.mjs`'te test edilir.
- [ ] Test önce (yardımcı) → KIRMIZI → uygula → YEŞİL; `npm run verify`
  (model isteyen 3 betik bu ortamda indirilemediği için beklenen başarısız:
  verify-depth, verify-seg, verify-curtain — geri kalanı geçer) ve tsc temiz.
- [ ] Commit: `feat(egitim): istege bagli olcum kancasi — sabit ayrilan kareler`.

### Görev 5: Ölçüm sayfası ve komutu — model: sonnet

**Dosyalar:** oluştur `bench/gezinme.html`, `bench/gezinme.ts`,
`scripts/olc-gezinme.mjs`.

Sayfa (`bench/gezinme.ts`), sorgu parametreleri: `klip` (Vite URL'si), `gt`
(isteğe bağlı gt.json URL'si), `etiket`, `katman` (`quick|standard`), `kare`,
`iter`, `ayrilan` (varsayılan 6), `genislik` (kanvas, varsayılan 640).

1. Klibi `fetch` → `File`. Ayrılan kareler: süre `D` için `t_i = (i+0.5)/K·D`,
   `<video>` seek + canvas → JPEG 0.95, ad `olcum_t${t.toFixed(3)}.jpg`.
2. `egitimBaslat(file, canvas, olay, ayar, undefined, { olcum: { ayrilanKareler } })`;
   `ayar` = `{ tier: katman, maxFrames: kare, maxIters: iter, gpu, zayifGpu, entegreGpu }`.
   Her `olay.asama` metnini `performance.now()` ile kaydet; aşamalar:
   `kareler seçiliyor`, `kareler yükleniyor`/load, SfM alt aşamaları
   (`features|matching|focal|register|ba` önekleri), tohum, eğitim (`bitti`'ye kadar).
3. Bitince: `tur = cekimTuru(pozlar, pivot)`, `birim = olcumBirimi(...)`,
   `sondalar = sondaPozlari(...)`. Her sonda: `kareCiz` siyah ve beyaz
   (`{...k, bg:[1,1,1]}`) → `kaplama`, `keskinlik`; GT varsa: eğitim
   kameralarının merkezleri ile gt.json'daki aynı zamanlı GT merkezleri
   arasında `umeyama` (zaman eşlemesi: çıkarılan karelerin `t`'si), sonda
   kamerası `kamerayiDonustur` ile GT dünyasına → `sentetikCizim.ciz` → `psnr`,
   `ssim` (tahmin vs GT). Her yön ve bölge için bugünkü sınır `bugunkuSinir`.
4. Ayrılan kareler: `degerlendir()` PSNR'ı + aynı pozdan `kareCiz` ile SSIM
   (kaynak JPEG kanvas boyutuna ölçeklenir).
5. "İyi" ölçütü (sabitler raporla birlikte yazılır):
   GT varsa `ssim ≥ ssim_0 − 0.08` VE `psnr ≥ psnr_0 − 2`; GT yoksa
   `keskinlik/keskinlik_0 ≥ 0.6` VE `kaplama ≥ 0.97` (`_0` = aynı bölgenin
   merkez sondası). `kullanilabilirMesafe` her bölge × yön.
6. `window.__gezinme = { rapor, pngler: { [id]: dataURL } }`. Rapor şeması:
   `{ surum: 1, etiket, klip, tarayici, gpu, ayar, tur, birim, sureler: {asama: ms},
   sfm: { kayitli, toplamKare, medErr?, rmsBA? }, gauss: n, ayrilan: [{ad, psnr, ssim}],
   sondalar: [{id, bolge, yon, d, kaplama, keskinlik, psnr?, ssim?, iyi}],
   kullanilabilir: {[bolge]: {[yon]: d}}, bugunku: {[bolge]: {[yon]: d}}, esikler }`.

Komut (`scripts/olc-gezinme.mjs`):
`node scripts/olc-gezinme.mjs <klip-yolu> [--gt yol] [--etiket ad] [--katman quick|standard]
[--kare N] [--iter N] [--chrome] [--yazilim-gpu] [--basli]` → Vite dev sunucusu
(`server.fs.allow` klip dizinini içerir, klip `/@fs/...` ile verilir), sayfayı
açar, `__gezinme`'yi bekler (zaman aşımı 3 sa), `olcum-out/<etiket>/<klip-adı>/`
altına `rapor.json`, `sondalar/<id>.png`, `ozet.md` (bölge × yön tablosu:
bugünkü sınır, kullanılabilir mesafe, merkez/0.1 değerleri; ayrılan kare
ortalamaları; aşama süreleri) yazar.
`node scripts/olc-gezinme.mjs --karsilastir <raporA.json> <raporB.json>` →
yan yana `karsilastirma.md` (fark sütunlarıyla) ve aynı sonda kimlikleri için
PNG'leri yan yana gösteren `karsilastirma.html`.

- [ ] Karşılaştırma ve özet üretimi saf fonksiyonlar olarak
  (`scripts/olcum-rapor.mjs`) yazılır ve `verify-gezinme-olcum.mjs`'te iki
  sahte raporla test edilir (önce test).
- [ ] Sayfa + komut; `vite build` ürün girdilerine `bench/` eklenmez (kontrol et).
- [ ] Commit: `feat(olcum): gezinme olcum sayfasi ve komutu`.

### Görev 6: Taban ölçüm — ana ajan

- [ ] Bu ortamda: `node scripts/olc-gezinme.mjs assets/test-clips/sentetik-orman-yolu.webm
  --gt ... --etiket taban --yazilim-gpu` (SwiftShader süresine göre `--kare`/`--iter`
  küçültülür; kullanılan değerler rapora yazılır).
- [ ] Sonda PNG'lerini gözle incele; sayıların görüntüyle tutarlı olduğunu doğrula.
- [ ] `docs/benchmarks/gezinme-taban.md`: sentetik taban tablosu + kullanıcının
  kendi makinesinde koşacağı gerçek klip komutları (orman 3679072, Pixabay
  29721, St George) ve sonuçların buraya ekleneceği boş tablo.
- [ ] CHANGELOG + ARCHITECTURE ("Gezinme Ölçümü Sözleşmesi": birim, sondalar,
  eşikler, rapor şeması).
- [ ] Commit + push.

## Sonraki parçalar (bu raporun kapısıyla)

2–5. parçaların planları, bu parçanın taban raporu çıktıktan sonra aynı
biçimde yazılır. Her yeni yöntem isteğe bağlı bir bayrakla gelir; varsayılan
ancak aynı klip + aynı sondalarda eski/yeni karşılaştırması kazanç gösterirse
değişir.
