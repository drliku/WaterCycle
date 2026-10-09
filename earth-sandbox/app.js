/* Earth Sandbox — a small 2D world simulation.
 *
 * The world is a grid of cells. Each cell has terrain height, surface water,
 * snow, temperature, rainfall and vegetation. Every tick:
 *   1. climate targets are computed from latitude, altitude, winds and oceans
 *   2. temperature and rainfall drift toward those targets
 *   3. rain and snowmelt add water, which evaporates or flows downhill;
 *      the flow builds rivers and fills basins into lakes
 *   4. snow, sea ice and vegetation grow or retreat toward what the climate supports
 *   5. sea level follows the slider, ocean warming and land ice melt
 */
;(() => {
  'use strict'

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  // 2:1 grid, so the real Earth fits as an equirectangular map (0.83° per cell)
  const W = 432
  const H = 216
  const N = W * H
  const M_PER_UNIT = 5000 // one elevation unit = 5 km
  const LAPSE = 6.5 // °C per km
  const SUBSTEPS = 3 // water-flow steps per tick
  const TICKS_PER_SEC = 8
  const YEARS_PER_TICK = 5
  const RAIN_K = 3e-10 // water depth (units) per mm/yr of rain, per substep
  const MELT_K = 6e-8 // snow melted per °C above zero, per substep
  const LAKE_T = 0.002 // 10 m of standing water shows as a lake
  const RIVER_MIN = 7.5e-6 // flow needed to draw a river
  const SNOW_CAP = 0.0003
  const ICE_SWE = 0.00006 // snow this deep counts as permanent ice
  const SPEEDS = [0.25, 0.5, 1, 2, 4, 8]

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
  const lerp = (a, b, t) => a + (b - a) * t
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
  }
  function mulberry32(seed) {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  // Seeded 2D Perlin noise, roughly in [-0.7, 0.7]
  function makePerlin(seed) {
    const rnd = mulberry32(seed)
    const p = new Uint8Array(256)
    for (let i = 0; i < 256; i++) p[i] = i
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      const t = p[i]
      p[i] = p[j]
      p[j] = t
    }
    const perm = new Uint8Array(512)
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
    const gx = new Float32Array(8)
    const gy = new Float32Array(8)
    for (let i = 0; i < 8; i++) {
      gx[i] = Math.cos((i * Math.PI) / 4)
      gy[i] = Math.sin((i * Math.PI) / 4)
    }
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
    return (x, y) => {
      const xi = Math.floor(x)
      const yi = Math.floor(y)
      const xf = x - xi
      const yf = y - yi
      const X = xi & 255
      const Y = yi & 255
      const u = fade(xf)
      const v = fade(yf)
      const aa = perm[perm[X] + Y] & 7
      const ab = perm[perm[X] + Y + 1] & 7
      const ba = perm[perm[X + 1] + Y] & 7
      const bb = perm[perm[X + 1] + Y + 1] & 7
      const x1 = lerp(gx[aa] * xf + gy[aa] * yf, gx[ba] * (xf - 1) + gy[ba] * yf, u)
      const x2 = lerp(gx[ab] * xf + gy[ab] * (yf - 1), gx[bb] * (xf - 1) + gy[bb] * (yf - 1), u)
      return lerp(x1, x2, v)
    }
  }
  function fbm(noise, x, y, oct) {
    let s = 0
    let a = 1
    let f = 1
    let norm = 0
    for (let i = 0; i < oct; i++) {
      s += noise(x * f, y * f) * a
      norm += a
      a *= 0.5
      f *= 2.02
    }
    return s / norm
  }
  function ridged(noise, x, y, oct) {
    let s = 0
    let a = 1
    let f = 1
    let norm = 0
    for (let i = 0; i < oct; i++) {
      const n = 1 - Math.abs(noise(x * f, y * f) * 1.45)
      s += n * n * a
      norm += a
      a *= 0.5
      f *= 2.05
    }
    return s / norm
  }

  // Colour ramps: [[x, r, g, b], ...] sorted by x
  function ramp(stops, x, out) {
    if (x <= stops[0][0]) {
      out[0] = stops[0][1]
      out[1] = stops[0][2]
      out[2] = stops[0][3]
      return out
    }
    const last = stops[stops.length - 1]
    if (x >= last[0]) {
      out[0] = last[1]
      out[1] = last[2]
      out[2] = last[3]
      return out
    }
    let k = 1
    while (stops[k][0] < x) k++
    const a = stops[k - 1]
    const b = stops[k]
    const t = (x - a[0]) / (b[0] - a[0])
    out[0] = a[1] + (b[1] - a[1]) * t
    out[1] = a[2] + (b[2] - a[2]) * t
    out[2] = a[3] + (b[3] - a[3]) * t
    return out
  }
  const rampCss = (stops, x) => {
    const c = ramp(stops, x, [0, 0, 0])
    return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
  }

  // ---------------------------------------------------------------------------
  // World state
  // ---------------------------------------------------------------------------
  const elev = new Float32Array(N) // terrain height (units, sea level 0 at start)
  const water = new Float32Array(N) // standing / flowing surface water depth
  const snow = new Float32Array(N) // snow & glacier water-equivalent depth
  const seaIce = new Float32Array(N) // 0..1 sea ice cover
  const temp = new Float32Array(N) // °C (current)
  const tempT = new Float32Array(N) // °C (where it is heading)
  const rain = new Float32Array(N) // mm / year (current)
  const rainT = new Float32Array(N)
  const veg = new Float32Array(N) // 0..1 vegetation cover
  const pet = new Float32Array(N) // potential evaporation (mm / year)
  const flux = new Float32Array(N) // smoothed water flow through the cell
  const flow = new Float32Array(N)
  const dw = new Float32Array(N)
  const dir = new Int32Array(N).fill(-1) // downstream neighbour
  const tempMod = new Float32Array(N) // user-painted temperature change (°C)
  const rainMod = new Float32Array(N) // user-painted rainfall change (-1..1)
  const tmpA = new Float32Array(N)
  const summerAmp = new Float32Array(N) // how much warmer summer is than the yearly mean
  const tNoise = new Float32Array(N) // fixed local climate variation (°C)
  const texN = new Float32Array(N) // fine surface texture for shading

  const state = {
    world: 'earth', // 'earth' or 'random'
    seed: 1,
    year: 0,
    simTime: 0,
    paused: false,
    speedIdx: 2,
    globalTemp: 0,
    rainfall: 1,
    seaSlider: 0, // metres
    seaLevel: 0, // units
    seaTargetM: 0,
    iceRef: 1,
    iceNow: 1,
    tool: 'raise',
    polarity: 1,
    brush: 14,
    view: 'biome',
    tickCount: 0,
  }

  const pet_of = (T) => (T > 0 ? 250 + 40 * T : Math.max(110, 250 + 10 * T))

  // ---------------------------------------------------------------------------
  // World generation
  // ---------------------------------------------------------------------------
  function heapFill(surface, sea, eps) {
    // Priority-flood: raise every closed basin to its spill height so that
    // all water can drain to the ocean (eps adds a tiny downhill slope).
    const seen = new Uint8Array(N)
    const heap = new Int32Array(N)
    let size = 0
    const key = surface
    const push = (i) => {
      let k = size++
      heap[k] = i
      while (k > 0) {
        const p = (k - 1) >> 1
        if (key[heap[p]] <= key[heap[k]]) break
        const t = heap[p]
        heap[p] = heap[k]
        heap[k] = t
        k = p
      }
    }
    const pop = () => {
      const top = heap[0]
      heap[0] = heap[--size]
      let k = 0
      for (;;) {
        const l = 2 * k + 1
        const r = l + 1
        let m = k
        if (l < size && key[heap[l]] < key[heap[m]]) m = l
        if (r < size && key[heap[r]] < key[heap[m]]) m = r
        if (m === k) break
        const t = heap[m]
        heap[m] = heap[k]
        heap[k] = t
        k = m
      }
      return top
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        if (surface[i] < sea || x === 0 || y === 0 || x === W - 1 || y === H - 1) {
          seen[i] = 1
          push(i)
        }
      }
    }
    while (size > 0) {
      const c = pop()
      const cx = c % W
      const cy = (c / W) | 0
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy
        if (ny < 0 || ny >= H) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= W) continue
          const n = ny * W + nx
          if (seen[n]) continue
          seen[n] = 1
          if (surface[n] < surface[c] + eps) surface[n] = surface[c] + eps
          push(n)
        }
      }
    }
    return surface
  }

  function generate(seed) {
    state.seed = seed
    const n1 = makePerlin(seed)
    const n2 = makePerlin(seed + 101)
    const n3 = makePerlin(seed + 202)
    const n4 = makePerlin(seed + 303)
    const n5 = makePerlin(seed + 404)
    const rnd = mulberry32(seed * 7 + 3)
    const ox = rnd() * 50
    const oy = rnd() * 50

    const cont = tmpA
    const ridge = new Float32Array(N)
    const detail = new Float32Array(N)
    const mmask = new Float32Array(N)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        const nx = x / H
        const ny = y / H
        const wx = fbm(n3, nx * 1.6 + ox, ny * 1.6 + oy, 3) * 0.8
        const wy = fbm(n3, nx * 1.6 + oy + 9, ny * 1.6 + ox + 4, 3) * 0.8
        let c = fbm(n1, nx * 2.6 + wx + ox, ny * 2.6 + wy + oy, 6)
        // keep the map border oceanic so continents sit inside the frame
        const ex = Math.min(x, W - 1 - x) / W
        const ey = Math.min(y, H - 1 - y) / H
        const edge = smooth(0, 0.13, ex) * smooth(0, 0.15, ey)
        cont[i] = c * edge - (1 - edge) * 0.32
        ridge[i] = ridged(n2, nx * 4.2 + ox, ny * 4.2 + oy, 5)
        detail[i] = fbm(n4, nx * 14 + ox, ny * 14 + oy, 3)
        mmask[i] = fbm(n5, nx * 1.8 + oy, ny * 1.8 + ox, 3)
        tNoise[i] = fbm(n4, nx * 3 + 17, ny * 3 + 5, 4) * 7
        texN[i] = fbm(n5, nx * 40, ny * 40, 2)
      }
    }
    // ~37% land
    const sorted = Float32Array.from(cont).sort()
    const thr = sorted[Math.floor(N * 0.63)]
    let maxL = 1e-6
    let minO = -1e-6
    for (let i = 0; i < N; i++) {
      cont[i] -= thr
      if (cont[i] > maxL) maxL = cont[i]
      if (cont[i] < minO) minO = cont[i]
    }
    for (let i = 0; i < N; i++) {
      const c = cont[i]
      if (c > 0) {
        const l = c / maxL
        const inland = smooth(0, 0.3, l)
        const belt = smooth(-0.05, 0.25, mmask[i]) // where mountain belts run
        let h = 0.006 + l * 0.12 + detail[i] * 0.04 * inland
        h += Math.pow(ridge[i], 2.4) * (0.15 + 0.95 * belt) * inland
        elev[i] = Math.max(0.003, h)
      } else {
        const d = c / minO
        elev[i] = -(0.012 + 0.05 * smooth(0, 0.12, d) + 0.75 * smooth(0.08, 0.75, d)) + detail[i] * 0.02 * d
      }
    }

    // Drain closed basins so rivers can reach the sea …
    heapFill(elev, 0, 1e-4)
    // … then dig a few lake basins and fill them with water
    water.fill(0)
    let lakes = 0
    for (let tries = 0; tries < 400 && lakes < 6; tries++) {
      const x = 12 + Math.floor(rnd() * (W - 24))
      const y = 12 + Math.floor(rnd() * (H - 24))
      const i = y * W + x
      if (elev[i] < 0.02 || elev[i] > 0.3) continue
      const r = 3 + rnd() * 4
      let ok = true
      for (let dy = -9; dy <= 9 && ok; dy += 3)
        for (let dx = -9; dx <= 9 && ok; dx += 3) if (elev[(y + dy) * W + x + dx] < 0.006) ok = false
      if (!ok) continue
      const depth = 0.008 + rnd() * 0.02
      for (let dy = -Math.ceil(r); dy <= r; dy++) {
        for (let dx = -Math.ceil(r); dx <= r; dx++) {
          const d2 = (dx * dx + dy * dy) / (r * r)
          if (d2 >= 1) continue
          elev[(y + dy) * W + x + dx] -= depth * (1 - d2) * (1 - d2 * 0.3)
        }
      }
      lakes++
    }
    const filled = heapFill(Float32Array.from(elev), 0, 0)
    for (let i = 0; i < N; i++) {
      const w = filled[i] - elev[i]
      water[i] = elev[i] >= 0 && w > 2e-5 ? w : 0
    }

    state.world = 'random'
    startWorld()
  }

  // Load the real Earth: land heights from NASA-derived topography, ocean
  // depths estimated from distance to the coast (see tools/build_earth_data.py).
  function loadEarth() {
    const D = window.EARTH_DATA
    const bin = atob(D.elev)
    const raw = new Int16Array(N)
    for (let i = 0; i < N; i++) {
      const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)
      raw[i] = v > 32767 ? v - 65536 : v
    }
    const n4 = makePerlin(4242)
    const n5 = makePerlin(4343)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        elev[i] = raw[i] / M_PER_UNIT
        tNoise[i] = fbm(n4, x / 40, y / 40, 3) * 2.5
        texN[i] = fbm(n5, x / 5, y / 5, 2)
      }
    }
    // Lakes: lift each lake to its surface, drain the land, then put the
    // lake bed back and fill it with water.
    const lakes = D.lakes
    for (let k = 0; k < lakes.length; k += 2) elev[lakes[k]] += lakes[k + 1] / M_PER_UNIT
    heapFill(elev, 0, 1e-4)
    water.fill(0)
    for (let k = 0; k < lakes.length; k += 2) {
      const i = lakes[k]
      const surface = elev[i]
      const bed = Math.max(surface - lakes[k + 1] / M_PER_UNIT, 0.0004)
      elev[i] = bed
      water[i] = surface - bed
    }
    state.world = 'earth'
    startWorld()
  }

  function startWorld() {
    tempMod.fill(0)
    rainMod.fill(0)
    flux.fill(0)
    dir.fill(-1)
    seaIce.fill(0)
    snow.fill(0)
    state.year = 0
    state.tickCount = 0
    state.seaLevel = state.seaSlider / M_PER_UNIT
    spinUp()
  }

  // Bring the new world to a plausible starting state so rivers, forests
  // and ice are already in place on the first frame.
  function spinUp() {
    computeClimate()
    temp.set(tempT)
    rain.set(rainT)
    for (let i = 0; i < N; i++) {
      pet[i] = pet_of(temp[i])
      const land = elev[i] >= state.seaLevel
      if (land) {
        snow[i] = temp[i] + summerAmp[i] < -0.5 ? 0.00015 : 0
        veg[i] = vegTarget(i)
        seaIce[i] = 0
      } else {
        seaIce[i] = smooth(-1.8, -9, temp[i])
        veg[i] = 0
      }
    }
    for (let k = 0; k < 170; k++) hydroSubstep()
    for (let i = 0; i < N; i++) if (elev[i] >= state.seaLevel) veg[i] = vegTarget(i)
    state.iceRef = Math.max(50, countIce())
    state.iceNow = state.iceRef
    state.seaTargetM = state.seaSlider
  }

  // ---------------------------------------------------------------------------
  // Climate: temperature and rainfall targets
  // ---------------------------------------------------------------------------
  const latOf = (y) => ((y + 0.5) / H) * 2 - 1 // -1 north pole … +1 south pole
  // Prevailing winds: trade winds blow west between the equator and 30°,
  // westerlies between 30° and 60°, polar easterlies beyond. +1 = toward east.
  const windU = (lat) => -Math.sin(3 * Math.PI * Math.abs(lat))

  function boxBlur(src, r, scratch) {
    // separable box blur, in place on src
    const inv = 1 / (2 * r + 1)
    for (let y = 0; y < H; y++) {
      const row = y * W
      let s = 0
      for (let k = -r; k <= r; k++) s += src[row + clamp(k, 0, W - 1)]
      for (let x = 0; x < W; x++) {
        scratch[row + x] = s * inv
        s += src[row + clamp(x + r + 1, 0, W - 1)] - src[row + clamp(x - r, 0, W - 1)]
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0
      for (let k = -r; k <= r; k++) s += scratch[clamp(k, 0, H - 1) * W + x]
      for (let y = 0; y < H; y++) {
        src[y * W + x] = s * inv
        s += scratch[clamp(y + r + 1, 0, H - 1) * W + x] - scratch[clamp(y - r, 0, H - 1) * W + x]
      }
    }
  }

  function computeClimate() {
    const sea = state.seaLevel
    if (summerAmp[0] === 0) {
      // seasons are stronger toward the poles
      for (let y = 0; y < H; y++) {
        const a = Math.abs(latOf(y))
        for (let x = 0; x < W; x++) summerAmp[y * W + x] = 4 + 14 * a
      }
    }
    const G = state.globalTemp
    // --- temperature: latitude, altitude (lapse rate), ocean moderation
    for (let y = 0; y < H; y++) {
      const lat = latOf(y)
      const Tlat = 27 - 52 * lat * lat
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        const e = elev[i]
        let T
        if (e < sea) {
          // oceans store heat: milder at high latitudes, warm a bit less
          T = Tlat + 3 * lat * lat + G * 0.85
        } else {
          const altKm = ((e - sea) * M_PER_UNIT) / 1000
          T = Tlat - LAPSE * altKm + G
        }
        tempT[i] = T + tempMod[i] + tNoise[i]
      }
    }
    boxBlur(tempT, 1, tmpA)

    // --- rainfall: sweep moist air along the prevailing wind of each row.
    // Air picks up moisture over water, drops it over land, drops much more
    // when forced up mountains, and is dry in their lee (rain shadow).
    const R = state.rainfall
    for (let y = 0; y < H; y++) {
      const lat = latOf(y)
      const a = Math.abs(lat)
      // rising air at the equator (wet), sinking air near 30° (dry), storm
      // tracks near 55° (wet), cold dry poles
      const latF = Math.max(
        0.15,
        0.55 + 1.05 * Math.exp(-((lat / 0.12) ** 2)) - 0.6 * Math.exp(-(((a - 0.33) / 0.09) ** 2)) + 0.5 * Math.exp(-(((a - 0.6) / 0.13) ** 2))
      )
      const wEast = (1 + windU(lat)) / 2
      const scale = 36000 * latF * R
      for (let pass = 0; pass < 2; pass++) {
        const east = pass === 0
        const weight = east ? wEast : 1 - wEast
        if (pass === 0) for (let x = 0; x < W; x++) rainT[y * W + x] = 0
        if (weight < 0.01) continue
        let m = 0.4
        let prevE = sea
        for (let k = 0; k < 2 * W; k++) {
          const x = east ? k % W : W - 1 - (k % W)
          const i = y * W + x
          const e = elev[i]
          const T = tempT[i]
          const cap = 0.5 * Math.exp(0.06 * clamp(T, -40, 45))
          let r
          if (e < sea || water[i] > LAKE_T) {
            m += (cap - m) * 0.12
            r = m * 0.02
            prevE = Math.max(e, sea)
          } else {
            const rise = Math.max(0, e - prevE)
            r = m * Math.min(0.5, 0.02 + rise * 7)
            m -= r
            // soil and plants return part of the rain to the air
            m += r * (0.2 + veg[i] * 0.45)
            prevE = e
          }
          if (k >= W) rainT[i] += r * scale * weight * Math.pow(2, rainMod[i] * 1.6)
        }
      }
    }
    boxBlur(rainT, 2, tmpA)
  }

  // ---------------------------------------------------------------------------
  // Water: rain, snow, melt, evaporation and downhill flow
  // ---------------------------------------------------------------------------
  const NB = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1]
  const NBD = [0.7071, 1, 0.7071, 1, 1, 0.7071, 1, 0.7071]

  function hydroSubstep() {
    const sea = state.seaLevel
    for (let i = 0; i < N; i++) {
      if (elev[i] < sea) {
        water[i] = 0
        snow[i] = 0
        continue
      }
      const T = temp[i]
      const p = rain[i] * RAIN_K
      const sf = smooth(1, -1.5, T) // share falling as snow
      let s = snow[i] + p * sf
      let w = water[i] + p * (1 - sf)
      // seasonal snow melts every summer unless summers stay below freezing
      const Ts = T + summerAmp[i]
      if (Ts > 0 && s > 0) {
        const m = Math.min(s, Ts * MELT_K)
        s -= m
        w += m
      }
      snow[i] = s > SNOW_CAP ? SNOW_CAP : s
      // open water evaporates at the full rate, soil moisture at half
      w -= pet[i] * RAIN_K * (w > LAKE_T ? 1 : 0.5)
      water[i] = w > 0 ? w : 0
    }
    dw.fill(0)
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x
        const w = water[i]
        if (w < 1e-8 || temp[i] < -1) {
          dir[i] = -1
          continue
        }
        const s = elev[i] + w
        let best = -1
        let bestDrop = 0
        let bestS = s
        for (let k = 0; k < 8; k++) {
          const j = i + NB[k]
          const ej = elev[j]
          const sj = ej < sea ? sea : ej + water[j]
          const drop = (s - sj) * NBD[k]
          if (drop > bestDrop) {
            bestDrop = drop
            best = j
            bestS = sj
          }
        }
        if (best >= 0) {
          const amt = Math.min(w, (s - bestS) * 0.5)
          dw[i] -= amt
          dw[best] += amt
          flow[i] = amt
          dir[i] = best
        } else dir[i] = -1
      }
    }
    for (let i = 0; i < N; i++) {
      water[i] += dw[i]
      if (elev[i] < sea) water[i] = 0
      flux[i] = flux[i] * 0.96 + flow[i] * 0.04
      flow[i] = 0
    }
  }

  // ---------------------------------------------------------------------------
  // Ecology
  // ---------------------------------------------------------------------------
  // Effective moisture: rainfall plus water from rivers and lakes
  const peff = (i) =>
    rain[i] + 1500 * smooth(RIVER_MIN * 0.6, RIVER_MIN * 6, flux[i]) + (water[i] > LAKE_T ? 500 : 0)
  const moistureIndex = (i) => peff(i) / pet[i]
  const snowCover = (i) => smooth(0, 0.000018, snow[i])

  function vegTarget(i) {
    const T = temp[i]
    const M = moistureIndex(i)
    return (
      smooth(0.08, 0.6, M) * // enough water?
      smooth(-17, -8, T) * // warm enough to grow?
      (1 - smooth(38, 52, T)) * // too hot?
      (1 - 0.6 * (1 - smooth(-12, -5, T))) * // tundra stays sparse
      (1 - snowCover(i) * 0.85) *
      (1 - smooth(3800, 5200, (elev[i] - state.seaLevel) * M_PER_UNIT))
    )
  }

  function countIce() {
    let n = 0
    for (let i = 0; i < N; i++) if (elev[i] >= state.seaLevel && snow[i] > ICE_SWE) n++
    return n
  }

  // ---------------------------------------------------------------------------
  // One simulation tick
  // ---------------------------------------------------------------------------
  function tick() {
    state.tickCount++
    // sea level: slider + thermal expansion + water released from (or locked
    // into) land ice. Melting all land ice raises the sea by roughly 70 m.
    if (state.tickCount % 4 === 0) state.iceNow = countIce()
    if (state.tickCount < 80) state.iceRef = Math.max(50, state.iceNow)
    const iceTerm = clamp(70 * (1 - state.iceNow / state.iceRef), -130, 70)
    state.seaTargetM = state.seaSlider + 0.6 * state.globalTemp + iceTerm
    state.seaLevel += (state.seaTargetM / M_PER_UNIT - state.seaLevel) * 0.04

    if (state.tickCount % 2 === 0) computeClimate()
    for (let i = 0; i < N; i++) {
      temp[i] += (tempT[i] - temp[i]) * 0.1
      rain[i] += (rainT[i] - rain[i]) * 0.1
      pet[i] = pet_of(temp[i])
    }
    for (let s = 0; s < SUBSTEPS; s++) hydroSubstep()

    const sea = state.seaLevel
    for (let i = 0; i < N; i++) {
      if (elev[i] < sea) {
        veg[i] *= 0.9
        seaIce[i] += (smooth(-1.8, -9, temp[i]) - seaIce[i]) * 0.04
        continue
      }
      seaIce[i] = 0
      if (state.tickCount % 2) veg[i] += (vegTarget(i) - veg[i]) * 0.05
      // slow river erosion carves valleys (never below the next cell downstream)
      const f = flux[i]
      const d = dir[i]
      if (f > 1.8e-5 && d >= 0) {
        const ne = elev[i] - 2.5e-6 * Math.min(f / 1.8e-5, 4)
        if (ne > elev[d] + 1e-5 && ne > sea + 0.001) elev[i] = ne
      }
    }
    state.year += YEARS_PER_TICK
    state.simTime += 1 / TICKS_PER_SEC
  }

  // ---------------------------------------------------------------------------
  // Biomes and colours
  // ---------------------------------------------------------------------------
  const VEG = {
    trop: [[0.15, 186, 172, 92], [0.45, 152, 160, 70], [0.8, 96, 140, 56], [1.3, 50, 114, 46], [2.0, 27, 86, 40]],
    temp: [[0.2, 172, 170, 104], [0.5, 136, 170, 88], [0.85, 80, 136, 64], [1.4, 50, 110, 58], [2.2, 34, 90, 56]],
    bor: [[0.25, 142, 150, 104], [0.6, 72, 110, 76], [1.2, 44, 86, 66]],
    tun: [[0.2, 140, 142, 112], [0.8, 120, 134, 104]],
  }
  const BARE = {
    trop: [[0.05, 228, 198, 140], [0.3, 210, 170, 112], [0.8, 172, 134, 92]],
    temp: [[0.1, 216, 194, 150], [0.5, 186, 164, 122], [1.0, 152, 132, 102]],
    bor: [[0.2, 170, 162, 142], [1, 140, 130, 112]],
    tun: [[0.3, 172, 168, 154], [1, 152, 150, 140]],
  }
  const OCEAN = [[0, 104, 192, 202], [60, 66, 162, 192], [250, 40, 122, 174], [1500, 22, 76, 132], [5000, 12, 40, 88]]
  const TEMP_RAMP = [[-35, 44, 44, 124], [-20, 60, 94, 192], [-8, 112, 166, 226], [0, 218, 236, 246], [10, 242, 226, 142], [20, 246, 172, 82], [30, 226, 96, 56], [42, 160, 32, 42]]
  const RAIN_RAMP = [[0, 166, 116, 66], [200, 214, 186, 112], [500, 202, 212, 122], [1000, 112, 182, 102], [1800, 42, 142, 112], [2800, 40, 102, 172], [4200, 56, 62, 156]]
  const ELEV_LAND = [[0, 72, 142, 82], [300, 132, 172, 92], [1000, 204, 192, 112], [2000, 172, 132, 90], [3500, 142, 122, 112], [5000, 246, 246, 246]]
  const ELEV_SEA = [[0, 150, 210, 236], [500, 84, 150, 210], [2500, 40, 92, 168], [5000, 20, 44, 104]]
  const SNOW_RGB = [240, 245, 250]
  const ROCK_RGB = [130, 120, 110]
  const LAKE = [[0, 84, 154, 196], [120, 34, 96, 154]]

  const cA = [0, 0, 0]
  const cB = [0, 0, 0]
  const cC = [0, 0, 0]
  function bandMix(table, M, w, acc) {
    if (w <= 0) return
    ramp(table, M, cC)
    acc[0] += cC[0] * w
    acc[1] += cC[1] * w
    acc[2] += cC[2] * w
  }
  // Land colour from temperature, moisture and actual vegetation cover
  function landColor(i, out) {
    const T = temp[i]
    const M = moistureIndex(i)
    const v = veg[i]
    const a = smooth(-12, -5, T)
    const b = smooth(1, 8, T)
    const c = smooth(16, 23, T)
    const wTun = 1 - a
    const wBor = a - b
    const wTem = b - c
    const wTro = c
    cA[0] = cA[1] = cA[2] = 0
    cB[0] = cB[1] = cB[2] = 0
    bandMix(VEG.tun, M, wTun, cA)
    bandMix(VEG.bor, M, wBor, cA)
    bandMix(VEG.temp, M, wTem, cA)
    bandMix(VEG.trop, M, wTro, cA)
    bandMix(BARE.tun, M, wTun, cB)
    bandMix(BARE.bor, M, wBor, cB)
    bandMix(BARE.temp, M, wTem, cB)
    bandMix(BARE.trop, M, wTro, cB)
    out[0] = lerp(cB[0], cA[0], v)
    out[1] = lerp(cB[1], cA[1], v)
    out[2] = lerp(cB[2], cA[2], v)
    const alt = (elev[i] - state.seaLevel) * M_PER_UNIT
    const rock = smooth(2400, 4200, alt) * (1 - v * 0.6)
    out[0] = lerp(out[0], ROCK_RGB[0], rock)
    out[1] = lerp(out[1], ROCK_RGB[1], rock)
    out[2] = lerp(out[2], ROCK_RGB[2], rock)
    const sc = snowCover(i)
    out[0] = lerp(out[0], SNOW_RGB[0], sc)
    out[1] = lerp(out[1], SNOW_RGB[1], sc)
    out[2] = lerp(out[2], SNOW_RGB[2], sc)
    return out
  }

  function biomeName(i) {
    const sea = state.seaLevel
    const T = temp[i]
    if (elev[i] < sea) {
      if (seaIce[i] > 0.5) return 'Sea ice'
      return (sea - elev[i]) * M_PER_UNIT < 200 ? 'Shallow sea' : 'Ocean'
    }
    if (water[i] > LAKE_T) return T < -2 ? 'Frozen lake' : 'Lake'
    if (flux[i] > RIVER_MIN * 1.5 && T > -1) return 'River'
    const sc = snowCover(i)
    if (sc > 0.6) return T < -8 ? 'Ice sheet' : 'Snowfield'
    const alt = (elev[i] - sea) * M_PER_UNIT
    if (alt > 3000 && veg[i] < 0.35) return 'Alpine rock'
    const M = moistureIndex(i)
    if (T < -9) return 'Tundra'
    if (T < 4) return M > 0.45 ? 'Taiga' : 'Cold steppe'
    if (T < 18) {
      if (M < 0.2) return 'Cold desert'
      if (M < 0.55) return 'Grassland'
      if (M < 1.6) return 'Temperate forest'
      return 'Temperate rainforest'
    }
    if (M < 0.2) return 'Hot desert'
    if (M < 0.55) return 'Savanna'
    if (M < 1.15) return 'Tropical dry forest'
    return 'Tropical rainforest'
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('map')
  const ctx = canvas.getContext('2d')
  // The base map is drawn at twice the grid resolution. Colours, shading and a
  // signed "wetness" value are interpolated between cells, so coastlines and
  // lake shores come out smooth instead of blocky.
  const SS = 2
  const BW = W * SS
  const BH = H * SS
  const baseCanvas = document.createElement('canvas')
  baseCanvas.width = BW
  baseCanvas.height = BH
  const baseCtx = baseCanvas.getContext('2d')
  const baseImg = baseCtx.createImageData(BW, BH)
  const px = baseImg.data
  const landR = new Float32Array(N)
  const landG = new Float32Array(N)
  const landB = new Float32Array(N)
  const watR = new Float32Array(N)
  const watG = new Float32Array(N)
  const watB = new Float32Array(N)
  const wetF = new Float32Array(N) // > 0 water, < 0 land
  const shadeF = new Float32Array(N)
  // per-column interpolation lookups for the 2× image
  const colX0 = new Int32Array(BW)
  const colTX = new Float32Array(BW)
  for (let X = 0; X < BW; X++) {
    const fx = clamp((X + 0.5) / SS - 0.5, 0, W - 1.001)
    colX0[X] = fx | 0
    colTX[X] = fx - colX0[X]
  }
  // alpha never changes: fill it once
  for (let k = 3; k < BW * BH * 4; k += 4) px[k] = 255

  const CW = 216
  const CH = 108
  const cloudCanvas = document.createElement('canvas')
  cloudCanvas.width = CW
  cloudCanvas.height = CH
  const cloudCtx = cloudCanvas.getContext('2d')
  const cloudImg = cloudCtx.createImageData(CW, CH)
  const shadowCanvas = document.createElement('canvas')
  shadowCanvas.width = CW
  shadowCanvas.height = CH
  const shadowCtx = shadowCanvas.getContext('2d')
  const shadowImg = shadowCtx.createImageData(CW, CH)
  const cloudNoise = makePerlin(777)

  const col = [0, 0, 0]
  const col2 = [0, 0, 0]

  function paintBase() {
    const sea = state.seaLevel
    const view = state.view
    // --- pass 1: per-cell colours
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        const e = elev[i]
        const ocean = e < sea
        // hillshade from the north-west
        const xl = x > 0 ? i - 1 : i
        const xr = x < W - 1 ? i + 1 : i
        const yu = y > 0 ? i - W : i
        const yd = y < H - 1 ? i + W : i
        const slope = elev[xl] - elev[xr] + elev[yu] - elev[yd]
        shadeF[i] = clamp(1 + slope * (ocean ? 1.6 : 7) + (ocean ? 0 : texN[i] * 0.09), 0.6, 1.35)
        const w = water[i]
        const lake = !ocean && w > LAKE_T

        if (view === 'biome') {
          if (ocean) {
            ramp(OCEAN, (sea - e) * M_PER_UNIT, col2)
            const ice = smooth(0, 1, seaIce[i])
            col2[0] = lerp(col2[0], 226, ice)
            col2[1] = lerp(col2[1], 236, ice)
            col2[2] = lerp(col2[2], 244, ice)
            // a land colour is only needed near the coast, where they blend
            if ((sea - e) * M_PER_UNIT < 80) landColor(i, col)
            else {
              col[0] = col2[0]
              col[1] = col2[1]
              col[2] = col2[2]
            }
          } else {
            landColor(i, col)
            if (lake) {
              ramp(LAKE, w * M_PER_UNIT, col2)
              const frozen = smooth(-1, -6, temp[i])
              col2[0] = lerp(col2[0], 214, frozen)
              col2[1] = lerp(col2[1], 230, frozen)
              col2[2] = lerp(col2[2], 240, frozen)
            } else ramp(OCEAN, 0, col2)
          }
        } else if (view === 'temp') {
          ramp(TEMP_RAMP, temp[i], col)
          col2[0] = col[0] * 0.72
          col2[1] = col[1] * 0.72
          col2[2] = col[2] * 0.78
        } else if (view === 'rain') {
          ramp(RAIN_RAMP, rain[i], col)
          col2[0] = col[0] * 0.35 + 10
          col2[1] = col[1] * 0.35 + 16
          col2[2] = col[2] * 0.35 + 34
        } else {
          ramp(ELEV_LAND, Math.max(0, e - sea) * M_PER_UNIT, col)
          if (lake) ramp(ELEV_SEA, 0, col2)
          else ramp(ELEV_SEA, Math.max(0, sea - e) * M_PER_UNIT, col2)
        }
        const sh = shadeF[i]
        const shw = 0.6 + sh * 0.4
        landR[i] = col[0] * sh
        landG[i] = col[1] * sh
        landB[i] = col[2] * sh
        watR[i] = col2[0] * shw
        watG[i] = col2[1] * shw
        watB[i] = col2[2] * shw
        if (ocean) wetF[i] = Math.min(3, ((sea - e) * M_PER_UNIT) / 25 + 0.4)
        else if (lake) wetF[i] = clamp((w / LAKE_T - 1) * 1.5, -1, 3)
        else wetF[i] = Math.max(-3, -((e - sea) * M_PER_UNIT) / 25 - 0.4)
      }
    }
    // soften cell-to-cell steps in land colour (rivers stay crisp as vectors)
    if (view === 'biome') {
      boxBlur(landR, 1, tmpA)
      boxBlur(landG, 1, tmpA)
      boxBlur(landB, 1, tmpA)
    }
    // --- pass 2: interpolate onto the finer image
    for (let Y = 0; Y < BH; Y++) {
      const fy = clamp((Y + 0.5) / SS - 0.5, 0, H - 1.001)
      const y0 = fy | 0
      const ty = fy - y0
      const rowK = Y * BW * 4
      for (let X = 0; X < BW; X++) {
        const x0 = colX0[X]
        const tx = colTX[X]
        const a = y0 * W + x0
        const b = a + 1
        const c = a + W
        const d = c + 1
        const wa = (1 - tx) * (1 - ty)
        const wb = tx * (1 - ty)
        const wc = (1 - tx) * ty
        const wd = tx * ty
        const wet = wetF[a] * wa + wetF[b] * wb + wetF[c] * wc + wetF[d] * wd
        const k = rowK + X * 4
        if (wet >= 0.25) {
          px[k] = watR[a] * wa + watR[b] * wb + watR[c] * wc + watR[d] * wd
          px[k + 1] = watG[a] * wa + watG[b] * wb + watG[c] * wc + watG[d] * wd
          px[k + 2] = watB[a] * wa + watB[b] * wb + watB[c] * wc + watB[d] * wd
        } else if (wet <= -0.25) {
          px[k] = landR[a] * wa + landR[b] * wb + landR[c] * wc + landR[d] * wd
          px[k + 1] = landG[a] * wa + landG[b] * wb + landG[c] * wc + landG[d] * wd
          px[k + 2] = landB[a] * wa + landB[b] * wb + landB[c] * wc + landB[d] * wd
        } else {
          const t = smooth(-0.25, 0.25, wet)
          px[k] = lerp(landR[a] * wa + landR[b] * wb + landR[c] * wc + landR[d] * wd, watR[a] * wa + watR[b] * wb + watR[c] * wc + watR[d] * wd, t)
          px[k + 1] = lerp(landG[a] * wa + landG[b] * wb + landG[c] * wc + landG[d] * wd, watG[a] * wa + watG[b] * wb + watG[c] * wc + watG[d] * wd, t)
          px[k + 2] = lerp(landB[a] * wa + landB[b] * wb + landB[c] * wc + landB[d] * wd, watB[a] * wa + watB[b] * wb + watB[c] * wc + watB[d] * wd, t)
        }
      }
    }
    baseCtx.putImageData(baseImg, 0, 0)
  }

  // Rivers are traced into polylines and drawn as vectors so they stay crisp
  // when zoomed. Width grows with the amount of water they carry.
  const RIVER_BUCKETS = 6
  let riverPaths = []
  let riverAll = null
  const isRiver = new Uint8Array(N)
  const hasUp = new Uint8Array(N)
  const traced = new Uint8Array(N)
  function buildRivers() {
    const sea = state.seaLevel
    isRiver.fill(0)
    hasUp.fill(0)
    traced.fill(0)
    for (let i = 0; i < N; i++) {
      if (flux[i] > RIVER_MIN && elev[i] >= sea && water[i] < LAKE_T && dir[i] >= 0) isRiver[i] = 1
    }
    for (let i = 0; i < N; i++) if (isRiver[i] && isRiver[dir[i]]) hasUp[dir[i]] = 1
    const buckets = Array.from({ length: RIVER_BUCKETS }, () => new Path2D())
    const all = new Path2D()
    const bucketOf = (f) => Math.min(RIVER_BUCKETS - 1, Math.floor(clamp(Math.log10(f / RIVER_MIN) / 1.6, 0, 0.999) * RIVER_BUCKETS))
    const cx = (i) => (i % W) + 0.5
    const cy = (i) => ((i / W) | 0) + 0.5
    // Each river is followed downstream from its source. The path runs
    // through the midpoints between cells with curves bending at the cell
    // centres, which smooths the 8-direction grid into natural meanders.
    const pts = []
    for (let src = 0; src < N; src++) {
      if (!isRiver[src] || hasUp[src]) continue
      pts.length = 0
      let cur = src
      traced[cur] = 1
      pts.push(cur)
      for (let guard = 0; guard < 2000; guard++) {
        const nx = dir[cur]
        if (nx < 0) break
        pts.push(nx)
        if (!isRiver[nx] || traced[nx]) break
        traced[nx] = 1
        cur = nx
      }
      if (pts.length < 2) continue
      let mx = cx(pts[0])
      let my = cy(pts[0])
      all.moveTo(mx, my)
      for (let k = 1; k < pts.length; k++) {
        const p = pts[k]
        const last = k === pts.length - 1
        const ex = last ? cx(p) : (cx(p) + cx(pts[k + 1])) / 2
        const ey = last ? cy(p) : (cy(p) + cy(pts[k + 1])) / 2
        const path = buckets[bucketOf(flux[pts[k - 1]])]
        path.moveTo(mx, my)
        path.quadraticCurveTo(cx(p), cy(p), ex, ey)
        all.quadraticCurveTo(cx(p), cy(p), ex, ey)
        mx = ex
        my = ey
      }
    }
    riverPaths = buckets
    riverAll = all
  }

  function paintClouds() {
    const t = state.simTime
    const humid = state.rainfall
    const cd = cloudImg.data
    const sd = shadowImg.data
    for (let cy = 0; cy < CH; cy++) {
      const y = ((cy + 0.5) / CH) * H
      const lat = (y / H) * 2 - 1
      const u = windU(lat) * (1 - smooth(0.85, 1, Math.abs(lat)) * 0.7)
      const gy = Math.min(H - 1, y | 0)
      for (let cx = 0; cx < CW; cx++) {
        const x = ((cx + 0.5) / CW) * W
        const gx = Math.min(W - 1, x | 0)
        const r = rain[gy * W + gx]
        const n = fbm(cloudNoise, (x - u * t * 2.2) / 20, y / 13 + t * 0.004, 4)
        const v = n + smooth(150, 2600, r) * 0.38 - 0.16 + (humid - 1) * 0.08
        const a = smooth(0.04, 0.38, v) * 0.42
        const k = (cy * CW + cx) * 4
        cd[k] = cd[k + 1] = cd[k + 2] = 255
        cd[k + 3] = a * 255
        sd[k] = 4
        sd[k + 1] = 10
        sd[k + 2] = 26
        sd[k + 3] = a * 0.22 * 255
      }
    }
    cloudCtx.putImageData(cloudImg, 0, 0)
    shadowCtx.putImageData(shadowImg, 0, 0)
  }

  // ---------------------------------------------------------------------------
  // View (zoom & pan)
  // ---------------------------------------------------------------------------
  const view = { s: 3, ox: 0, oy: 0, ts: 3, ax: 0, ay: 0, wx: 0, wy: 0, fit: 3 }
  let dpr = 1
  function mapRegion() {
    const cw = canvas.clientWidth
    const ch = canvas.clientHeight
    if (window.innerWidth <= 860) return { x: 8, y: 8, w: cw - 16, h: ch - 16 }
    return { x: 16, y: 86, w: cw - 16 - 340, h: ch - 86 - 96 }
  }
  function fitView() {
    const r = mapRegion()
    const s = Math.min(r.w / W, r.h / H)
    view.fit = s
    view.s = view.ts = s
    view.ox = r.x + (r.w - W * s) / 2
    view.oy = r.y + (r.h - H * s) / 2
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(canvas.clientWidth * dpr)
    canvas.height = Math.round(canvas.clientHeight * dpr)
    fitView()
  }
  const toWorld = (sx, sy) => [(sx - view.ox) / view.s, (sy - view.oy) / view.s]
  function zoomAt(sx, sy, factor) {
    view.ts = clamp(view.ts * factor, view.fit * 0.7, view.fit * 7)
    view.ax = sx
    view.ay = sy
    const [wx, wy] = toWorld(sx, sy)
    view.wx = wx
    view.wy = wy
  }
  function clampPan() {
    const cw = canvas.clientWidth
    const ch = canvas.clientHeight
    const mw = W * view.s
    const mh = H * view.s
    view.ox = clamp(view.ox, Math.min(60 - mw, cw - mw - 60), Math.max(cw - 60, 60))
    view.oy = clamp(view.oy, Math.min(60 - mh, ch - mh - 60), Math.max(ch - 60, 60))
  }

  // ---------------------------------------------------------------------------
  // Drawing a frame
  // ---------------------------------------------------------------------------
  const pointer = { x: -1, y: -1, inside: false, painting: false, panning: false }
  const BRUSH_COLORS = {
    raise: '#f37064',
    lower: '#6fa8ff',
    water: '#5fd3f3',
    temp: ['#ff8a5c', '#7cc0ff'],
    rain: ['#6fe0a0', '#e0b26f'],
  }

  function draw() {
    const cw = canvas.width
    const ch = canvas.height
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#0b1120'
    ctx.fillRect(0, 0, cw, ch)
    // map in world coordinates
    ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.ox, dpr * view.oy)
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = 30 * dpr
    ctx.fillStyle = '#0d1a33'
    ctx.fillRect(0, 0, W, H)
    ctx.shadowBlur = 0
    ctx.shadowColor = 'transparent'
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(baseCanvas, 0, 0, W, H)

    if (state.view === 'biome' && riverAll) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, W, H)
      ctx.clip()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = 'rgb(58,136,204)'
      for (let b = 0; b < RIVER_BUCKETS; b++) {
        ctx.lineWidth = 0.3 + b * 0.22
        ctx.stroke(riverPaths[b])
      }
      // flowing highlights
      ctx.strokeStyle = 'rgba(205,238,255,0.4)'
      ctx.lineWidth = 0.16
      ctx.setLineDash([0.35, 2.4])
      ctx.lineDashOffset = -state.simTime * 6
      ctx.stroke(riverAll)
      ctx.setLineDash([])
      ctx.restore()
    }
    // clouds and their shadows
    if (state.view === 'biome') {
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, W, H)
      ctx.clip()
      ctx.drawImage(shadowCanvas, 1.6, 2.2, W, H)
      ctx.drawImage(cloudCanvas, 0, 0, W, H)
      ctx.restore()
    }
    // frame
    ctx.lineWidth = 1 / view.s
    ctx.strokeStyle = 'rgba(160,180,230,0.25)'
    ctx.strokeRect(0, 0, W, H)

    // brush cursor
    if (pointer.inside && state.tool !== 'pan' && !pointer.panning) {
      const [wx, wy] = toWorld(pointer.x, pointer.y)
      let c = BRUSH_COLORS[state.tool]
      if (Array.isArray(c)) c = state.polarity > 0 ? c[0] : c[1]
      ctx.beginPath()
      ctx.arc(wx, wy, state.brush, 0, Math.PI * 2)
      ctx.lineWidth = 2 / view.s
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'
      ctx.stroke()
      ctx.lineWidth = 1.2 / view.s
      ctx.strokeStyle = c
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(wx, wy, 1.5 / view.s, 0, Math.PI * 2)
      ctx.fillStyle = c
      ctx.fill()
    }
  }

  // ---------------------------------------------------------------------------
  // Editing brush
  // ---------------------------------------------------------------------------
  function applyBrush(dt) {
    const [wx, wy] = toWorld(pointer.x, pointer.y)
    const r = state.brush
    const x0 = Math.max(0, Math.floor(wx - r))
    const x1 = Math.min(W - 1, Math.ceil(wx + r))
    const y0 = Math.max(0, Math.floor(wy - r))
    const y1 = Math.min(H - 1, Math.ceil(wy + r))
    const sea = state.seaLevel
    const tool = state.tool
    const pol = state.polarity
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - wx
        const dy = y + 0.5 - wy
        const d2 = (dx * dx + dy * dy) / (r * r)
        if (d2 >= 1) continue
        const f = (1 - d2) * (1 - d2)
        const i = y * W + x
        if (tool === 'raise') elev[i] = Math.min(1.3, elev[i] + 0.09 * dt * f)
        else if (tool === 'lower') elev[i] = Math.max(-1, elev[i] - 0.09 * dt * f)
        else if (tool === 'water') {
          if (elev[i] >= sea) water[i] += 0.03 * dt * f
        } else if (tool === 'temp') tempMod[i] = clamp(tempMod[i] + pol * 16 * dt * f, -25, 25)
        else if (tool === 'rain') rainMod[i] = clamp(rainMod[i] + pol * 1.3 * dt * f, -1, 1)
      }
    }
    needsPaint = true
    if (state.paused) {
      // show the immediate result of the edit while time stands still
      computeClimate()
      temp.set(tempT)
      rain.set(rainT)
      for (let i = 0; i < N; i++) pet[i] = pet_of(temp[i])
    }
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  let needsPaint = true
  let last = performance.now()
  let tickAcc = 0
  let riversDirty = true
  let cloudFrame = 0
  let statTimer = 0
  let paintTimer = 1
  // rolling average cost of each stage in ms (inspect with earth.perf in the console)
  const perf = { tick: 0, paint: 0, clouds: 0, rivers: 0, draw: 0 }
  const timed = (key, fn) => {
    const t0 = performance.now()
    fn()
    perf[key] = perf[key] * 0.9 + (performance.now() - t0) * 0.1
  }

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (!state.paused) {
      tickAcc += dt * TICKS_PER_SEC * SPEEDS[state.speedIdx]
      let n = Math.min(Math.floor(tickAcc), 2)
      tickAcc -= Math.floor(tickAcc)
      while (n-- > 0) {
        timed('tick', tick)
        needsPaint = true
        riversDirty = true
      }
    }
    if (pointer.painting) applyBrush(dt)
    paintTimer += dt
    if (needsPaint && (paintTimer > 0.08 || pointer.painting)) {
      timed('paint', paintBase)
      needsPaint = false
      paintTimer = 0
    }
    if (riversDirty) {
      timed('rivers', buildRivers)
      riversDirty = false
    }
    if (!state.paused || cloudFrame === 0) {
      if (cloudFrame++ % 2 === 0) timed('clouds', paintClouds)
    }
    // smooth zoom toward the target scale, keeping the anchor point fixed
    if (Math.abs(view.ts - view.s) > 1e-4) {
      view.s += (view.ts - view.s) * Math.min(1, dt * 12)
      view.ox = view.ax - view.wx * view.s
      view.oy = view.ay - view.wy * view.s
      clampPan()
    }
    timed('draw', draw)
    statTimer += dt
    if (statTimer > 0.4) {
      statTimer = 0
      updateStats()
      updateInspector()
    }
    yearEl.textContent = state.year.toLocaleString()
    requestAnimationFrame(frame)
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id)
  const yearEl = $('year')
  const toastEl = $('toast')
  let toastTimer = 0
  function toast(msg) {
    toastEl.textContent = msg
    toastEl.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200)
  }

  const fmtSigned = (v, d = 0, unit = '') => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}${unit}`

  function bindRange(id, onInput) {
    const el = $(id)
    el.addEventListener('input', () => onInput(Number(el.value)))
    return el
  }
  bindRange('globalTemp', (v) => {
    state.globalTemp = v
    $('globalTempOut').textContent = fmtSigned(v, 1, ' °C')
  })
  bindRange('rainfall', (v) => {
    state.rainfall = v / 100
    $('rainfallOut').textContent = `${v}%`
  })
  bindRange('seaLevel', (v) => {
    state.seaSlider = v
    $('seaLevelOut').textContent = fmtSigned(v, 0, ' m')
  })
  bindRange('speed', (v) => {
    state.speedIdx = v
    $('speedOut').textContent = `${SPEEDS[v]}×`
  })
  bindRange('brush', (v) => {
    state.brush = v
    $('brushOut').textContent = v
  })

  const playBtn = $('playBtn')
  function setPaused(p) {
    state.paused = p
    playBtn.classList.toggle('paused', p)
    playBtn.querySelector('span').textContent = p ? 'Play' : 'Pause'
    const rs = $('runState')
    rs.textContent = p ? 'Paused' : 'Running'
    rs.classList.toggle('paused', p)
  }
  playBtn.addEventListener('click', () => setPaused(!state.paused))

  function resetControls() {
    const defaults = { globalTemp: 0, rainfall: 100, seaLevel: 0 }
    for (const [id, v] of Object.entries(defaults)) {
      const el = $(id)
      el.value = v
      el.dispatchEvent(new Event('input'))
    }
  }
  const loadingEl = $('loading')
  function rebuild(seed, message) {
    loadingEl.classList.remove('hide')
    // let the overlay paint before the heavy work starts
    requestAnimationFrame(() =>
      setTimeout(() => {
        if (seed === 'earth') loadEarth()
        else generate(seed)
        updateWorldButtons()
        needsPaint = true
        riversDirty = true
        cloudFrame = 0
        loadingEl.classList.add('hide')
        if (message) toast(message)
      }, 20)
    )
  }
  $('newWorldBtn').addEventListener('click', () => {
    resetControls()
    rebuild(Math.floor(Math.random() * 1e9), 'A new random world has formed.')
  })
  $('earthBtn').addEventListener('click', () => {
    resetControls()
    rebuild('earth', 'Loaded the real Earth.')
  })
  $('resetBtn').addEventListener('click', () => {
    resetControls()
    rebuild(state.world === 'earth' ? 'earth' : state.seed, 'World reset to how it began.')
  })
  function updateWorldButtons() {
    $('earthBtn').classList.toggle('on', state.world === 'earth')
    $('newWorldBtn').classList.toggle('on', state.world === 'random')
  }

  // tools
  const TOOL_HINTS = {
    pan: 'Drag to move the map. Scroll to zoom.',
    raise: 'Drag to raise land. Push the sea floor up to make islands.',
    lower: 'Drag to dig valleys and basins. Dig below sea level to let the ocean in.',
    water: 'Drag to pour water. It runs downhill and pools in low ground.',
    temp: 'Showing temperature. Paint to warm or cool a region, then switch to Biomes to watch it respond.',
    rain: 'Showing rainfall. Paint to make a region wetter or drier, then switch to Biomes to watch it respond.',
  }
  const toolButtons = [...document.querySelectorAll('#tools button')]
  const polarityEl = $('polarity')
  function setTool(tool) {
    state.tool = tool
    toolButtons.forEach((b) => b.classList.toggle('on', b.dataset.tool === tool))
    canvas.classList.toggle('pan-tool', tool === 'pan')
    const polar = tool === 'temp' || tool === 'rain'
    polarityEl.hidden = !polar
    if (polar) {
      $('polPlus').textContent = tool === 'temp' ? 'Warmer' : 'Wetter'
      $('polMinus').textContent = tool === 'temp' ? 'Colder' : 'Drier'
      setView(tool)
    }
    toast(TOOL_HINTS[tool])
  }
  toolButtons.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)))
  const polButtons = [...polarityEl.querySelectorAll('button')]
  function setPolarity(p) {
    state.polarity = p
    polButtons.forEach((b) => b.classList.toggle('on', Number(b.dataset.pol) === p))
  }
  polButtons.forEach((b) => b.addEventListener('click', () => setPolarity(Number(b.dataset.pol))))

  // map views + legend
  const viewButtons = [...document.querySelectorAll('#viewSeg button')]
  const BIOME_LEGEND = [
    ['Ocean', 'rgb(40,122,174)'],
    ['Lake & river', 'rgb(52,128,190)'],
    ['Rainforest', 'rgb(27,86,40)'],
    ['Tropical forest', 'rgb(96,140,56)'],
    ['Savanna', 'rgb(186,172,92)'],
    ['Hot desert', 'rgb(228,198,140)'],
    ['Temperate forest', 'rgb(80,136,64)'],
    ['Grassland', 'rgb(136,170,88)'],
    ['Taiga', 'rgb(72,110,76)'],
    ['Tundra', 'rgb(140,142,112)'],
    ['Mountain rock', 'rgb(130,120,110)'],
    ['Snow & ice', 'rgb(240,245,250)'],
  ]
  function gradientCss(stops, from, to) {
    const parts = stops.map(([v]) => {
      const pct = ((v - from) / (to - from)) * 100
      return `${rampCss(stops, v)} ${clamp(pct, 0, 100).toFixed(1)}%`
    })
    return `linear-gradient(90deg, ${parts.join(', ')})`
  }
  function renderLegend() {
    const el = $('legend')
    if (state.view === 'biome') {
      el.innerHTML = BIOME_LEGEND.map(
        ([name, c]) => `<div class="item"><span class="sw" style="background:${c}"></span>${name}</div>`
      ).join('')
    } else if (state.view === 'temp') {
      el.innerHTML = `<div class="bar" style="background:${gradientCss(TEMP_RAMP, -35, 42)}"></div>
        <div class="ticks"><span>−35 °C</span><span>0 °C</span><span>+20 °C</span><span>+42 °C</span></div>`
    } else if (state.view === 'rain') {
      el.innerHTML = `<div class="bar" style="background:${gradientCss(RAIN_RAMP, 0, 4200)}"></div>
        <div class="ticks"><span>0</span><span>1,000</span><span>2,500</span><span>4,200 mm/yr</span></div>`
    } else {
      el.innerHTML = `<div class="bar" style="background:linear-gradient(90deg, ${rampCss(ELEV_SEA, 5000)}, ${rampCss(ELEV_SEA, 0)} 49%, ${rampCss(ELEV_LAND, 0)} 51%, ${rampCss(ELEV_LAND, 1000)} 65%, ${rampCss(ELEV_LAND, 2500)} 82%, ${rampCss(ELEV_LAND, 5000)})"></div>
        <div class="ticks"><span>−5 km</span><span>sea level</span><span>+5 km</span></div>`
    }
  }
  function setView(v) {
    state.view = v
    viewButtons.forEach((b) => b.classList.toggle('on', b.dataset.view === v))
    renderLegend()
    needsPaint = true
  }
  viewButtons.forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)))

  // stats
  function updateStats() {
    const sea = state.seaLevel
    let tSum = 0
    let wSum = 0
    let land = 0
    let forest = 0
    let desert = 0
    let ice = 0
    let wet = 0
    for (let y = 0; y < H; y++) {
      const wLat = Math.cos(latOf(y) * Math.PI * 0.5)
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        tSum += temp[i] * wLat
        wSum += wLat
        if (elev[i] < sea) {
          if (seaIce[i] > 0.5) ice++
          continue
        }
        land++
        const sc = snowCover(i)
        if (sc > 0.5) {
          ice++
          continue
        }
        if (water[i] > LAKE_T || flux[i] > RIVER_MIN) wet++
        if (veg[i] > 0.55 && temp[i] > -9) forest++
        else if (veg[i] < 0.15 && temp[i] > 0 && moistureIndex(i) < 0.25) desert++
      }
    }
    const pct = (a, b) => `${b ? Math.round((a / b) * 100) : 0}%`
    $('statTemp').textContent = `${(tSum / wSum).toFixed(1)} °C`
    $('statLand').textContent = pct(land, N)
    $('statForest').textContent = pct(forest, land)
    $('statDesert').textContent = pct(desert, land)
    $('statIce').textContent = pct(ice, N)
    $('statWater').textContent = pct(wet, land)
    const actual = state.seaLevel * M_PER_UNIT
    const iceTerm = state.seaTargetM - state.seaSlider - 0.6 * state.globalTemp
    let why = ''
    if (Math.abs(iceTerm) >= 1) why = ` · ${iceTerm > 0 ? 'melting ice' : 'growing ice'} ${fmtSigned(iceTerm, 0, ' m')}`
    $('seaNote').textContent = `Actual sea level: ${fmtSigned(Math.round(actual), 0, ' m')}${why}`
  }

  // inspector
  function updateInspector() {
    if (!pointer.inside) return
    const [wx, wy] = toWorld(pointer.x, pointer.y)
    const x = Math.floor(wx)
    const y = Math.floor(wy)
    if (x < 0 || y < 0 || x >= W || y >= H) {
      $('inspBiome').textContent = 'Hover over the map'
      return
    }
    const i = y * W + x
    const sea = state.seaLevel
    $('inspBiome').textContent = biomeName(i)
    const latDeg = 90 - ((y + 0.5) / H) * 180
    const lonDeg = ((x + 0.5) / W) * 360 - 180
    $('inspLoc').textContent = `${Math.abs(latDeg).toFixed(0)}°${latDeg >= 0 ? 'N' : 'S'}, ${Math.abs(lonDeg).toFixed(0)}°${lonDeg >= 0 ? 'E' : 'W'}`
    const wet = wetF[i] > 0
    const sw = wet ? [watR[i], watG[i], watB[i]] : [landR[i], landG[i], landB[i]]
    $('inspSwatch').style.background = `rgb(${sw[0] | 0},${sw[1] | 0},${sw[2] | 0})`
    const h = Math.round((elev[i] - sea) * M_PER_UNIT)
    $('inspElev').textContent = h >= 0 ? `${h.toLocaleString()} m` : `${(-h).toLocaleString()} m deep`
    $('inspTemp').textContent = `${temp[i].toFixed(1)} °C`
    $('inspRain').textContent = `${Math.round(rain[i]).toLocaleString()} mm/yr`
    let wtxt = 'Dry'
    if (elev[i] < sea) wtxt = seaIce[i] > 0.5 ? 'Frozen sea' : 'Sea'
    else if (water[i] > LAKE_T) wtxt = `Lake, ${Math.round(water[i] * M_PER_UNIT)} m deep`
    else if (flux[i] > RIVER_MIN) wtxt = flux[i] > RIVER_MIN * 8 ? 'Large river' : 'Stream'
    else if (snow[i] > 0.000003) wtxt = 'Snow cover'
    else if (moistureIndex(i) > 1) wtxt = 'Moist soil'
    $('inspWater').textContent = wtxt
  }

  // pointer & keyboard
  const pointers = new Map()
  let pinch = null
  function localXY(e) {
    const r = canvas.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  let spaceDown = false
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId)
    const [x, y] = localXY(e)
    pointers.set(e.pointerId, { x, y })
    pointer.x = x
    pointer.y = y
    pointer.inside = true
    if (pointers.size === 2) {
      // two fingers: pinch to zoom
      pointer.painting = false
      pointer.panning = false
      const [a, b] = [...pointers.values()]
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
      return
    }
    if (e.button === 1 || e.button === 2 || state.tool === 'pan' || spaceDown) {
      pointer.panning = true
      canvas.classList.add('panning')
    } else if (e.button === 0) {
      pointer.painting = true
    }
  })
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = localXY(e)
    const prev = pointers.get(e.pointerId)
    if (prev) pointers.set(e.pointerId, { x, y })
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      view.ox += cx - pinch.cx
      view.oy += cy - pinch.cy
      zoomAt(cx, cy, d / pinch.d)
      pinch = { d, cx, cy }
      return
    }
    if (pointer.panning && prev) {
      view.ox += x - prev.x
      view.oy += y - prev.y
      view.ax += x - prev.x
      view.ay += y - prev.y
      clampPan()
    }
    pointer.x = x
    pointer.y = y
    pointer.inside = true
  })
  const endPointer = (e) => {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinch = null
    if (pointers.size === 0) {
      pointer.painting = false
      pointer.panning = false
      canvas.classList.remove('panning')
    }
  }
  canvas.addEventListener('pointerup', endPointer)
  canvas.addEventListener('pointercancel', endPointer)
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !pointer.painting && !pointer.panning) pointer.inside = false
  })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const [x, y] = localXY(e)
      zoomAt(x, y, Math.exp(-e.deltaY * 0.0015))
    },
    { passive: false }
  )
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return
    const keys = { 1: 'pan', 2: 'raise', 3: 'lower', 4: 'water', 5: 'temp', 6: 'rain' }
    if (keys[e.key]) setTool(keys[e.key])
    else if (e.key === 'p' || e.key === 'P') setPaused(!state.paused)
    else if (e.key === '[' || e.key === ']') {
      const el = $('brush')
      el.value = clamp(state.brush + (e.key === ']' ? 2 : -2), 3, 40)
      el.dispatchEvent(new Event('input'))
    } else if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) {
      spaceDown = true
      e.preventDefault()
    }
  })
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') spaceDown = false
  })
  window.addEventListener('resize', resize)

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  resize()
  renderLegend()
  setTool('raise')
  toastEl.classList.remove('show')
  setTimeout(() => {
    loadEarth()
    updateWorldButtons()
    needsPaint = true
    riversDirty = true
    loadingEl.classList.add('hide')
    toast('This is the real Earth. Drag on the map to reshape it, or pick another tool below.')
    requestAnimationFrame(frame)
  }, 30)
  // expose for debugging in the console
  window.earth = { state, perf, elev, temp, rain, veg, water, snow, flux, biomeName }
})()
