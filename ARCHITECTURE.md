# spatial-canvas · Mimari Sözleşmesi

v0.3 — Gün 3. Değişiklikler: GPGPU parçacık simülasyonu — `positionTexture` artık
ping-pong render target texture'ı, `homeTexture` eklendi (dinlenme konumu).
İki katmanın birbirine güvenli bağlanabilmesi için yazıldı.
Değişiklik tartışılır, yazılır, imzalanır. Sessiz sapma yok.

## Katman Bölüşümü

| Katman | Sahip | Klasör |
|---|---|---|
| Veri katmanı: depth, GPGPU parçacık sistemi, node graph, preset serileştirme, export | Emre | `src/engine/` |
| Render katmanı: tüm GLSL shader'lar, pass zinciri, 3 render modu | Zeynep | `src/shaders/`, `src/ui/` |
| Ortak sözleşme | ikisi birlikte | `ARCHITECTURE.md` |

## Texture Sözleşmesi

| Texture | Format | Boyut | İçerik |
|---|---|---|---|
| `depthTexture` | R32F, tek kanal | görsel çözünürlüğü | 0 = uzak, 1 = yakın |
| `positionTexture` | RGBA32F veya RGBA16F | 384×384 (147.456 parçacık) | xyz = konum (**simülasyon her karede yazar**), w = seed (0..1) |
| `homeTexture` | RGBA32F | 384×384 | xyz = dinlenme konumu (CPU: depth'ten bir kez), w = seed (0..1) |

- **y-flip tek yerde çözülür:** texture upload'u (`src/engine/buffers.ts`, `flipY = true`).
  Sonuç: `v = 1` → görselin **üstü**. Shader'larda, UV'lerde, CPU'da flip **yoktur**.
- Normalize etmek veri katmanının işi: Zeynep ham veri beklemez, hep 0..1 alır.
- `depthTexture` ve `homeTexture` `NearestFilter`. `positionTexture` (RT) de
  `NearestFilter` — parçacık aramaları birebir örneklenir.
- Engine exposes textures to renderers: `engine.positionTexture` (Gün 3'ten beri
  simülasyonun RT texture'ı — **THREE.Texture, DataTexture değil**) ve
  `engine.depthTexture`; ikincisi depth hesaplanana dek `null`.

## Koordinat Uzayı (Gün 2)

- Kamera: perspektif (60°), konum (0, 0, 3.5), hedef orijin. OrbitControls
  (damping açık) kamerayı yönetir — sahiplik Emre.
- Point cloud dünyası: yükseklik 2 birim (`POINTS_WORLD_HEIGHT`), genişlik
  `2 · aspect` (depth kaynağının oranından), `z = (d − 0.5) · 2`
  (`POINTS_DEPTH_RANGE`): d = 0 (uzak) → z = −1, d = 1 (yakın) → z = +1.
  **z orijin etrafında ortalıdır** — OrbitControls hedefi (0,0,0) bulutun
  merkezine denk gelsin diye; ortalanmazsa yörünge bulutun arka yüzeyi
  etrafında döner. Renk rampası için shader `z / 2 + 0.5` ile 0..1'e döner.
- Depth → konum dönüşümü **yalnızca `src/engine/buffers.ts`**
  (`fillPositionsFromDepth`). Shader'larda, UV'lerde, CPU'da yeniden çevrim yok.
- y-flip hâlâ tek yerde: texture upload'u (flipY = true, v = 1 → üst).

## Point Cloud Sözleşmesi (Gün 2)

- **Vertex konumları CPU dizisinden DEĞİL, `uPositions` texture'ından shader'da
  okunur** (`src/engine/points.ts`). Geometri yalnızca `aUv` grid'i taşır
  (u = (i+0.5)/N, v = 1-(j+0.5)/N); position attribute boştur, frustum culling
  kapalıdır.
- Engine'deki material yer tutucudur; render modları (Zeynep) kendi point cloud
  shader'ını `engine.setPointsMaterial(material)` ile takar. Material uniform
  sözleşmesi: `uPositions` her shader'da zorunlu — **tip THREE.Texture** (RT
  texture'ı). Engine, ping-pong nedeniyle okunan texture her karede değiştiği
  için `uPositions`'ı her karede günceller; material buna dokunmaz.
- Texture'lara erişim: `engine.positionTexture`, `engine.depthTexture`
  (depth hesaplanana dek `null`).

## GPGPU Simülasyon (Gün 3 — Emre)

Sahne: tam ekran quad + ortho kamera, ana sahneden ayrı (`src/engine/simulation.ts`).

- **Hızın yeri — karar:** Verlet (konum + önceki konum) tek texture'da
  imkânsız: `w` = seed (sözleşme) + konum (3) + önceki konum (3) = 7 kanal >
  RGBA'nın 4'ü. **Hız ping-pong çifti** kullanıldı (4 RT: konum ×2 + hız ×2) —
  Verlet'le aynı bellek, tek kuvvet ifadesi, iki ayrı pass (pos, vel).
- **Format:** `EXT_color_buffer_float` varsa RGBA32F, yoksa RGBA16F (yarım
  hassasiyet bu sahne için yeterli). Tespit Engine'de, log satırında.
- **Tohumlama:** depth geldiğinde `homeTexture` bir kez her iki konum RT'sine
  kopyalanır (`seedFrom`) — ilk karede parçacıklar orijinden patlamaz.
- **Kuvvet:** `yay(home − konum) + fare`. Ölü bölge: home'a `uRestLength`'ten
  yakınken yay kuvveti sıfır (titreme yok).
- **Fare:** hover'da sürekli kuvvet; sol tık OrbitControls'ta kalır. Canvas
  dışında kuvvet sıfır. Ekran konumu → z = 0 düzlemine izdüşüm (kamera
  dönmüşse de doğru — orbit'e dayanıklı).
- **w (seed) korunur:** sim pos pass'i `cur.w`'yi kopyalar.

| Uniform | Anlam | Varsayılan |
|---|---|---|
| `uStiffness` | yay katsayısı | 0.035 |
| `uDamping` | sönüm (0..1) | 0.96 |
| `uRestLength` | ölü bölge yarıçapı | 0.005 |
| `uForceMode` | 0 = itme, 1 = çekim, 2 = vortex | 0 |
| `uForceRadius` | fare kuvvet alanı yarıçapı | 1.0 |
| `uForceStrength` | fare kuvvet şiddeti | 0.08 |
| `uMouseWorld` | fare, dünya koordinatı (z=0 düzlemi) | — |
| `uMouseActive` | canvas içi/ dışı | 0 |

Simülasyon uniform'ları `engine.simUniforms` ile okunur (UI Gün 4).

## Pass Zinciri (Render Katmanı)

Sahip: **Zeynep**. Sıra ve composer Engine'de (`src/engine/Engine.ts`).

```
RenderPass (point cloud sahnesi) → Grain/Vignette → [Zeynep: Feedback → Chromatic Aberration → Neon Wireframe] → Output
```

- Gün 1'deki grain/vignette seam'dir: zincirin çalıştığını kanıtlar, Zeynep genişletir.
- **Pass kancası:** Engine pass içlerine (uniform isimleri) doğrudan yazmaz. Her
  pass opsiyonel `update(time)` yöntemi sunar (`TickablePass`), Engine her
  karede çağırır. Yeni pass'ler (Feedback, ChroAber, Neon) aynı kancayı kullanır.
- Composer hedefi half-float; parçacık pass'leri (Gün 3) full float gerektirirse
  `EffectComposer` render target'ı güncellenir — bu da Zeynep'in kararı.

## Kamera / Video Yolu (Gün 2)

- Gün 1 kararı gereği: statik görsel → Depth-Anything-Small (model); video dosyası
  ve canlı kamera → depth modeli **YOK**, luminance height map
  (`src/depth.ts` → `luminanceHeightMap`): parlaklık = yükseklik, parlak = yakın.
- Çıktı aynı `DepthResult` sözleşmesi: 0..1, satır 0 = üst. Engine'de mode
  ayrımı yok — tek `setDepth` girişi.

## Preset Şeması (taslak, Gün 4'te dolar)

```json
{
  "version": 1,
  "name": "preset adı",
  "nodes": [
    { "type": "media",     "params": {} },
    { "type": "depth",     "params": {} },
    { "type": "particles", "params": {} },
    { "type": "feedback",  "params": {} },
    { "type": "renderer",  "params": {} },
    { "type": "output",    "params": {} }
  ]
}
```

Serileştirme `src/engine/` altında (Emre), parametre spec'leri render moduyla
birlikte (Zeynep).

## Model ve Runtime

- Depth modeli + ORT wasm: `public/` içinde, CDN yok. `npm run fetch:assets` ile yeniden üretilir.
- `numThreads = 1` (COOP/COEP gerekmez). WebGPU yolu `model_fp16.onnx` + jsep build.
- Yükleme/çıkarım süreleri her kurulumda ölçülür (`console.time` → log).

## Her Gün, Unutma

1. Sabah 15 dk senkron: dün bitti / bugün var / tıkanan.
2. Öğle + akşam 1'er dakika ekran kaydı — çirkin halleri de kaydedin, geriye dönük üretilmez.
3. Akşam 30 dk ortak entegrasyon: o günün shader'ı gerçek motorda. Sandbox'ta kalan shader "bitmedi" sayılır.
