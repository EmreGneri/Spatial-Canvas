import assert from 'node:assert/strict';
import { bekcili } from '../src/engine/reconstruction/egitim3dgs.ts';

const controller = new AbortController();
const waiting = bekcili(new Promise(() => {}), () => performance.now(), 90_000, 'SfM', controller.signal);
controller.abort();
await assert.rejects(waiting, (error) => error.name === 'AbortError');

const stalled = bekcili(new Promise(() => {}), () => performance.now() - 200, 50, 'SfM');
await assert.rejects(stalled, /ilerleme yok/);
console.log('3DGS cancellation and progress watchdog: OK');
