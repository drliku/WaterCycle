import * as THREE from 'three'

// ---------------------------------------------------------------------------
// World layout
// The landscape is a miniature diorama: ocean to the east (+x), mountains to
// the west (-x) and a river that drains the mountains into the ocean.
// ---------------------------------------------------------------------------

export const WORLD = { minX: -22, maxX: 22, minZ: -16, maxZ: 16, baseY: -5 }
export const WORLD_W = WORLD.maxX - WORLD.minX
export const WORLD_D = WORLD.maxZ - WORLD.minZ

// One vertical scene unit represents 300 m of real altitude.
export const METERS_PER_UNIT = 300
// Standard environmental lapse rate: air cools ~6.5 °C per km of altitude.
export const LAPSE_PER_UNIT = (6.5 * METERS_PER_UNIT) / 1000

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
export const lerp = (a, b, t) => a + (b - a) * t
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

// --- small deterministic noise ------------------------------------------------
function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123
  return s - Math.floor(s)
}
function vnoise(x, z) {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uz = fz * fz * (3 - 2 * fz)
  const a = hash(ix, iz)
  const b = hash(ix + 1, iz)
  const c = hash(ix, iz + 1)
  const d = hash(ix + 1, iz + 1)
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz)
}
export function fbm(x, z, oct = 4) {
  let sum = 0
  let amp = 0.5
  let f = 1
  let norm = 0
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * f, z * f) * amp
    norm += amp
    amp *= 0.5
    f *= 2.03
  }
  return sum / norm
}
function ridged(x, z) {
  let sum = 0
  let amp = 0.5
  let f = 1
  let norm = 0
  for (let i = 0; i < 4; i++) {
    const n = 1 - Math.abs(vnoise(x * f, z * f) * 2 - 1)
    sum += n * n * amp
    norm += amp
    amp *= 0.5
    f *= 2.1
  }
  return sum / norm
}

// Seeded random for stable placement of trees etc.
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- raw (un-carved) terrain ---------------------------------------------------
export const coastX = (z) => 5 + 2.2 * Math.sin(z * 0.23 + 0.5) + 1.0 * Math.sin(z * 0.61 + 2.0)

export const PEAKS = [
  { x: -12.5, z: -5, h: 7.4, r: 4.6 },
  { x: -6.5, z: -11, h: 4.6, r: 3.4 },
  { x: -16, z: 6, h: 4.6, r: 3.8 },
  { x: -2.5, z: -13.8, h: 2.4, r: 2.8 },
  { x: -19, z: -12, h: 3.2, r: 3.4 },
]

function rawHeight(x, z) {
  const d = coastX(z) - x // > 0 on land side
  const base = -4.0 + 4.75 * smoothstep(-7, 3.5, d)
  const land = smoothstep(-1, 3, d)
  const hills = (fbm(x * 0.17 + 3.1, z * 0.17 - 1.7) - 0.5) * 1.3 * land
  let m = 0
  for (const p of PEAKS) {
    const dx = x - p.x
    const dz = z - p.z
    m += p.h * Math.exp(-(dx * dx + dz * dz) / (2 * p.r * p.r))
  }
  const rough = 0.82 + 0.36 * ridged(x * 0.33 + 7.3, z * 0.33 + 2.1)
  return base + hills + m * rough * land
}

// --- river ----------------------------------------------------------------------
const RIVER_CTRL = [
  [-8.9, -1.3],
  [-7.3, 0.5],
  [-5.0, 1.4],
  [-2.6, 0.4],
  [-0.2, 1.2],
  [2.2, 2.9],
  [4.6, 3.4],
  [7.2, 3.1],
  [9.8, 3.2],
]
export const riverCurve = new THREE.CatmullRomCurve3(
  RIVER_CTRL.map(([x, z]) => new THREE.Vector3(x, 0, z)),
  false,
  'centripetal'
)
const RIVER_SAMPLES = 320
export const riverPts = riverCurve.getSpacedPoints(RIVER_SAMPLES - 1).map((p) => [p.x, p.z])

// Water-surface height along the river: it may never run uphill, so take the
// running minimum of the ground height from the source, sunk into a channel.
export const riverSurface = (() => {
  const out = new Float32Array(RIVER_SAMPLES)
  let cum = Infinity
  for (let i = 0; i < RIVER_SAMPLES; i++) {
    const [x, z] = riverPts[i]
    cum = Math.min(cum, rawHeight(x, z))
    out[i] = Math.max(cum - 0.3, 0.025)
  }
  // light monotone smoothing
  const sm = new Float32Array(RIVER_SAMPLES)
  for (let i = 0; i < RIVER_SAMPLES; i++) {
    let s = 0
    let n = 0
    for (let k = -4; k <= 4; k++) {
      const j = clamp(i + k, 0, RIVER_SAMPLES - 1)
      s += out[j]
      n++
    }
    sm[i] = s / n
  }
  return sm
})()

// Parameter where the river reaches the sea (centre-line ground below sea level)
export const RIVER_MOUTH_T = (() => {
  for (let i = 0; i < RIVER_SAMPLES; i++) {
    const [x, z] = riverPts[i]
    if (rawHeight(x, z) < -0.15) return i / (RIVER_SAMPLES - 1)
  }
  return 1
})()

