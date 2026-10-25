import type { VideoWindowProvider } from './videoPrecompute.ts';
import { vdaOnIsle } from './videoDepthAnything.ts';

// Our pinned Apache-2.0 Small export uses the genuine offline temporal head.
const BASE = '/models/DepthAnything/video-depth-anything-small-offline-154x266/';
export async function openVideoWindowProvider(): Promise<VideoWindowProvider> {
  const ort = await import('onnxruntime-web/webgpu');
  const { gpuSirasinaGir, webgpuKullanilabilir } = await import('../../depth.ts');
  if (!await webgpuKullanilabilir()) throw Error('Offline derinlik WebGPU ister; canlı derinlik kullanılıyor.');
  const dev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
  ort.env.wasm.wasmPaths = dev ? '/node_modules/onnxruntime-web/dist/' : '/ort/';
  ort.env.wasm.numThreads = 1;
  const encoder = await gpuSirasinaGir(() => ort.InferenceSession.create('/models/DepthAnything/video-depth-anything-small-stream-154x266/encoder_fp16.onnx', { executionProviders: ['webgpu'] }));
  let head: typeof encoder;
  try { head = await gpuSirasinaGir(() => ort.InferenceSession.create(BASE + 'offline32_fp16.onnx', { executionProviders: ['webgpu'] })); }
  catch (error) { await encoder.release(); throw error; }
  // Bounded LRU retains overlap/anchor features; each new source frame is encoded once.
  const featureCache = new Map<number, Float32Array[]>();
  return {
    width: 266, height: 154,
    async infer(frames, signal, frameIds) {
      if (frames.length !== 32) throw Error('Offline derinlik 32 kare ister');
      const feeds: Record<string, InstanceType<typeof ort.Tensor>> = {};
      const packed = encoder.outputNames.map(() => new Float32Array(32 * 209 * 384));
      try {
        for (let i = 0; i < 32; i++) {
          signal?.throwIfAborted();
          const key = frameIds?.[i], cached = key === undefined ? undefined : featureCache.get(key);
          if (cached) {
            featureCache.delete(key!); featureCache.set(key!, cached);
            cached.forEach((data, j) => packed[j].set(data, i * data.length));
            continue;
          }
          const input = new ort.Tensor('float32', vdaOnIsle(frames[i], 266, 154), [1, 3, 154, 266]);
          let output: Awaited<ReturnType<typeof encoder.run>> | undefined;
          try {
            output = await gpuSirasinaGir(() => encoder.run({ [encoder.inputNames[0]]: input }));
            signal?.throwIfAborted();
            const stored: Float32Array[] = [];
            encoder.outputNames.forEach((name, j) => {
              const data = output![name].data;
              if (!(data instanceof Float32Array) || data.length !== 209 * 384) throw Error('Offline kodlayıcı uyumsuz');
              packed[j].set(data, i * data.length);
              stored.push(data.slice());
            });
            if (key !== undefined) {
              featureCache.set(key, stored);
              while (featureCache.size > 64) featureCache.delete(featureCache.keys().next().value!);
            }
          } finally { input.dispose(); if (output) Object.values(output).forEach(t => t.dispose()); }
        }
        signal?.throwIfAborted();
        packed.forEach((data, i) => { feeds[head.inputNames[i]] = new ort.Tensor('float32', data, [32, 209, 384]); });
        const output = await gpuSirasinaGir(() => head.run(feeds));
        try {
          const depth = output[head.outputNames[0]].data;
          signal?.throwIfAborted();
          if (!(depth instanceof Float32Array) || depth.length !== 32 * 154 * 266) throw Error('Offline başlık çıktısı uyumsuz');
          return Array.from({ length: 32 }, (_, i) => depth.slice(i * 154 * 266, (i + 1) * 154 * 266));
        } finally { Object.values(output).forEach(t => t.dispose()); }
      } finally { Object.values(feeds).forEach(t => t.dispose()); }
    },
    async dispose() { featureCache.clear(); await head.release(); await encoder.release(); },
  };
}
