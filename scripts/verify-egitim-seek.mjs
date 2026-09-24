import assert from 'node:assert/strict';
import { seekTo } from '../src/vendor/splat.js/io/video.js';

class VideoStub extends EventTarget {
  readyState = 2;
  #time = 0;
  get currentTime() { return this.#time; }
  set currentTime(value) {
    if (value === this.#time) return;
    this.#time = value;
    queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
  }
}

const video = new VideoStub();
await seekTo(video, 0); // Assigning the current time emits no seeked event.
await seekTo(video, 0.1);
assert.equal(video.currentTime, 0.1);
console.log('3DGS element fallback seeking: OK');