export function riverSurfaceAt(t) {
  const f = clamp(t, 0, 1) * (RIVER_SAMPLES - 1)
  const i = Math.floor(f)
  const j = Math.min(i + 1, RIVER_SAMPLES - 1)
  return lerp(riverSurface[i], riverSurface[j], f - i)
}

// --- height grid with carved river ------------------------------------------------
const RES = 0.1
const GW = Math.round(WORLD_W / RES) + 1
const GD = Math.round(WORLD_D / RES) + 1
const heights = new Float32Array(GW * GD)
const riverDist = new Float32Array(GW * GD).fill(1e9)
const riverT = new Float32Array(GW * GD)

;(function build() {
  for (let j = 0; j < GD; j++) {
    for (let i = 0; i < GW; i++) {
      heights[j * GW + i] = rawHeight(WORLD.minX + i * RES, WORLD.minZ + j * RES)
    }
  }
  // stamp distance-to-river around each segment
  const R = 2.6
  for (let s = 0; s < RIVER_SAMPLES - 1; s++) {
    const [ax, az] = riverPts[s]
    const [bx, bz] = riverPts[s + 1]
    const minI = Math.max(0, Math.floor((Math.min(ax, bx) - R - WORLD.minX) / RES))
    const maxI = Math.min(GW - 1, Math.ceil((Math.max(ax, bx) + R - WORLD.minX) / RES))
    const minJ = Math.max(0, Math.floor((Math.min(az, bz) - R - WORLD.minZ) / RES))
    const maxJ = Math.min(GD - 1, Math.ceil((Math.max(az, bz) + R - WORLD.minZ) / RES))
    const ex = bx - ax
    const ez = bz - az
    const len2 = ex * ex + ez * ez
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const px = WORLD.minX + i * RES - ax
        const pz = WORLD.minZ + j * RES - az
        const u = clamp((px * ex + pz * ez) / len2, 0, 1)
        const dx = px - u * ex
        const dz = pz - u * ez
        const d = Math.sqrt(dx * dx + dz * dz)
        const k = j * GW + i
        if (d < riverDist[k]) {
          riverDist[k] = d
          riverT[k] = (s + u) / (RIVER_SAMPLES - 1)
        }
      }
    }
  }
  for (let k = 0; k < GW * GD; k++) {
    const d = riverDist[k]
    if (d > 2.6) continue
    const surf = riverSurfaceAt(riverT[k])
    const bed = surf - 0.34
    const s = smoothstep(0.55, 2.4, d)
    const carved = Math.min(heights[k], lerp(bed, heights[k], s))
    // keep low banks above the water so the river never spills sideways
    const levee = lerp(bed, surf + 0.14, smoothstep(0.5, 1.25, d))
    const w = (1 - smoothstep(1.4, 2.5, d)) * smoothstep(0.03, 0.15, surf)
    heights[k] = lerp(carved, Math.max(carved, levee), w)
  }
})()

function sampleGrid(arr, x, z) {
  const fx = clamp((x - WORLD.minX) / RES, 0, GW - 1.001)
  const fz = clamp((z - WORLD.minZ) / RES, 0, GD - 1.001)
  const i = Math.floor(fx)
  const j = Math.floor(fz)
  const tx = fx - i
  const tz = fz - j
  const k = j * GW + i
  return lerp(lerp(arr[k], arr[k + 1], tx), lerp(arr[k + GW], arr[k + GW + 1], tx), tz)
}

export const heightAt = (x, z) => sampleGrid(heights, x, z)
export const riverDistanceAt = (x, z) => sampleGrid(riverDist, x, z)

export function gradientAt(x, z, out = [0, 0]) {
  const e = 0.15
  out[0] = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e)
  out[1] = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e)
  return out
}

export function slopeNormalY(x, z) {
  const g = gradientAt(x, z)
  return 1 / Math.sqrt(1 + g[0] * g[0] + g[1] * g[1])
}

export const MAX_HEIGHT = (() => {
  let m = -Infinity
  for (let k = 0; k < heights.length; k++) m = Math.max(m, heights[k])
  return m
})()

// Water depth texture used by the ocean shader for shore colour, foam and sea ice.
export function createDepthTexture(size = 256) {
  const data = new Uint8Array(size * size * 4)
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = WORLD.minX + (i / (size - 1)) * WORLD_W
      const z = WORLD.minZ + (j / (size - 1)) * WORLD_D
      const h = heightAt(x, z)
      const depth = clamp(-h / 5, 0, 1)
      const k = (j * size + i) * 4
      data[k] = Math.round(depth * 255)
      data[k + 1] = Math.round(fbm(x * 0.6, z * 0.6, 3) * 255)
      data[k + 2] = 0
      data[k + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

// Random point on open ocean (used for evaporation)
export function randomOceanPoint(rand = Math.random, minDepth = 0.15) {
  for (let tries = 0; tries < 30; tries++) {
    const x = lerp(2, WORLD.maxX - 0.5, rand())
    const z = lerp(WORLD.minZ + 0.5, WORLD.maxZ - 0.5, rand())
    const h = heightAt(x, z)
    if (h < -minDepth) return [x, z, -h]
  }
  return null
}

// Air temperature at a given scene height for a sea-level temperature
export const tempAtHeight = (seaLevelT, y) => seaLevelT - Math.max(0, y) * LAPSE_PER_UNIT
