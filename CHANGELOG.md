# Değişiklik Günlüğü

Sözleşmeye dokunan her değişiklik buraya yazılır (`ARCHITECTURE.md` kuralı: sessiz sapma yok).
En yeni üstte.

---

## ÖNCE BUNU OKU — `git pull` çalışmayacak (2026-08-10)

Uzak geçmiş yeniden yazıldı. Gün 1 render commit'i `e6b44cd` → **`fd3dabb`**
oldu. **Ağaç birebir aynı, tek bir dosya bile değişmedi**; commit mesajının
sonundaki bir satır kaldırıldı, o kadar. Yazar (`quanvon
<von3dstudio@gmail.com>`) ve tarih korundu — katkı hâlâ Zeynep'in.

Hash değiştiği için `git pull` merge çıkarır. Doğrusu:

```bash
# Push'lanmamış işin YOKSA
git fetch origin && git reset --hard origin/main
```

```bash
# Push'lanmamış işin VARSA — önce sakla, yoksa emeğin uçar
git stash
git fetch origin && git reset --hard origin/main
git stash pop
```

Emin değilsen kontrol et: `git log origin/main..HEAD --oneline` boş çıkıyorsa
push'lanmamış işin yok, doğrudan `reset --hard` güvenli.

Senkron sonrası doğrulama:

```bash
npm install
npm run fetch:assets   # model + ORT runtime gitignore'lı, yeniden indirilir (~120 MB)
npm run verify         # sözleşme testleri geçmeli
npm run dev
```

### Render katmanını doğrudan etkileyen iki şey

1. **`positionTexture`'ın z bileşeni artık orijine ortalı** (−1..+1, eskiden
   0..+2). 0..1 aralığı isteyen shader `pos.z / POINTS_DEPTH_RANGE + 0.5`
   yazar. Gerekçe aşağıda, "Point cloud yanlış merkez etrafında dönüyordu".
2. **`grainPass.ts` başlangıç uniform değerleri değişti** — senin dosyan.
   Kasıtlıysa tek commit'le geri alınır; shader mantığına dokunulmadı. Tablo
   aşağıda, "Render katmanı" başlığında.

### Kırılırsa fark edilmesi zor olan kurallar

Repoya yeni giren (insan veya asistan) bunları bilmeden değiştirmesin:

| Kural | Nerede | Neden |
|---|---|---|
| y-flip **yalnızca** texture upload'unda (`flipY = true`) | `src/engine/buffers.ts` | Shader'da veya UV'de ikinci bir flip eklenirse ekran doğru görünür ama depth/optik akış ters çalışır |
| Model ve ORT runtime **yerel**, CDN yok | `src/depth.ts`, `public/` | Demo günü internet/sürüm kaymasına bağımlı olmamak için; `env.allowRemoteModels = false` |
| `numThreads = 1` | `src/depth.ts` | Tek thread olduğu için COOP/COEP header'ı gerekmiyor. Çoğaltılırsa header şart olur, embed hedefi kırılır |
| `optimizeDeps.exclude` listesi | `vite.config.ts` | Çıkarılırsa Vite ön-paketlemesi ORT'un dinamik import'unu yeniden yazar, dev'de 500 döner |
| Kamera/video yolunda depth modeli **yok** | `src/depth.ts` → `luminanceHeightMap` | Kare başına depth çıkarımı ~400 ms; canlı kamerada imkânsız. Gün 1 kararı, tartışma kapandı |
| Engine pass içlerine yazmaz | `src/engine/Engine.ts` → `TickablePass` | Her pass `update(time)` sunar, Engine çağırır. Yeni pass'ler (Feedback, ChroAber, Neon) aynı kancayı kullanır |
| Render modu material değişimiyle olur | `engine.setPointsMaterial(mat)` | `uPositions` uniform'u her point cloud shader'ında **zorunlu** — konumlar oradan okunur |

---

## 2026-08-10 — Gün 2 hata düzeltmeleri + sözleşme netleşmesi

Gün 2 veri katmanı üzerinden geçildi; render katmanında da bir düzeltme var.
**Kod yazan/gözden geçiren:** Emre. Zeynep'in `src/shaders/` ve `src/ui/`
dosyalarına yapılan tek dokunuş aşağıda "Render katmanı" başlığında, geri
alınabilir.

### Davranış değiştiren düzeltmeler

**1. Kamera ve video yolu hiç çalışmıyordu — `src/App.tsx`**

Eski akış: video oluştur → `play()` → `startLuminanceLoop()`. Döngü ilk iş
olarak `stopTimers()` çağırıyordu, o da "açık video varsa durdur" yapıyordu —
yani **az önce başlatılan videoyu duraklatıp `srcObject`'i null'lıyordu**.
Kamera açılıp anında ölüyordu; video dosyası ilk karede donuyordu.

Sorumluluklar ayrıldı:

| Fonksiyon | Ne yapar | Ne zaman çağrılır |
|---|---|---|
| `clearTimer()` | Yalnızca interval'i temizler | Yeni döngü başlarken |
| `teardownSource()` | Interval + video + MediaStream + ObjectURL bırakır | **Yeni kaynak yaratılmadan ÖNCE** |

Sıra kuralı: `teardownSource()` her zaman yeni video/stream oluşturmadan önce
çağrılır. Sonra çağrılırsa aynı hata geri gelir.

Yan düzeltmeler: `readyState < 2` iken kare atlanıyor (video ilk kareyi
çözmeden `drawImage` boş çiziyordu), video dosyaları `loop = true`, ObjectURL'ler
`revokeObjectURL` ile bırakılıyor, "sentetik görsel" ve fotoğraf yükleme de
canlı döngüyü durduruyor.

