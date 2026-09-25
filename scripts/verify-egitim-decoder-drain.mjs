import assert from 'node:assert/strict';
import { runDecoder } from '../src/vendor/splat.js/io/video.js';

// WebCodecs stand-in: a small frame pool, one output per task (like Chromium),
// and flush() resolves only after every queued packet has been output. A frame
// that is never closed keeps its pool slot, so a leaked frame stalls flush().
const POOL = 4;
let live = 0, closed = 0, emitted = 0;
globalThis.VideoDecoder = class {
  #pending = []; #flushes = []; #timer = false; #closedDec = false;
  constructor({ output }) { this.output = output; }
  get decodeQueueSize() { return this.#pending.length; }
  configure() {}
  decode(chunk) { this.#pending.push(chunk); this.#kick(); }
  flush() { return new Promise((r) => { this.#flushes.push(r); this.#kick(); }); }
  close() { this.#closedDec = true; }
  #kick() {
    if (this.#timer || this.#closedDec) return;
    this.#timer = true;
    setTimeout(() => {
      this.#timer = false;
      if (this.#closedDec) return;
      if (this.#pending.length && live < POOL) {
        const c = this.#pending.shift();
        live++; emitted++;
        let open = true;
        this.output({ timestamp: c.timestamp, close: () => { if (open) { open = false; live--; closed++; this.#kick(); } } });
      }
      if (!this.#pending.length) this.#flushes.splice(0).forEach((r) => r());
      else this.#kick();
    }, 0);
  }
};

const PACKETS = 12; // under the 16-deep decode throttle: all queued, stop lands during flush()
const MB = {
  EncodedPacketSink: class {
    async *packets() {
      for (let i = 0; i < PACKETS; i++) yield { toEncodedVideoChunk: () => ({ timestamp: i * 40000 }) };
    }
  },
};
const track = { getDecoderConfig: async () => ({}) };

async function run(stopAfter) {
  live = 0; closed = 0; emitted = 0;
  let seen = 0;
  const onFrame = async () => { seen++; await new Promise((r) => setTimeout(r, 0)); return seen < stopAfter; };
  const t0 = Date.now();
  let timer;
  const hang = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`runDecoder hung (stopAfter=${stopAfter}, emitted ${emitted}, closed ${closed})`)), 2000); });
  try { await Promise.race([runDecoder(MB, track, null, onFrame), hang]); } finally { clearTimeout(timer); }
  return { seen, ms: Date.now() - t0 };
}

// full decode: every frame reaches onFrame and is closed
const full = await run(Infinity);
assert.equal(full.seen, PACKETS);
assert.equal(closed, emitted);
// early stop while flush() still drains: frames after the stop must still be closed
const early = await run(3);
assert.equal(early.seen, 3);
assert.equal(closed, emitted, 'every output frame closed');
console.log(`runDecoder drain after early stop: OK (full ${full.ms} ms, early stop ${early.ms} ms)`);
