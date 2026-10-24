import * as THREE from 'three';
import { createPointCloudMaterial } from '../shaders/pointCloudMaterial';
import { POINT_COUNTS, pointTextureSize, summarizeFrames, classifyAdapter } from './pointCountStats';

const WIDTH = 960, HEIGHT = 540;
const status = document.querySelector<HTMLElement>('#status')!;
const runButton = document.querySelector<HTMLButtonElement>('#run')!;
const download = document.querySelector<HTMLButtonElement>('#download')!;
const rows = document.querySelector<HTMLTableSectionElement>('#results')!;
let report: unknown;
let running = false;
const nextFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));

function makeCloud(count: number) {
  const [width, height] = pointTextureSize(count);
  const data = new Float32Array(count * 4), uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const u = (i % width + 0.5) / width, v = (Math.floor(i / width) + 0.5) / height;
    data.set([(u - 0.5) * 3.4, (v - 0.5) * 2, 0.35 * Math.sin(u * 10) * Math.cos(v * 8), 1], i * 4);
    uv.set([u, v], i * 2);
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
  const material = createPointCloudMaterial();
  material.uniforms.uPositions.value = texture;
  const cloud = new THREE.Points(geometry, material);
  cloud.frustumCulled = false;
  return { cloud, dispose() { geometry.dispose(); material.dispose(); texture.dispose(); } };
}

export async function runPointCountBenchmark(preference: WebGLPowerPreference = 'high-performance') {
  if (running) throw new Error('A benchmark is already running.');
  running = true; runButton.disabled = true; download.disabled = true;
  let renderer: THREE.WebGLRenderer | undefined;
  rows.replaceChildren();
  try {
    if (document.visibilityState !== 'visible') throw new Error('Keep the benchmark tab visible.');
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: preference });
    renderer.setPixelRatio(1); renderer.setSize(WIDTH, HEIGHT);
    document.querySelector('#viewport')!.replaceChildren(renderer.domElement);
    const gl = renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const identity = String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const adapter = classifyAdapter(identity);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 100);
    const results = [];
    for (const count of POINT_COUNTS) {
      status.textContent = `${identity} — ${count.toLocaleString()} points: warming up`;
      const fixture = makeCloud(count); scene.add(fixture.cloud);
      try {
        const samples: number[] = [];
        let previous = await nextFrame();
        const start = previous;
        while (true) {
          const now = await nextFrame();
          if (document.visibilityState !== 'visible') throw new Error('Tab was hidden; discard this run and run again.');
          if (gl.isContextLost()) throw new Error('WebGL context lost; close other GPU workloads and retry.');
          camera.position.set(0.4 * Math.sin(now / 1800), 0.2 * Math.cos(now / 2100), 3.5);
          camera.lookAt(0, 0, 0);
          renderer.render(scene, camera);
          if (renderer.info.render.points !== count) throw new Error('Rendered point count differs from the requested fixture.');
          if (now - start >= 1500) { samples.push(now - previous); status.textContent = `${identity} — ${count.toLocaleString()} points: measuring`; }
          previous = now;
          if (now - start >= 6500) break;
        }
        const result = { points: count, texture: pointTextureSize(count), ...summarizeFrames(samples) };
        results.push(result);
        const row = rows.insertRow();
        for (const value of [count.toLocaleString(), result.fps.toFixed(1), result.frameMsP50.toFixed(2), result.frameMsP95.toFixed(2)]) row.insertCell().textContent = value;
      } finally { scene.remove(fixture.cloud); fixture.dispose(); }
    }
    const requestedAdapter = preference === 'low-power' ? 'intel' : 'rtx';
    report = { createdAt: new Date().toISOString(), requestedPreference: preference, requestedAdapter, adapter, renderer: identity,
      requestedAdapterAvailable: adapter === requestedAdapter, hardwareVerified: adapter === 'intel' || adapter === 'rtx',
      viewport: [WIDTH, HEIGHT], dpr: 1, warmupMs: 1500, sampleMs: 5000, userAgent: navigator.userAgent,
      scope: 'Production point cloud shader; synthetic texture; moving camera; excludes simulation, inference and post-processing; RAF display pacing included.', results };
    document.querySelector('#report')!.textContent = JSON.stringify(report, null, 2);
    status.textContent = adapter === requestedAdapter ? `Complete — ${identity}` : `Complete — requested ${requestedAdapter} unavailable; actual adapter: ${identity}`;
    download.disabled = false;
    return report;
  } finally { renderer?.dispose(); running = false; runButton.disabled = false; }
}

runButton.onclick = () => { void runPointCountBenchmark(document.querySelector<HTMLSelectElement>('#power')!.value as WebGLPowerPreference).catch(error => { status.textContent = String(error); }); };
download.onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'point-count-benchmark.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
Object.assign(window, { runPointCountBenchmark });
