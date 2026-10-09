import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  WORLD,
  WORLD_W,
  WORLD_D,
  heightAt,
  riverDistanceAt,
  fbm,
  smoothstep,
  lerp,
} from '../world/terrain.js'
import { sim } from '../sim/store.js'

export const GLSL_NOISE = /* glsl */ `
  float wcHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wcNoise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(wcHash(i), wcHash(i + vec2(1.0, 0.0)), u.x),
               mix(wcHash(i + vec2(0.0, 1.0)), wcHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float wcFbm(vec2 p){
    float s = 0.0; float a = 0.5;
    for (int i = 0; i < 4; i++) { s += wcNoise(p) * a; p *= 2.03; a *= 0.5; }
    return s / 0.9375;
  }
`

const C = (hex) => new THREE.Color(hex)
const SAND = C('#d9c79b')
const WET_SAND = C('#b39f74')
const SEABED = C('#8f8a6a')
const GRASS_A = C('#6f9d45')
const GRASS_B = C('#4f8236')
const FOREST = C('#3f6c2e')
const MEADOW = C('#8aa84f')
const ROCK = C('#857a6d')
const ROCK_DARK = C('#6a625a')

function buildTerrainGeometry() {
  const segX = 264
  const segZ = 192
  const geo = new THREE.PlaneGeometry(WORLD_W, WORLD_D, segX, segZ)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const grass = new Float32Array(pos.count)
  const col = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const h = heightAt(x, z)
    pos.setY(i, h)
  }
  geo.computeVertexNormals()
  const nrm = geo.attributes.normal
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const h = pos.getY(i)
    const ny = nrm.getY(i)
    const n = fbm(x * 0.35, z * 0.35, 3)
    const n2 = fbm(x * 1.3 + 5, z * 1.3, 2)
    let g = 0
    if (h < -0.05) {
      col.copy(SEABED).lerp(WET_SAND, smoothstep(-1.2, -0.05, h))
    } else {
      // grass / meadow / forest floor
      col.copy(GRASS_A).lerp(GRASS_B, n)
      col.lerp(MEADOW, smoothstep(0.55, 0.8, n2) * 0.6)
      col.lerp(FOREST, smoothstep(1.4, 3.2, h) * 0.6)
      g = 1
      // beaches
      const beach = 1 - smoothstep(0.25, 0.6 + n * 0.3, h)
      col.lerp(SAND, beach)
      g *= 1 - beach
      // river banks: a little mud/gravel
      const rd = riverDistanceAt(x, z)
      const bank = (1 - smoothstep(0.7, 1.6, rd)) * 0.7
      col.lerp(ROCK, bank * 0.6)
      g *= 1 - bank
      // high ground and steep slopes become rock
      const alt = smoothstep(4.0, 6.0, h + (n - 0.5) * 1.5)
      const steep = 1 - smoothstep(0.62, 0.8, ny)
      const rock = Math.max(alt, steep)
      col.lerp(ROCK, rock)
      col.lerp(ROCK_DARK, rock * n2 * 0.6)
      g *= 1 - rock
    }
    colors[i * 3] = col.r
    colors[i * 3 + 1] = col.g
    colors[i * 3 + 2] = col.b
    grass[i] = g
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('aGrass', new THREE.BufferAttribute(grass, 1))
  return geo
}

// Side walls of the diorama: layered soil below the land, a cross-section of
// water where the ocean meets the edge.
function buildWalls() {
  const soilPos = []
  const soilCol = []
  const waterPos = []
  const rows = 10
  const bands = ['#5b4632', '#6d5440', '#7c6650', '#695541', '#8a755d', '#5e4b39']
  const tmp = new THREE.Color()
  const edges = [
    // [x0,z0,x1,z1,steps]
    [WORLD.minX, WORLD.maxZ, WORLD.maxX, WORLD.maxZ],
    [WORLD.maxX, WORLD.maxZ, WORLD.maxX, WORLD.minZ],
    [WORLD.maxX, WORLD.minZ, WORLD.minX, WORLD.minZ],
    [WORLD.minX, WORLD.minZ, WORLD.minX, WORLD.maxZ],
  ]
  for (const [x0, z0, x1, z1] of edges) {
    const len = Math.hypot(x1 - x0, z1 - z0)
    const steps = Math.round(len / 0.2)
    for (let s = 0; s < steps; s++) {
      const ta = s / steps
      const tb = (s + 1) / steps
      const ax = lerp(x0, x1, ta)
      const az = lerp(z0, z1, ta)
      const bx = lerp(x0, x1, tb)
      const bz = lerp(z0, z1, tb)
      const ha = heightAt(ax, az)
      const hb = heightAt(bx, bz)
      for (let r = 0; r < rows; r++) {
        const fa0 = r / rows
        const fa1 = (r + 1) / rows
        const ya0 = lerp(ha, WORLD.baseY, fa0)
        const ya1 = lerp(ha, WORLD.baseY, fa1)
        const yb0 = lerp(hb, WORLD.baseY, fa0)
        const yb1 = lerp(hb, WORLD.baseY, fa1)
        soilPos.push(ax, ya0, az, ax, ya1, az, bx, yb0, bz, bx, yb0, bz, ax, ya1, az, bx, yb1, bz)
        for (const y of [ya0, ya1, yb0, yb0, ya1, yb1]) {
          const band = Math.floor((y - WORLD.baseY) * 1.6 + Math.sin(ax * 0.7 + az * 0.7) * 0.6)
          tmp.set(bands[((band % bands.length) + bands.length) % bands.length])
          if (y > Math.max(ha, hb) - 0.25 && Math.max(ha, hb) > 0) tmp.set('#3f5a2a')
          soilCol.push(tmp.r, tmp.g, tmp.b)
        }
      }
      if (ha < 0 || hb < 0) {
        const ta0 = Math.min(ha, 0)
        const tb0 = Math.min(hb, 0)
        waterPos.push(ax, 0, az, ax, ta0, az, bx, 0, bz, bx, 0, bz, ax, ta0, az, bx, tb0, bz)
      }
    }
  }
  const soil = new THREE.BufferGeometry()
  soil.setAttribute('position', new THREE.Float32BufferAttribute(soilPos, 3))
  soil.setAttribute('color', new THREE.Float32BufferAttribute(soilCol, 3))
  soil.computeVertexNormals()
  const water = new THREE.BufferGeometry()
  water.setAttribute('position', new THREE.Float32BufferAttribute(waterPos, 3))
  water.computeVertexNormals()
  return { soil, water }
}

