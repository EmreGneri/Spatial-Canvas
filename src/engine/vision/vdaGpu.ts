import { advanceVdaHistory, createVdaHistory, selectVdaHistory, VDA_INPUT_HEIGHT, VDA_INPUT_WIDTH, vdaCiktiDogrula, type VdaStream } from './videoDepthAnything.ts';
import type * as Ort from 'onnxruntime-web/webgpu';

/** A free slot is chosen before the official history is advanced, so anchors survive. */
export function createVdaGpuSlots(context: 16 | 32 = 32) {
  let history = createVdaHistory<number>();
  return {
    selected: () => history.frames.length ? selectVdaHistory(history, context) : [],
    next: () => { const used = new Set(history.frames); for (let slot = 0; slot < 43; slot++) if (!used.has(slot)) return slot; throw Error('VDA GPU history is full'); },
    commit: (slot: number) => advanceVdaHistory(history, slot, context),
    frames: () => history.frameId + 1,
    reset: () => { history = createVdaHistory(); },
  };
}

export function vdaGpuOptions(search: string) {
  const query = new URLSearchParams(search);
  const enabled = query.get('vdaGpu') === '1' || (query.get('videoDerinlik') === 'vda' && query.get('vdaGpu') !== '0');
  return { enabled, capture: enabled && query.get('vdaCapture') === '1' };
}
export function vdaContext(search: string): 16 | 32 { return new URLSearchParams(search).get('vdaContext') === '16' ? 16 : 32; }

const CACHE = [[209, 192], [209, 192], [60, 384], [60, 384], [209, 64], [209, 64], [836, 64], [836, 64]];
const GPU_STORAGE = 128, GPU_COPY_SRC = 4, GPU_COPY_DST = 8, GPU_MAP_READ = 1;

/** Cache never crosses CPU: frame slots -> WGSL gather -> fixed attention input. */
export async function openVdaGpuStream(ort: typeof Ort, base: string, capture: boolean,
  serialize: <T>(task: () => Promise<T>) => Promise<T>, context: 16 | 32 = 32): Promise<VdaStream & { dispose(): Promise<void> }> {
  const sessions: Ort.InferenceSession[] = [], buffers: GPUBuffer[] = [], tensors: Ort.Tensor[] = [];
  const slots = createVdaGpuSlots(context);
  let epoch = 0;
  const cacheFrames = context - 1;
  const dispose = () => serialize(async () => {
    for (const tensor of tensors) tensor.dispose();
    for (const buffer of buffers) buffer.destroy();
    for (const session of sessions) { try { await session.release(); } catch { /* Preserve the original inference/device error. */ } }
  });
  try {
    const open = async (name: string) => {
      const session = await serialize(() => ort.InferenceSession.create(base + name + '_fp16.onnx', {
        executionProviders: ['webgpu'], preferredOutputLocation: 'gpu-buffer', enableGraphCapture: capture && name === 'stream',
      }));
      sessions.push(session); return session;
    };
    const encoder = await open('encoder'), bootstrap = await open('bootstrap'), stream = await open('stream');
    // Read the device after backend initialization; an early getter can create a second device.
    const device = await ort.env.webgpu.device as GPUDevice;
    const buffer = (size: number) => {
      const value = device.createBuffer({ size, usage: GPU_STORAGE | GPU_COPY_SRC | GPU_COPY_DST });
      buffers.push(value); return value;
    };
    const tensor = (dims: number[]) => {
      const gpu = buffer(dims.reduce((a, b) => a * b, 4));
      const value = ort.Tensor.fromGpuBuffer(gpu, { dataType: 'float32', dims });
      tensors.push(value); return { gpu, value };
    };
    const pixels = tensor([1, 3, VDA_INPUT_HEIGHT, VDA_INPUT_WIDTH]);
    const features = Object.fromEntries([1, 2, 3, 4].map(i => [`feat${i}`, tensor([1, 209, 384]).value]));
    const depth = tensor([1, 1, VDA_INPUT_HEIGHT, VDA_INPUT_WIDTH]);
    const readback = device.createBuffer({ size: VDA_INPUT_HEIGHT * VDA_INPUT_WIDTH * 4, usage: GPU_MAP_READ | GPU_COPY_DST });
    buffers.push(readback);
    const indices = buffer(cacheFrames * 4);
    const caches = CACHE.map(([spatial, channels]) => {
      const count = spatial * channels, history = buffer(43 * count * 4);
      const packed = tensor([spatial, cacheFrames, channels]), output = tensor([spatial, 1, channels]);
      const code = `@group(0) @binding(0) var<storage, read> history: array<f32>;
@group(0) @binding(1) var<storage, read> slots: array<u32>;
@group(0) @binding(2) var<storage, read_write> packed: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
 let i = id.x; if (i >= ${spatial * cacheFrames * channels}u) { return; }
 let channel = i % ${channels}u; let time = (i / ${channels}u) % ${cacheFrames}u; let pixel = i / ${channels * cacheFrames}u;
 packed[i] = history[slots[time] * ${count}u + pixel * ${channels}u + channel]; }`;
      const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
      const binding = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [history, indices, packed.gpu].map((gpu, binding) => ({ binding, resource: { buffer: gpu } })) });
      return { count, history, packed, output, pipeline, binding };
    });
    return {
      frames: slots.frames,
      reset() { epoch++; slots.reset(); },
      dispose,
      async infer(input) {
        if (input.length !== 3 * VDA_INPUT_WIDTH * VDA_INPUT_HEIGHT) throw Error('Invalid VDA input shape');
        const startedEpoch = epoch;
        // The global ORT queue must include our copies and gather, not just session.run.
        return serialize(async () => {
          const first = slots.frames() === 0, slot = slots.next();
          device.queue.writeBuffer(pixels.gpu, 0, input);
          await encoder.run({ pixels: pixels.value }, features);
          const feeds = { ...features };
          if (!first) {
            device.queue.writeBuffer(indices, 0, Uint32Array.from(slots.selected()));
            const command = device.createCommandEncoder(), pass = command.beginComputePass();
            caches.forEach((cache, i) => {
              pass.setPipeline(cache.pipeline); pass.setBindGroup(0, cache.binding);
              pass.dispatchWorkgroups(Math.ceil(cache.count * cacheFrames / 256)); feeds[`cache${i}`] = cache.packed.value;
            });
            pass.end(); device.queue.submit([command.finish()]);
          }
          const output = { depth: depth.value, ...Object.fromEntries(caches.map((cache, i) => [`${first ? 'cache' : 'nextCache'}${i}`, cache.output.value])) };
          await (first ? bootstrap : stream).run(feeds, output);
          const command = device.createCommandEncoder();
          caches.forEach(cache => command.copyBufferToBuffer(cache.output.gpu, 0, cache.history, slot * cache.count * 4, cache.count * 4));
          command.copyBufferToBuffer(depth.gpu, 0, readback, 0, VDA_INPUT_HEIGHT * VDA_INPUT_WIDTH * 4);
          device.queue.submit([command.finish()]);
          await readback.mapAsync(GPU_MAP_READ);
          const result = new Float32Array(readback.getMappedRange().slice(0));
          readback.unmap();
          vdaCiktiDogrula(result);
          if (epoch === startedEpoch) slots.commit(slot);
          return result;
        });
      },
    };
  } catch (error) { await dispose(); throw error; }
}


