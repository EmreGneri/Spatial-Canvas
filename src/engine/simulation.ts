import * as THREE from 'three';
import { POSITION_TEXTURE_SIZE } from './buffers';

/**
 * GPGPU parçacık simülasyonu (Gün 3 — Emre).
 *
 * positionTexture artık DataTexture DEĞİL: ping-pong render target'ın
 * texture'ı. Simülasyon her karede konumları shader'da hesaplar ve üzerine
 * yazar (CPU yok). Dinlenme konumu = homeTexture (depth'ten doldurulur).
 *
 * Hız nerede duruyor — karar (ARCHITECTURE.md): Verlet tek texture'da
 * imkânsız (w=seed + konum + önceki konum = 7 kanal > RGBA'nın 4'ü). Hız
 * ping-pong çifti kullanıldı: aynı bellek, tek kuvvet ifadesi, iki pass.
 *
 * Pass'ler: pos pass (konum+hız → yeni konum, seed korunur) ve vel pass
 * (yeni hız). Her karede RT'ler değiştirilir (ping-pong).
 */

export interface SimulationUniforms extends Record<string, THREE.IUniform> {
  uHome: { value: THREE.Texture | null };
  uPos: { value: THREE.Texture | null };
  uVel: { value: THREE.Texture | null };
  /** Yay katsayısı — sabit gömme, ayarlandıkça düzeltilir. */
  uStiffness: { value: number };
  /** Sönüm (0..1) — 1 = sönümsüz. */
  uDamping: { value: number };
  /** Ölü bölge: home'a bu kadar yakınken yay kuvveti yok (titreme önlemi). */
  uRestLength: { value: number };
  /** 0 = itme, 1 = çekim, 2 = vortex. */
  uForceMode: { value: number };
  uForceRadius: { value: number };
  uForceStrength: { value: number };
  uMouseWorld: { value: THREE.Vector2 };
  uMouseActive: { value: number };
}

const SIM_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Her iki pass'te de aynı kuvvet hesabı — iki shader'a gömülür. */
const FORCE_GLSL = /* glsl */ `
  uniform sampler2D uHome;
  uniform sampler2D uVel;
  uniform float uStiffness;
  uniform float uDamping;
  uniform float uRestLength;
  uniform float uForceMode;
  uniform float uForceRadius;
  uniform float uForceStrength;
  uniform vec2 uMouseWorld;
  uniform float uMouseActive;
  varying vec2 vUv;

  vec3 computeForce(vec3 pos) {
    vec3 force = vec3(0.0);

    // yay → dinlenme konumu (ölü bölge dışında)
    vec3 toHome = texture2D(uHome, vUv).xyz - pos;
    float distHome = length(toHome);
    if (distHome > uRestLength) {
      force += toHome * uStiffness;
    }

    // fare kuvvet alanı — z=0 düzleminde dünya koordinatı uMouseWorld
    vec2 d = pos.xy - uMouseWorld;
    float distMouse = length(d);
    if (uMouseActive > 0.5 && distMouse > 1e-4 && distMouse < uForceRadius) {
      vec2 dir = d / distMouse;
      float falloff = 1.0 - distMouse / uForceRadius;
      if (uForceMode < 0.5) {
        force += vec3(dir, 0.0) * uForceStrength * falloff;          // itme
      } else if (uForceMode < 1.5) {
        force -= vec3(dir, 0.0) * uForceStrength * falloff;          // çekim
      } else {
        force += vec3(-dir.y, dir.x, 0.0) * uForceStrength * falloff; // vortex
      }
    }
    return force;
  }
`;

const POS_FRAGMENT = /* glsl */ `
  uniform sampler2D uPos;
  ${FORCE_GLSL}
  void main() {
    vec4 cur = texture2D(uPos, vUv); // xyz = konum, w = seed (korunur!)
    vec3 vel = texture2D(uVel, vUv).xyz;
    vec3 newVel = (vel + computeForce(cur.xyz)) * uDamping;
    gl_FragColor = vec4(cur.xyz + newVel, cur.w);
  }
`;