export default function Terrain() {
  const geometry = useMemo(buildTerrainGeometry, [])
  const walls = useMemo(buildWalls, [])
  const uniforms = useMemo(
    () => ({
      uSnowLine: { value: 5 },
      uWet: { value: 0 },
      uDry: { value: 0 },
      uFrost: { value: 0 },
    }),
    []
  )
  const smooth = useRef({ snow: 5, dry: 0, frost: 0 })

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 })
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           attribute float aGrass;
           varying float vGrass;
           varying vec3 vWPos;
           varying vec3 vWNormal;`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
           vGrass = aGrass;
           vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vWNormal = normalize(mat3(modelMatrix) * objectNormal);`
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uSnowLine;
           uniform float uWet;
           uniform float uDry;
           uniform float uFrost;
           varying float vGrass;
           varying vec3 vWPos;
           varying vec3 vWNormal;
           ${GLSL_NOISE}`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           float n = wcFbm(vWPos.xz * 0.45);
           float nf = wcNoise(vWPos.xz * 3.1);
           // dry, browning grass in a heatwave
           vec3 dryCol = mix(vec3(0.72, 0.62, 0.36), vec3(0.62, 0.5, 0.3), nf);
           diffuseColor.rgb = mix(diffuseColor.rgb, dryCol, uDry * vGrass * (0.6 + 0.4 * n));
           // frost on the ground when it is below freezing
           float above = step(0.03, vWPos.y);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.94), uFrost * vGrass * 0.55 * above);
           // snow cover above the snow line, thinner on steep slopes
           float sl = uSnowLine + (n - 0.5) * 1.3;
           float snow = smoothstep(sl - 0.18, sl + 0.22, vWPos.y);
           float flatness = smoothstep(0.42, 0.78, vWNormal.y);
           snow *= mix(0.25, 1.0, flatness) * above;
           snow = clamp(snow * (0.85 + 0.3 * nf), 0.0, 1.0);
           vec3 snowCol = mix(vec3(0.84, 0.89, 0.96), vec3(0.97, 0.98, 1.0), flatness);
           diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, snow);
           // darken wet ground after rain
           diffuseColor.rgb *= 1.0 - 0.22 * uWet * (1.0 - snow) * above;`
        )
    }
    return m
  }, [uniforms])

  useFrame((_, delta) => {
    const s = smooth.current
    const k = 1 - Math.exp(-delta * 3)
    s.snow += (sim.snowLine - s.snow) * k
    // heat stress: grass dries out in very hot weather
    const t = sim.temperature
    s.dry += (smoothstep(30, 46, t) - s.dry) * k
    s.frost += (smoothstep(0, -6, t) - s.frost) * k
    uniforms.uSnowLine.value = s.snow
    uniforms.uWet.value = sim.wet
    uniforms.uDry.value = s.dry
    uniforms.uFrost.value = s.frost
  })

  return (
    <group>
      <mesh geometry={geometry} material={material} receiveShadow castShadow />
      <mesh geometry={walls.soil}>
        <meshStandardMaterial vertexColors roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={walls.water} renderOrder={2}>
        <meshStandardMaterial
          color="#2f79a8"
          transparent
          opacity={0.72}
          roughness={0.2}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* display plinth */}
      <mesh position={[0, WORLD.baseY - 0.45, 0]} receiveShadow>
        <boxGeometry args={[WORLD_W + 1.4, 0.9, WORLD_D + 1.4]} />
        <meshStandardMaterial color="#2b313b" roughness={0.6} metalness={0.1} />
      </mesh>
      <mesh position={[0, WORLD.baseY - 0.02, 0]}>
        <boxGeometry args={[WORLD_W + 0.6, 0.06, WORLD_D + 0.6]} />
        <meshStandardMaterial color="#3a414d" roughness={0.5} />
      </mesh>
    </group>
  )
}
