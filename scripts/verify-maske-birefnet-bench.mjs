// BiRefNet reddedildiğinde fotoğrafın IS-Net yedeği ölçümden düşmemeli.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Yalnız pahalı model sınırları sahte; ölçüm ve rapor toplama gerçek kod.
const segmentation = `export async function segmentForeground() {
  return { mask: new Float32Array(16), width: 4, height: 4, model: 'isnet' };
}`;
const depth = `export async function estimateDepth() {
  return { data: new Float32Array(16).fill(0.5), width: 4, height: 4 };
}`;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/src/bench/maskeSayfasi.ts')) {
      const stub = specifier.endsWith('/segmentation.ts') ? segmentation
        : specifier === '../depth.ts' ? depth : null;
      if (stub) return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

globalThis.window = {};
globalThis.Image = class {
  naturalWidth = 4;
  naturalHeight = 4;
  set src(_) { queueMicrotask(() => this.onload()); }
};
globalThis.document = {
  createElement() {
    return {
      width: 4, height: 4,
      getContext() {
        return {
          drawImage() {},
          getImageData() {
            const data = new Uint8ClampedArray(64);
            for (const i of [5, 6, 9, 10]) data[i * 4] = 255;
            return { width: 4, height: 4, data };
          },
        };
      },
    };
  },
};

const { maskeCalistir } = await import('../src/bench/maskeSayfasi.ts');
const { rapor } = await maskeCalistir({
  diziler: [{ ad: 'fallback', kareler: [{ jpgUrl: 'image', gtUrl: 'gt' }] }],
  yardimci: true,
});
assert.equal(rapor.hataSayisi, 0);
assert.equal(rapor.cKullanilamayanKare, 1, 'IS-Net yedeği ayrıca sayılmalı');
assert.equal(rapor.global.C?.kare, 1, 'fotoğraf yedeği C kalite ortalamasından atılmamalı');
assert.equal(rapor.global.C.J, 0, 'yanlış boş maske skora sıfır olarak katılmalı');
assert.equal(rapor.global.C.F, 0);
console.log('OK BiRefNet benchmark: IS-Net yedek karesi kalite ortalamasında');
