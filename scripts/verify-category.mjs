import assert from 'node:assert/strict';
import { classifyCategory, measureCategoryEdges } from '../src/ui/category.ts';

const blank = { data: new Uint8ClampedArray(64 * 64 * 4), width: 64, height: 64 };
assert.equal(classifyCategory({ frame: blank }).kategori, 'bilinmiyor');
assert.equal(classifyCategory({ frame: blank, faceDetected: true }).kategori, 'portre/selfie');
assert.equal(classifyCategory({ faceDetected: false }).kategori, 'bilinmiyor');
const grid = { ...blank, data: Uint8ClampedArray.from(blank.data) };
for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
  const value = x % 16 < 8 && y % 16 < 8 ? 255 : 0;
  grid.data.set([value, value, value, 255], 4 * (y * 64 + x));
}
const edges = measureCategoryEdges(grid);
assert.ok(edges.axisRatio > 0.7 && edges.density > 0.1);
assert.equal(classifyCategory({ frame: grid, faceDetected: false }).kategori, 'mimari');
assert.equal(classifyCategory({ frame: grid, faceDetected: true }).kategori, 'portre/selfie');
const diagonal = { ...blank, data: Uint8ClampedArray.from(blank.data) };
for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
  const v = (x + y) % 16 < 8 ? 255 : 0;
  diagonal.data.set([v, v, v, 255], 4 * (y * 64 + x));
}
assert.equal(classifyCategory({ frame: diagonal, faceDetected: false }).kategori, 'doğa/sahne');
assert.equal(classifyCategory({ frame: diagonal }).kategori, 'bilinmiyor', 'missing face evidence is not a negative detection');
for (const input of [{}, { frame: blank }, { frame: grid, faceDetected: true }]) {
  const result = classifyCategory(input);
  assert.ok(Number.isFinite(result.guven) && result.guven >= 0 && result.guven <= 1);
  assert.equal(result.sinyaller.guvenTuru, 'heuristic-not-calibrated');
}
assert.throws(() => measureCategoryEdges({ ...blank, width: 100 }), /frame/);
console.log('PASS category: face precedence, Sobel axes, scene evidence, abstention, bounds');
