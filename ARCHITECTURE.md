# spatial-canvas · Mimari Sözleşmesi

v0.2 — Gün 2. Değişiklikler: point cloud + kamera (perspektif kamera, pass `update(time)`
kancası, luminance yolu). İki katmanın birbirine güvenli bağlanabilmesi için yazıldı.
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
| `positionTexture` | RGBA32F | 384×384 (147.456 parçacık) | xyz = konum, w = seed (0..1) |

- **y-flip tek yerde çözülür:** texture upload'u (`src/engine/buffers.ts`, `flipY = true`).
  Sonuç: `v = 1` → görselin **üstü**. Shader'larda, UV'lerde, CPU'da flip **yoktur**.
- Normalize etmek veri katmanının işi: Zeynep ham veri beklemez, hep 0..1 alır.
- Hem `depthTexture` hem `positionTexture` `NearestFilter` (parçacık aramaları birebir örneklenir).
- Engine exposes both textures to renderers: `engine.positionTexture` and
  `engine.depthTexture`; the latter is `null` until depth has been computed.

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
  kapalıdır. Gün 3 GPGPU bu texture'ı her karede üzerine yazar.
- Engine'deki material yer tutucudur; render modları (Zeynep) kendi point cloud
  shader'ını `engine.setPointsMaterial(material)` ile takar. Material uniform
  sözleşmesi: `uPositions` (positionTexture) her shader'da zorunlu.
- Texture'lara erişim: `engine.positionTexture`, `engine.depthTexture`
  (depth hesaplanana dek `null`).

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