**2. Point cloud yanlış merkez etrafında dönüyordu — `src/engine/buffers.ts`**

`z = d · 2` bulutu z = 0..2 aralığına koyuyordu; OrbitControls hedefi ise
(0,0,0), yani bulutun **arka yüzeyi**. Döndürünce sahne savruluyordu.

```
eski:  z = d · POINTS_DEPTH_RANGE          →  0 .. +2
yeni:  z = (d − 0.5) · POINTS_DEPTH_RANGE  → −1 .. +1   (orijine ortalı)
```

**Render katmanını ilgilendirir:** `positionTexture`'ın z bileşeni artık
ortalıdır. 0..1 aralığı isteyen shader `pos.z / POINTS_DEPTH_RANGE + 0.5`
yazar — `src/engine/points.ts` içindeki yer tutucu shader'da örneği var.
`ARCHITECTURE.md` → "Koordinat Uzayı" güncellendi.

**3. DPR > 1 olan ekranda canvas konteynerden taşıyordu — `src/engine/Engine.ts`**

`renderer.setSize(w, h, false)` çizim tamponunu ayarlıyor ama canvas'ın CSS
boyutunu yazmıyordu. DPR 1.5'te 640×420 konteynerin içinde canvas 960×630 CSS
piksel kaplıyordu. DPR 1 olan makinede görünmeyen, DPR > 1 olanda bariz bir hata.
`updateStyle` varsayılana (açık) döndürüldü.

**4. Kameraya çok yaklaşan noktalar ekranı beyazlatıyordu — `src/engine/points.ts`**

`gl_PointSize = uPointSize / -mv.z` — bulutun içine uçunca `-mv.z → 0`, nokta
boyutu patlıyordu. `max(-mv.z, 0.1)` ile sınırlandı.

**5. `Engine.dispose()` composer'ı bırakmıyordu — `src/engine/Engine.ts`**

Pass'lerin render target'ları her remount/HMR'de GPU'da kalıyordu.
`this.composer.dispose()` eklendi.

### Performans

- **`luminanceHeightMap` — `src/depth.ts`:** canlı kamerada saniyede ~10 kez
  `document.createElement('canvas')` + yeni 2D context açıyordu. Artık modül
  seviyesinde tek çizim yüzeyi yeniden kullanılıyor (boyut değişince resize).
- **`Engine.setDepth`:** her karede yeni `DataTexture` ayırıp eskisini dispose
  ediyordu. Boyut aynıysa artık `image.data.set(...)` + `needsUpdate` ile
  yerinde güncelleniyor. Kamera yolunda GPU tahsis çöpü bitti.

### Render katmanı — Zeynep'in dosyasına tek dokunuş

**`src/shaders/grainPass.ts` başlangıç uniform değerleri.** Değerler slider
aralıklarının uçlarında kalmıştı:

| Uniform | Eskiden | Şimdi | Aralık |
|---|---|---|---|
| `uSaturation` | **0** (tüm renk ölü) | 1 | 0 .. 1.5 |
| `uContrast` | **2** (maks) | 1.05 | 0.5 .. 2 |
| `uVignette` | **1.5** (maks) | 0.45 | 0 .. 1.5 |
| `uGrainAmount` | **0.3** (maks) | 0.06 | 0 .. 0.3 |
| `uGrainSpeed` | 0 | 1 | 0 .. 5 |

Sahne kutudan gri, ezik ve kararmış açılıyordu; point cloud'un derinlik renk
rampası hiç görünmüyordu. Muhtemelen slider denemesinden kalma değerler.

**Bu Zeynep'in estetik kararı.** Kasıtlıysa tek satırla geri alınır — shader
mantığına dokunulmadı, yalnızca `createGrainPass()` içindeki başlangıç
değerleri değişti. Pass'in kendisi (instance başına uniform, `uResolution`'ın
drawing buffer'dan gelmesi, `update(time)` kancası) olduğu gibi duruyor.

### Yeni: sözleşme regresyon kontrolü

```bash
npm run verify
```

İki script çalışır:

- **`scripts/verify-positions.mjs`** (yeni) — GPU gerekmez. `ARCHITECTURE.md`'nin
  sessizce kırılabilen dört kuralını assert'ler: z orijine ortalı, grid satırı
  0 = görselin üstü (y-flip yönü), `w` seed'i doldurma sırasında korunuyor,
  en-boy oranı x genişliğine doğru yansıyor.
- **`scripts/verify-depth.mjs`** — depth modelini Node'da offline çalıştırır.

Shader veya koordinat uzayına dokunan herkes bunu çalıştırsın. y-flip hatası
ekranda "biraz garip" görünür, testte kesin patlar.

### Doküman düzeltmeleri

- `README.md`: `model_fp16.onnx` boyutu 34 MB yazıyordu → ölçülen **47.34 MB**.
- `README.md`: "MIDI/audio ile canlı performans" satırı kaldırıldı — proje
  tanımı ses/müzik girdisi içermiyor, tamamen görsel.
- `ARCHITECTURE.md`: koordinat uzayı bölümü z ortalamasıyla güncellendi.

### Bilinen, düzeltilmedi

Prod build `dist/assets/` içine 23 MB'lık bir ORT wasm kopyası daha koyuyor
(`public/ort` zaten aynı runtime'ı taşıyor). Çalışıyor ama deploy boyutu
şişiyor. Gün 3'teki Vercel deploy testinde bakılacak.

### Doğrulama

`npm run typecheck` ✓ · `npm run build` ✓ · `npm run verify` ✓
(model yükleme 400 ms, 512×512 çıkarım 384 ms, q8 tek thread)
Dev server'da konsol temiz; sentetik görsel 512×512 depth üretip engine'e girdi.
