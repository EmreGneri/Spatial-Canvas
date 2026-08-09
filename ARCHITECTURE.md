# spatial-canvas · Mimari Sözleşmesi

v0.1 — Gün 1. İki katmanın birbirine güvenli bağlanabilmesi için yazıldı.
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

## Koordinat Uzayı

- Sahne: unit ortho kamera, tam ekran quad. UV uzayı 0..1.
- Şimdilik dünya birimi yok; Gün 2 point cloud'da depth → z dönüşümü engine'de yapılır.

## Pass Zinciri (Render Katmanı)

Sahip: **Zeynep**. Sıra ve composer `src/engine/pipeline.ts`'ten yönetilir.

```
RenderPass (sahne) → Grain/Vignette → [Zeynep: Feedback → Chromatic Aberration → Neon Wireframe] → Output
```

- Gün 1'deki grain/vignette seam'dir: zincirin çalıştığını kanıtlar, Zeynep genişletir.
- Composer hedefi half-float; parçacık pass'leri (Gün 3) full float gerektirirse
  `EffectComposer` render target'ı güncellenir — bu da Zeynep'in kararı.

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
