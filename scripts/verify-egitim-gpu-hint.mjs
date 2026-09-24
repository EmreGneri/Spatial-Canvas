import assert from 'node:assert/strict';
import { egitimGpuHint } from '../src/ui/egitimGpuHint.ts';

assert.equal(egitimGpuHint('amd / rdna3', false, 'Windows NT 10.0'), null);
assert.equal(egitimGpuHint('? / ?', false, 'Windows NT 10.0'), null);

const windowsHint = egitimGpuHint('Intel / gen-12lp', true, 'Windows NT 10.0');
assert.match(windowsHint, /Intel \/ gen-12lp/);
assert.match(windowsHint, /Ayarlar.*Grafik.*Yüksek performans/s);
assert.match(windowsHint, /tarayıcıyı tamamen kapatıp yeniden aç/s);

const linuxHint = egitimGpuHint('intel / gen-12lp', true, 'X11; Linux x86_64');
assert.ok(linuxHint);
assert.doesNotMatch(linuxHint, /Windows Ayarlar/);

console.log('3DGS integrated GPU guidance: OK');
