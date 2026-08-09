import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { createDepthTexture, createPositionTexture, POSITION_TEXTURE_SIZE } from './buffers';
import { createGrainPass, grainPassUniforms } from './pipeline';

const MAX_DPR = 2;

const depthVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const depthFragment = /* glsl */ `
  uniform sampler2D uDepth;
  varying vec2 vUv;
  void main() {
    float d = texture2D(uDepth, vUv).r;
    gl_FragColor = vec4(vec3(d), 1.0);
  }
`;

/**
 * Veri katmanının çekirdeği (Emre). Sahnede tek şey vardır: depth'i ekrana
 * basan tam ekran quad. Gün 2'de point cloud bunun üstüne kurulur; render
 * modları ve pass'ler Zeynep'in katmanıdır (pipeline.ts).
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly positionTexture: THREE.DataTexture;

  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private depthMaterial: THREE.ShaderMaterial;
  private currentDepthTexture: THREE.DataTexture | null = null;
  private composer: EffectComposer;
  private grainPass: ShaderPass;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    container.appendChild(this.renderer.domElement);

    this.positionTexture = createPositionTexture();

    this.depthMaterial = new THREE.ShaderMaterial({
      uniforms: { uDepth: { value: null } },
      vertexShader: depthVertex,
      fragmentShader: depthFragment,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.depthMaterial);
    this.scene.add(this.quad);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.grainPass = createGrainPass();
    this.composer.addPass(this.grainPass);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.renderer.setAnimationLoop((time) => {
      grainPassUniforms.uTime.value = time / 1000;
      this.composer.render();
    });
  }

  /** Depth sözleşmesi: R32F, 0=uzak/1=yakın, satır 0 = üst. Flip yalnızca burada. */
  setDepth(data: Float32Array, width: number, height: number) {
    this.currentDepthTexture?.dispose();
    this.currentDepthTexture = createDepthTexture(data, width, height);
    this.depthMaterial.uniforms.uDepth.value = this.currentDepthTexture;
  }

  /** Renderers read the normalized R32F depth map through this contract. */
  get depthTexture(): THREE.DataTexture | null {
    return this.currentDepthTexture;
  }

  get positionCount() {
    return POSITION_TEXTURE_SIZE * POSITION_TEXTURE_SIZE;
  }

  private resize() {
    const width = this.renderer.domElement.parentElement?.clientWidth || 1;
    const height = this.renderer.domElement.parentElement?.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.currentDepthTexture?.dispose();
    this.positionTexture.dispose();
    this.quad.geometry.dispose();
    this.depthMaterial.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
