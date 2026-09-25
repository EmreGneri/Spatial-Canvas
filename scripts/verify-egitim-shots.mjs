import assert from 'node:assert/strict';
import { cekimOzeti } from '../src/engine/reconstruction/egitim3dgs.ts';

// Tek çekim (kesim yok): sessiz kal, gürültü ekleme.
assert.equal(cekimOzeti({
  shots: [{ start: 0, end: 9 }],
  shot: { start: 0, end: 9 },
  analysis: [{ t: 0 }, { t: 10 }],
  frames: [{ t: 0 }, { t: 5 }, { t: 10 }],
}), '');

// shot=null (ör. 'all' stratejisi): hiçbir şey atılmadı, sessiz kal.
assert.equal(cekimOzeti({
  shots: [{ start: 0, end: 4 }, { start: 5, end: 9 }],
  shot: null,
  analysis: [{ t: 0 }, { t: 10 }],
  frames: [{ t: 0 }, { t: 5 }, { t: 10 }],
}), '');

// Birden çok çekim, en uzunu tutuldu: uyar.
const not = cekimOzeti({
  shots: [{ start: 0, end: 4 }, { start: 5, end: 19 }],
  shot: { start: 5, end: 19 },
  analysis: Array.from({ length: 20 }, (_, i) => ({ t: i * 0.5 })),
  frames: Array.from({ length: 12 }, (_, i) => ({ t: 2.5 + i * 0.5 })),
});
assert.match(not, /2 ayrı çekim/);
assert.match(not, /7\.0 sn/); // (19-5)*0.5 = 7.0s
assert.match(not, /12 kare/);
assert.match(not, /diğer 1 çekim atlandı/);

console.log('3DGS çekim (shot) tanı mesajı: OK');
