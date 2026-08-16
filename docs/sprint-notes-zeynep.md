# Sprint Keşif Notları — Zeynep (render şeridi)

Tarih: 2026-08-16 · Dal: `feat/splat-render` · Gün 1 (Z1.1)

Bu dosya PLANIN VARSAYIMLARINI kodun gerçeğiyle karşılaştırır. Plan
varsayımlara dayanıyordu; aşağıda uyuşmayanlar **⚠ SAPMA** ile işaretli.

---

## 1. Sözleşmeler

### `registerRenderMode`
```ts
registerRenderMode(name: string, material: THREE.Material, params: ParamDef[])
```
Kayıt `Map<string, { material, params }>`. Kayıt sırasında aktif material ile
eşleşiyorsa `renderModeName` da güncellenir.

### `ParamDef` (gerçek alanlar)
```ts
interface ParamDef {
  key: string;      // uniform adı
  label: string;    // UI etiketi
  min?: number; max?: number;
  default: number;
  kind?: 'number' | 'color';
}
```
**⚠ SAPMA:** planda `step` alanı geçiyordu — **YOK**. Slider adımı
ControlPanel'de min/max'tan türetiliyor. Yeni knob eklerken `step` yazmayın.

### Preset durum grubu
`renderPreset.ts` içinde mod başına bir `interface XState` + `RenderState`
altında opsiyonel alan + `serializeRenderState` içinde bir blok +
`applyRenderState` içinde bir blok. **Dört yer birden** güncellenmeli; biri
unutulursa knob sessizce düşer (bu yüzden `verify-crystal-params` dördünü de
denetliyor).

---

## 2. Material'lara hazır gelen uniform'lar

| Uniform | Kim yazar | Not |
|---|---|---|
| `uPositions` | Engine, her kare | Sim ping-pong RT'si (kimliği değişir — material tutmamalı) |
| `uImageTexture` | Engine (`pushSharedUniforms`) | Foto grid'i **veya** canlı `VideoTexture` |
| `uHasImage` | Engine | 0 = derinlik rampasına düş |
| `uObjectSeparation`, `uUseTextureColor` | Engine | Ortak render kolları |
| `uFogDensity`, `uFogColor` | Engine (`pushLookUniforms`) | Gün A global look köprüsü |
| `uSplatA/B/C`, `uSplatGrid` | Engine (`SplatObject.bindTextures`) | D.1 GaussianBuffer |
| `uTime` | **Engine, `tickPasses` (Gün 1'de eklendi)** | Aşağıya bak |

**Depth texture doğrudan material'a BAĞLANMIYOR.** Gün C kararı: türetilmiş
veri konum texture'ından okunur, depth'ten değil (`uDepth`/`setDepthTexture`
kaldırılmış). Crystal'ın "depth türevi" normal kolu bu yüzden depth
texture'ından değil, **görüş-uzayı pozisyonunun `dFdx/dFdy`'sinden** çalışıyor.

---

## 3. Normal kaynakları — ikisi de BUGÜN mevcut

| Yol | Kaynak | Shader'a nasıl ulaşır |
|---|---|---|
| solid kabuk mesh | `ShellMeshData.normals` | `normal` attribute'u (Engine `setShellGeometry`'de `BufferAttribute` olarak koyar) |
| splat | `GaussianBufferData.b.xyz` | `uSplatB` texture'ının xyz'si |

**Sonuç:** crystal'ın normal ihtiyacı için Emre'yi BEKLEMİYORUZ. Onun Gün 4
işi (alan-ağırlıklı mesh normali, per-splat normal) bu alanların **kalitesini**
artıracak; alan adları ve şekli değişmiyor.

---

## 4. KRİTİK SORU: sahne rengi RT'de mi? → **EVET**

Sahne `EffectComposer` üzerinden çiziliyor (`renderTarget1`/`renderTarget2`
ping-pong), doğrudan ekrana değil. `composer.readBuffer` / `writeBuffer`
erişilebilir.

**AMA bir tuzak var:** crystal `RenderPass` sırasında çiziliyor, yani o an
composer'ın **write** buffer'ına yazıyor. Aynı buffer'ı okumak geri besleme
döngüsüdür (tanımsız davranış, sürücüye göre siyah/çöp).

