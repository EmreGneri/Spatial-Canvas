import assert from 'node:assert/strict';
import { bindWheelZoom, boundedZoomFactor } from '../src/ui/egitimControls.ts';

const listeners = new Map();
const canvas = {
  clientHeight: 540,
  addEventListener(type, handler, options) { listeners.set(type, { handler, options }); },
  removeEventListener(type, handler) {
    assert.equal(listeners.get(type)?.handler, handler);
    listeners.delete(type);
  },
};
const factors = [];
const unbind = bindWheelZoom(canvas, (factor) => factors.push(factor));
assert.equal(listeners.get('wheel').options.passive, false);

function wheel(deltaY) {
  let prevented = false;
  listeners.get('wheel').handler({
    deltaY, deltaMode: 0,
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true, 'the page must not scroll while zooming the canvas');
}

wheel(100);
wheel(-100);
assert.ok(factors[0] > 1, 'wheel down moves the camera away');
assert.ok(factors[1] < 1, 'wheel up moves the camera closer');
wheel(0);
assert.equal(factors.length, 2, 'an empty wheel event must not move the camera');
unbind();
assert.equal(listeners.has('wheel'), false, 'listener removed when the view closes');
assert.equal(boundedZoomFactor(1, 10, 0.01), 0.3, 'zoom cannot cross the orbit centre');
assert.equal(boundedZoomFactor(100, 10, 10), 3, 'zoom out stops at a useful scene scale');
console.log('3DGS wheel zoom and scroll isolation: OK');