const VEL_FRAGMENT = /* glsl */ `
  uniform sampler2D uPos;
  ${FORCE_GLSL}
  void main() {
    vec4 cur = texture2D(uPos, vUv);
    vec3 vel = texture2D(uVel, vUv).xyz;
    vec3 newVel = (vel + computeForce(cur.xyz)) * uDamping;
    gl_FragColor = vec4(newVel, 0.0);
  }
`;

const COPY_FRAGMENT = /* glsl */ `
  uniform sampler2D uHome;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(uHome, vUv);
  }
`;

function makeSimRenderTarget(type: THREE.TextureDataType) {
  return new THREE.WebGLRenderTarget(POSITION_TEXTURE_SIZE, POSITION_TEXTURE_SIZE, {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

export interface ParticleSimulation {
  /** Okunan konum RT'sinin texture'ı — engine bunu positionTexture olarak sunar. */
  positionTexture: THREE.Texture;
  uniforms: SimulationUniforms;
  /** depth geldiğinde home'u her iki konum RT'sine bir kez kopyalar. */
  seedFrom(home: THREE.Texture): void;
  /** Bir kare: pos + vel pass, sonra ping-pong takası. */
  step(): void;
  dispose(): void;
}

export function createSimulation(
  renderer: THREE.WebGLRenderer,
  type: THREE.TextureDataType,
): ParticleSimulation {
  let posRead = makeSimRenderTarget(type);
  let posWrite = makeSimRenderTarget(type);
  let velRead = makeSimRenderTarget(type);
  let velWrite = makeSimRenderTarget(type);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));

  const uniforms: SimulationUniforms = {
    uHome: { value: null },
    uPos: { value: null },
    uVel: { value: null },
    uStiffness: { value: 0.035 },
    uDamping: { value: 0.96 },
    uRestLength: { value: 0.005 },
    uForceMode: { value: 0 },
    uForceRadius: { value: 1.0 },
    uForceStrength: { value: 0.08 },
    uMouseWorld: { value: new THREE.Vector2(0, 0) },
    uMouseActive: { value: 0 },
  };

  const posMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SIM_VERTEX,
    fragmentShader: POS_FRAGMENT,
  });
  const velMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SIM_VERTEX,
    fragmentShader: VEL_FRAGMENT,
  });
  const copyMaterial = new THREE.ShaderMaterial({
    uniforms: { uHome: uniforms.uHome },
    vertexShader: SIM_VERTEX,
    fragmentShader: COPY_FRAGMENT,
  });

  function renderTo(target: THREE.WebGLRenderTarget, material: THREE.Material) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  }

  return {
    get positionTexture() {
      return posRead.texture;
    },

    uniforms,

    seedFrom(home: THREE.Texture) {
      uniforms.uHome.value = home;
      copyMaterial.uniforms.uHome.value = home;
      // İki taraf da home'dan başlar: ilk kare okuma tarafı hangisi olursa olsun
      // parçacıklar orijinden patlamaz.
      renderTo(posRead, copyMaterial);
      renderTo(posWrite, copyMaterial);
      uniforms.uPos.value = posRead.texture;
      uniforms.uVel.value = velRead.texture;
    },

    step() {
      uniforms.uPos.value = posRead.texture;
      uniforms.uVel.value = velRead.texture;
      renderTo(posWrite, posMaterial);
      renderTo(velWrite, velMaterial);
      [posRead, posWrite] = [posWrite, posRead];
      [velRead, velWrite] = [velWrite, velRead];
    },

    dispose() {
      for (const rt of [posRead, posWrite, velRead, velWrite]) rt.dispose();
      posMaterial.dispose();
      velMaterial.dispose();
      copyMaterial.dispose();
      quad.geometry.dispose();
    },
  };
}