**Karar:** `uSceneColor` ← `composer.readBuffer.texture`, yani **bir önceki
karenin** çıktısı. Kırılma için bir kare gecikme görünmez; ekstra sahne geçişi
ya da yeni RT gerekmez. Gün 5 planı bu temelde yürüyecek — fallback'e
(uImageTexture'ı kaydırarak örnekleme) gerek KALMADI.

---

## 5. Doğrulanan iki hata (Z1.2)

1. **Grain dispose bayrağı tersti.** Eski kod: `if (composer.passes.indexOf(grainPass) === -1) grainPass.dispose();`
   → grain yalnızca zincirde DEĞİLKEN bırakılıyordu. three.js kaynağı
   incelendi: `EffectComposer.dispose()` yalnızca `renderTarget1`,
   `renderTarget2` ve `copyPass`'i bırakır, **`this.passes`'e hiç dokunmaz**.
   Yani normal durumda grain'in RT'si her remount'ta sızıyordu. Düzeltme:
   koşulsuz `this.grainPass.dispose()`. (`verify-engine-dispose` three.js'in
   bu davranışını da kilitliyor — kütüphane değişirse test uyarır.)

2. **Neon kendi `requestAnimationFrame`'ini sürüyordu.** Mod kapalıyken bile
   tikliyor, Engine saatinden ayrı ikinci bir zaman kaynağı oluşturuyordu.
   Kaldırıldı; `uTime` artık `Engine.tickPasses` içinde **tüm kayıtlı
   modlara** yazılıyor (crystal da bundan besleniyor).

---

## 6. `npm run verify` taban çizgisi

**⚠ SAPMA:** plan "18 script" diyordu (bir önceki sayım), Emre
`verify-render-preset.mjs` ekleyince **19** oldu. Gün 1–2'de ikisi daha
eklendi → **21 script**, tümü yeşil.

| Gün | Eklenen |
|---|---|
| G1 | `verify-engine-dispose.mjs` |
| G2 | `verify-crystal-params.mjs` |

Benim sahiplendiğim script'ler: `verify-splat`, `verify-engine-dispose`,
`verify-crystal-params` (+ G4/G6'da `verify-splat-alpha`,
`verify-crystal-preset`, `verify-capture-verdict`). Emre'nin script'lerine
dokunmuyorum — çakışma yüzeyi sıfır.

---

## 7. Gün 2 ölçümü: faset knob'unun gerçek aralığı

`uFacetScale` ilk hâlinde 1–64 / varsayılan 12 idi. Tarayıcıda `gl.readPixels`
ile ölçüldü (taban: scale = 64, değişen piksel sayısı):

| scale | 1 | 2 | 4 | 8 | 12 | 24 |
|---|---|---|---|---|---|---|
| değişen piksel | 1008 | **8353** | 5704 | 4402 | 3675 | 2462 |

Etki **2–24** bandında; 24 üstü ihmal edilebilir. `scale = 1` erken çıkışla
faseti KAPATIYOR (1008 fark, taban da neredeyse düz olduğu için). Slider'ın
yarısı ölü aralıktı → **max 64 → 32, varsayılan 12 → 6** (mod açılışında faset
görünür olsun).

**Not — ölçüm yöntemi tuzağı:** ilk denemede ortalama parlaklıkla ölçtüm ve
`delta = 0` çıktı; faset ışığı yeniden dağıtıyor, TOPLAMI değiştirmiyor.
Ortalama parlaklık bu knob için geçersiz bir prob. Piksel farkı doğru olanı.

---

## 8. Gün 2 durumu (crystal)

- `crystalMaterial.ts` + 11 ParamDef + `crystal` preset grubu (4 yerin dördü)
- `registerRenderMode('crystal', …)`; **solid ile aynı kabuk mesh yolunu**
  kullanıyor (`Engine.usesShellMesh` → `'solid' | 'crystal'`), foto-only
  fallback deseni aynen geçerli
- ControlPanel crystal seçilince ParamDef'lerden slider üretiyor
- Tarayıcı doğrulaması: mod geçişi çalışıyor, **GL hatası yok**, kaplama
  %51.9 (solid %53.2); knob etkileri ölçüldü — fresnel +1.03, speküler +2.39,
  yoğunluk −4.91 ortalama parlaklık (hepsi beklenen yönde)
- `uSceneColor` bağlı (önceki kare) — Gün 5 kırılması için hazır, fragment
  henüz kullanmıyor
