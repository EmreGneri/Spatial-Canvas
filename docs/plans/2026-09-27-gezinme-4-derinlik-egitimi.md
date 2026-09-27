# Gezinme Parça 4 — Geometri Destekli 3DGS Eğitimi: Uygulama Planı

> Görev başına uygulayıcı alt-ajan + denetim; paralel görevlerin dosyaları
> ayrıktır, `package.json` ve git ana ajandadır.

**Hedef:** 3. parçanın birleştirilmiş (hizalanmış + tutarlılıkla süzülmüş)
derinliğini eğitime kısıt olarak vermek; yüzeyden kopuk splat'ları, hayaletleri
ve yan bakışta uzayan lekeleri azaltmak. Kabul: aynı yan bakış sondalarında
"iyi" mesafe genişler, sabit ayrılmış karelerin kalitesi gerilemez. İsteğe
bağlıdır; varsayılan ancak ölçümle açılır. İterasyon artışı yalnız bu parçada,
aynı kareler ve sondalarla ölçülmüş kazanç verirse devreye girer.

**Eğiticinin bugünkü hâli (haritalandı, vendor `gs/`):** eğitimde varsayılan
yol birleşik render çekirdeği (mod 0; SSIM ve SSAA kapalı). Kayıp Charbonnier
(DELTA 0.03). `bufProj` yuvası 2 = Gauss merkezinin kamera uzayı z'si (hazır).
Render çekirdeği 8 depolama bağlamasıyla WebGPU varsayılan sınırında — yeni
tampon YOK: hedef derinlik `bufTarget`'ın RGBA bloğundan sonra f32 bitleri
olarak paketlenir, taban ofseti kamera uniform'unun boş `R0.w` yuvasına,
ağırlık `R1.w`'ye yazılır. `gradP` yuva 14–15 boş (14 = dL/dz). Zincir
çekirdeğinde `dpc.z += gz` kamera gradyanlarını da bedavaya verir.
`gradcheck.js` (`gradCheckSmall`) sayısal türev denetimi yapar.

## Görev 1: Derinlik kaybı (vendor eğitici) — model: opus

**Dosyalar:** `src/vendor/splat.js/gs/shaders.js`, `gs/trainer.js`, `gs/gradcheck.js`,
`session.js` (yalnız çerçeve verisi ve seçenek geçişi), `VENDORED.md`.

- Girdi: `frame.depth?: Float32Array` (eğitim çözünürlüğünde, kamera uzayı z,
  NaN = geçersiz); `undistortFrames` onu `alpha` gibi en yakın komşuyla yeniden
  örnekler. Oturum/eğitici seçeneği `depthWeight` (λ, varsayılan 0 = kapalı,
  kod yolu bugünküyle birebir aynı — derinlik yoksa shader'a hiç girmez:
  ayrı pipeline varyantı ya da uniform bayrağı + erken çıkış, ölçülmüş
  performans kaybı olmadan).
- İleri: `D += T·α·z_i`, `O = 1 − T`; normalize `Dn = D / max(O, 1e-4)`.
- Kayıp (piksel başına, hedef geçerli ve `O > 0.5` iken): göreli Charbonnier
  `e = (Dn − Dt) / Dt`, `L_d = λ·(sqrt(e² + δ²) − δ)`, δ = 0.01. Göreli kayıp
  yakın geometriyi (gezinme için önemli olanı) uzak fondan ağır tartar.
- Geri: haritadaki formüller — `SD` birikimi, `galpha += gD·(z·Tb − SD/(1−α)) + gOd·T/(1−α)`,
  `gz = gD·α·Tb` → `gradP[id*16 + 14]` (tileGrad flush ve subgroup yollarında
  yuva eşlemesi dahil), zincirde `dpc.z += gz`. Renk hedefi geçersiz ama derinlik
  geçerli pikselde `gC = 0`, geri geçiş derinlik için yine çalışır.
- SSIM/SSAA modlarında `depthWeight > 0` ise bir kez log + derinlik yok sayılır
  (bu parçanın kapsamı mod 0).
- İstatistik: `stats` içine derinlik kaybı ayrı sayaç (yeni yuva) — eğitim
  metriğine `depthLoss` olarak çıkar.
- `gradcheck.js`: `gradCheckSmall({ depth: true })` sahnesine hedef derinlik
  ekler ve derinlik kaybı dahil sayısal/analitik türevi karşılaştırır.
- Doğrulama: bu ortamda SwiftShader WebGPU ile `gradCheckSmall` (derinlikli ve
  derinliksiz) geçmeli; mevcut `verify-egitim-*` betikleri yeşil kalmalı;
  `depthWeight = 0` ile bir eğitim koşusunun ilk 50 iterasyonunun kaybı eski
  kodla birebir aynı olmalı (determinizm karşılaştırması).

## Görev 2: Bölgesel yoğunlaştırma kancası (vendor) — model: sonnet

**Dosyalar:** `src/vendor/splat.js/gs/trainer.js` (yalnız `_refineLegacy` donör
seçimi), `session.js` (seçenek geçişi), `VENDORED.md`.

- Seçenek `growRegion?: (x, y, z) => boolean`: verilirse büyüme donörleri
  (bigDonors ve düzgün seçim) yalnız bölge içindeki splat'lardan seçilir;
  taşıma (relocation) donörleri değişmez. Verilmezse davranış aynı.

## Görev 3: Uygulama bağlantısı — model: sonnet (1–2 ve Parça 3'ten sonra)

**Dosyalar:** `src/engine/reconstruction/egitim3dgs.ts`, `src/bench/gezinmeSayfasi.ts`, `scripts/olc-gezinme.mjs`.

- `egitimBaslat` options `derinlikKisiti?: { agirlik: number; kaynak: 'model' | DerinlikKaynagi; bolgesel?: boolean }`:
  SfM'den sonra, tohumdan önce 3. parçanın hizalama + tutarlılık hattıyla eğitim
  karelerinin metrik derinliği üretilir ve `frame.depth` olarak (eğitim
  çözünürlüğüne indirgenmiş) verilir; `depthWeight = agirlik`. `bolgesel` ise
  `growRegion` = boş alan ızgarasında yürünen yola yakın `dolu` vokseller.
  Aynı derinlik ile `Egitim.bosAlan` da kurulur (iş tekrarlanmaz).
- Ölçüm: `--derinlik-kisiti <λ> [--bolgesel]`.

## Görev 4: Ölçüm — ana ajan

- Sentetik (bu ortam, küçük bütçe, iki kol aynı ayarla): λ ∈ {0, 0.05, 0.2};
  yan sondalarda GT SSIM/PSNR ve kullanılabilir mesafe, ayrılan kare PSNR/SSIM,
  eğitim süresi. Gerçek klip ölçümü kullanıcının makinesinde, aynı komutlar.
- Karar: yan "iyi" mesafe ≥ %20 geniş VE ayrılan kare PSNR kaybı ≤ 0.2 dB →
  varsayılan olarak önerilir (açma ayrı commit, kullanıcı ölçümünden sonra).
