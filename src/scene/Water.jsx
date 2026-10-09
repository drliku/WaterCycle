import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  WORLD,
  WORLD_W,
  WORLD_D,
  createDepthTexture,
  riverCurve,
  riverSurfaceAt,
  RIVER_MOUTH_T,
} from '../world/terrain.js'
import { sim } from '../sim/store.js'
import { GLSL_NOISE } from './Terrain.jsx'
import { SUN_DIR } from './Sky.jsx'

const COMMON = /* glsl */ `
  ${GLSL_NOISE}
  vec3 s2l(vec3 c) { return pow(c, vec3(2.2)); }
  float waveH(vec2 p, float t) {
    return sin(p.x * 0.9 + t * 1.3) * 0.5
         + sin(p.y * 1.25 - t * 1.05 + p.x * 0.4) * 0.35
         + sin((p.x + p.y) * 2.3 + t * 2.1) * 0.15;
  }
`

const oceanVertex = /* glsl */ `
  uniform float uTime;
  uniform float uIce;
  uniform sampler2D uDepth;
  uniform vec2 uMin;
  uniform vec2 uSize;
  varying vec3 vW;
  varying vec2 vUvW;
  ${COMMON}
  float iceMask(float depth, float n) {
    float lim = uIce * 1.08 - 0.04;
    return smoothstep(lim + 0.015, lim - 0.015, depth + (n - 0.5) * 0.14);
  }
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vec2 uv = (w.xz - uMin) / uSize;
    vec4 d = texture2D(uDepth, uv);
    float ice = iceMask(d.r, d.g);
    w.y += waveH(w.xz, uTime) * 0.045 * (1.0 - ice);
    vW = w.xyz;
    vUvW = uv;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const oceanFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIce;
  uniform float uSun;
  uniform float uOvercast;
  uniform vec3 uSunDir;
  uniform vec3 uSkyCol;
  uniform sampler2D uDepth;
  varying vec3 vW;
  varying vec2 vUvW;
  ${COMMON}
  float iceMask(float depth, float n) {
    float lim = uIce * 1.08 - 0.04;
    return smoothstep(lim + 0.015, lim - 0.015, depth + (n - 0.5) * 0.14);
  }
  void main() {
    vec4 d = texture2D(uDepth, vUvW);
    float depth = d.r;
    if (depth < 0.002) discard;
    float ice = iceMask(depth, d.g);

    // analytic-ish normal from the wave function + small ripples
    float e = 0.08;
    float h0 = waveH(vW.xz, uTime);
    float hx = waveH(vW.xz + vec2(e, 0.0), uTime);
    float hz = waveH(vW.xz + vec2(0.0, e), uTime);
    vec3 n = normalize(vec3(-(hx - h0) / e * 0.045, 1.0, -(hz - h0) / e * 0.045));
    float r1 = wcNoise(vW.xz * 2.4 + vec2(uTime * 0.35, uTime * 0.2));
    float r2 = wcNoise(vW.xz * 3.1 - vec2(uTime * 0.25, -uTime * 0.3));
    n = normalize(n + vec3(r1 - 0.5, 0.0, r2 - 0.5) * 0.22);
    n = normalize(mix(n, vec3(0.0, 1.0, 0.0), ice));

    vec3 V = normalize(cameraPosition - vW);
    vec3 L = normalize(uSunDir);
    float diff = max(dot(n, L), 0.0);

    vec3 shallow = s2l(vec3(0.20, 0.66, 0.68));
    vec3 deep = s2l(vec3(0.04, 0.24, 0.42));
    vec3 water = mix(shallow, deep, smoothstep(0.0, 0.55, depth));
    water = mix(water, water * 0.75 + s2l(vec3(0.35, 0.4, 0.45)) * 0.25, uOvercast * 0.6);
    float light = 0.45 + 0.55 * diff * uSun;
    vec3 col = water * light;

    float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
    col = mix(col, uSkyCol, fres * 0.65);
    float spec = pow(max(dot(reflect(-L, n), V), 0.0), 140.0) * uSun * (1.0 - uOvercast * 0.8);
    col += vec3(1.0, 0.95, 0.85) * spec * 2.2;

    // surf along the shore
    float shore = 1.0 - smoothstep(0.0, 0.07, depth);
    float fn = wcNoise(vW.xz * 4.0 + vec2(uTime * 0.6, 0.0));
    float foam = shore * smoothstep(0.35, 0.75, fn + 0.25 * sin(depth * 120.0 - uTime * 2.5));
    col = mix(col, vec3(0.95), foam * 0.75 * (1.0 - ice));

    float alpha = mix(0.55, 0.93, smoothstep(0.0, 0.3, depth));

    // sea ice: bright, slightly blue, with cracks between floes
    if (ice > 0.001) {
      float cn = wcNoise(vW.xz * 1.6);
      float cracks = smoothstep(0.03, 0.0, abs(wcNoise(vW.xz * 0.9 + 7.0) - 0.5));
      vec3 iceCol = mix(s2l(vec3(0.80, 0.89, 0.95)), s2l(vec3(0.95, 0.97, 0.99)), cn);
      iceCol = mix(iceCol, s2l(vec3(0.55, 0.72, 0.84)), cracks * 0.6);
      iceCol *= 0.55 + 0.5 * diff * uSun + 0.15;
      float edge = smoothstep(0.0, 0.25, ice);
      col = mix(col, iceCol, edge);
      alpha = mix(alpha, 0.97, edge);
    }

    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function Ocean() {
  const depthTex = useMemo(() => createDepthTexture(256), [])
  const ice = useRef(0)
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uIce: { value: 0 },
      uSun: { value: 1 },
      uOvercast: { value: 0 },
      uSunDir: { value: SUN_DIR.clone() },
      uSkyCol: { value: new THREE.Color('#9cc7e8') },
      uDepth: { value: depthTex },
      uMin: { value: new THREE.Vector2(WORLD.minX, WORLD.minZ) },
      uSize: { value: new THREE.Vector2(WORLD_W, WORLD_D) },
    }),
    [depthTex]
  )
  useFrame((_, delta) => {
    ice.current += (sim.seaIce - ice.current) * (1 - Math.exp(-delta * 4))
    uniforms.uTime.value = sim.time
    uniforms.uIce.value = ice.current
    uniforms.uSun.value = 0.35 + sim.effSun * 1.1
    uniforms.uOvercast.value = sim.cover
    uniforms.uSkyCol.value.setRGB(0.42, 0.62, 0.82).lerp(new THREE.Color(0.45, 0.48, 0.52), sim.cover * 0.8)
  })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} renderOrder={1}>
      <planeGeometry args={[WORLD_W, WORLD_D, 220, 160]} />
      <shaderMaterial
        vertexShader={oceanVertex}
        fragmentShader={oceanFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// River: a ribbon following the carved channel, with flowing streaks whose
// speed follows the simulated runoff. It freezes over in cold weather.
// ---------------------------------------------------------------------------
const riverVertex = /* glsl */ `
  attribute float aT;
  varying vec2 vUv;
  varying vec3 vW;
  varying float vT;
  void main() {
    vUv = uv;
    vT = aT;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const riverFragment = /* glsl */ `
  uniform float uPhase;
  uniform float uIce;
  uniform float uFlow;
  uniform float uSun;
  uniform float uMouth;
  uniform vec3 uSunDir;
  varying vec2 vUv;
  varying vec3 vW;
  varying float vT;
  ${COMMON}
  void main() {
    float across = vUv.y;
    float edge = smoothstep(0.0, 0.18, across) * smoothstep(1.0, 0.82, across);
    vec3 shallow = s2l(vec3(0.30, 0.66, 0.72));
    vec3 deep = s2l(vec3(0.10, 0.38, 0.55));
    vec3 col = mix(shallow, deep, edge);
    // flowing streaks
    float s1 = wcNoise(vec2(vUv.x * 1.4 - uPhase, across * 5.0));
    float s2 = wcNoise(vec2(vUv.x * 3.2 - uPhase * 1.7, across * 9.0 + 3.0));
    float streak = smoothstep(0.62, 0.9, s1 * 0.6 + s2 * 0.5);
    col = mix(col, vec3(0.85, 0.95, 1.0), streak * (0.25 + 0.4 * uFlow) * edge);
    // white water on the steep upper course
    float rapids = (1.0 - smoothstep(0.05, 0.3, vT)) * smoothstep(0.45, 0.8, s2);
    col = mix(col, vec3(0.92, 0.96, 1.0), rapids * 0.3 * (0.4 + uFlow));
    vec3 V = normalize(cameraPosition - vW);
    vec3 L = normalize(uSunDir);
    vec3 n = normalize(vec3((s1 - 0.5) * 0.25, 1.0, (s2 - 0.5) * 0.25));
    float spec = pow(max(dot(reflect(-L, n), V), 0.0), 90.0) * uSun;
    col *= 0.55 + 0.5 * uSun;
    col += spec * 0.9;

    // ice: freezes from the banks inward and along its length
    float iceN = wcNoise(vW.xz * 1.7);
    float iceAmt = smoothstep(0.0, 0.08, uIce * 1.1 - abs(across - 0.5) * 0.9 * (1.0 - uIce) - iceN * 0.15);
    vec3 iceCol = mix(s2l(vec3(0.82, 0.9, 0.95)), s2l(vec3(0.95, 0.97, 1.0)), iceN) * (0.6 + 0.45 * uSun);
    col = mix(col, iceCol, iceAmt);

    float fadeIn = smoothstep(0.0, 0.03, vT);
    float fadeOut = 1.0 - smoothstep(uMouth - 0.02, uMouth + 0.05, vT);
    float alpha = mix(0.85, 1.0, edge) * fadeIn * fadeOut;
    alpha *= smoothstep(0.0, 0.06, across) * smoothstep(1.0, 0.94, across);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function buildRiverGeometry() {
  const N = 260
  const half = 1.15
  const pos = []
  const uv = []
  const tAttr = []
  const idx = []
  let len = 0
  let prev = null
  const endT = Math.min(1, RIVER_MOUTH_T + 0.07)
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * endT
    const p = riverCurve.getPointAt(t)
    const tan = riverCurve.getTangentAt(t)
    if (prev) len += p.distanceTo(prev)
    prev = p
    const nx = -tan.z
    const nz = tan.x
    const y = riverSurfaceAt(t) + 0.01
    const w = half * (0.55 + 0.45 * Math.min(1, t / 0.12))
    pos.push(p.x + nx * w, y, p.z + nz * w, p.x - nx * w, y, p.z - nz * w)
    uv.push(len, 0, len, 1)
    tAttr.push(t, t)
    if (i < N) {
      const a = i * 2
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('aT', new THREE.Float32BufferAttribute(tAttr, 1))
  g.setIndex(idx)
  return g
}

export function River() {
  const geometry = useMemo(buildRiverGeometry, [])
  const state = useRef({ phase: 0, ice: 0, flow: 0.3 })
  const uniforms = useMemo(
    () => ({
      uPhase: { value: 0 },
      uIce: { value: 0 },
      uFlow: { value: 0.3 },
      uSun: { value: 1 },
      uMouth: { value: RIVER_MOUTH_T },
      uSunDir: { value: SUN_DIR.clone() },
    }),
    []
  )
  useFrame((_, delta) => {
    const s = state.current
    const k = 1 - Math.exp(-delta * 3)
    s.ice += (sim.riverIce - s.ice) * k
    s.flow += (sim.runoff - s.flow) * k
    uniforms.uIce.value = s.ice
    uniforms.uFlow.value = Math.min(1.2, s.flow)
    uniforms.uSun.value = 0.35 + sim.effSun * 1.1
    uniforms.uPhase.value = sim.riverPhase
  })
  return (
    <mesh geometry={geometry} renderOrder={3}>
      <shaderMaterial
        vertexShader={riverVertex}
        fragmentShader={riverFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
      />
    </mesh>
  )
}
