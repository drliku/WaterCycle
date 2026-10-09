import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  WORLD,
  heightAt,
  gradientAt,
  riverDistanceAt,
  riverCurve,
  riverSurfaceAt,
  RIVER_MOUTH_T,
  randomOceanPoint,
  tempAtHeight,
  lerp,
  clamp,
  smoothstep,
} from '../world/terrain.js'
import { sim, simDelta, useSim } from '../sim/store.js'
import { RAIN_SNOW_C } from '../sim/model.js'
import { CLOUDS, WIND } from './Clouds.jsx'
import { makePointsGeometry, makePointsMaterial } from './pointsMaterial.js'

function usePointScale(material) {
  const { size, camera, gl } = useThree()
  useEffect(() => {
    const fov = (camera.fov * Math.PI) / 180
    material.uniforms.uScale.value = (size.height * gl.getPixelRatio()) / (2 * Math.tan(fov / 2))
  }, [size, camera, gl, material])
}

const groundAt = (x, z) => Math.max(heightAt(x, z), 0)

function pickPrecipCloud() {
  let total = 0
  for (const c of CLOUDS) total += c.precip
  if (total <= 0.001) return null
  let r = Math.random() * total
  for (const c of CLOUDS) {
    r -= c.precip
    if (r <= 0) return c
  }
  return null
}

// ---------------------------------------------------------------------------
// Precipitation: rain streaks and snowflakes falling from precipitating clouds.
// The type is decided by the air temperature near the ground below, so with
// mild temperatures it snows on the peaks while it rains in the valleys.
// ---------------------------------------------------------------------------
const RAIN_N = 2600
const SNOW_N = 1400

export function Precipitation() {
  const rain = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN_N * 6).fill(-999), 3))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, 0), 60)
    return { geo: g, x: new Float32Array(RAIN_N), y: new Float32Array(RAIN_N).fill(-999), z: new Float32Array(RAIN_N), g: new Float32Array(RAIN_N), free: [] }
  }, [])
  const snow = useMemo(
    () => ({
      geo: makePointsGeometry(SNOW_N),
      x: new Float32Array(SNOW_N),
      y: new Float32Array(SNOW_N).fill(-999),
      z: new Float32Array(SNOW_N),
      g: new Float32Array(SNOW_N),
      ph: new Float32Array(SNOW_N),
    }),
    []
  )
  const snowMat = useMemo(() => makePointsMaterial({ color: '#ffffff' }), [])
  usePointScale(snowMat)
  const acc = useRef(0)
  const cursor = useRef({ rain: 0, snow: 0 })
  const resetCount = useSim((s) => s.resetCount)

  useEffect(() => {
    rain.y.fill(-999)
    snow.y.fill(-999)
  }, [resetCount, rain, snow])

  useFrame((_, delta) => {
    const dt = simDelta(delta)
    if (dt === 0) return
    const T = sim.temperature
    let total = 0
    for (const c of CLOUDS) total += c.precip
    acc.current += total * 260 * dt
    let spawns = Math.min(Math.floor(acc.current), 200)
    acc.current -= Math.floor(acc.current)
    while (spawns-- > 0) {
      const c = pickPrecipCloud()
      if (!c) break
      const x = c.x + (Math.random() - 0.5) * 4.2 * c.size
      const z = c.z + (Math.random() - 0.5) * 2.4 * c.size
      if (x < WORLD.minX + 0.2 || x > WORLD.maxX - 0.2 || z < WORLD.minZ + 0.2 || z > WORLD.maxZ - 0.2) continue
      const y = c.y - 0.4 - Math.random() * 0.6
      const ground = groundAt(x, z)
      const tGround = tempAtHeight(T, ground)
      const isSnow = tGround < RAIN_SNOW_C + (Math.random() - 0.5) * 1.6
      if (isSnow) {
        const i = cursor.current.snow
        cursor.current.snow = (i + 1) % SNOW_N
        snow.x[i] = x
        snow.y[i] = y
        snow.z[i] = z
        snow.g[i] = ground
        snow.ph[i] = Math.random() * 10
      } else {
        const i = cursor.current.rain
        cursor.current.rain = (i + 1) % RAIN_N
        rain.x[i] = x
        rain.y[i] = y
        rain.z[i] = z
        rain.g[i] = ground
      }
    }

    // rain
    const rp = rain.geo.attributes.position.array
    const vy = 11
    const vx = -WIND * 1.5
    for (let i = 0; i < RAIN_N; i++) {
      if (rain.y[i] < -100) {
        rp[i * 6 + 1] = rp[i * 6 + 4] = -999
        continue
      }
      rain.y[i] -= vy * dt
      rain.x[i] += vx * dt
      if (rain.y[i] <= rain.g[i]) {
        rain.y[i] = -999
        rp[i * 6 + 1] = rp[i * 6 + 4] = -999
        continue
      }
      const o = i * 6
      rp[o] = rain.x[i]
      rp[o + 1] = rain.y[i]
      rp[o + 2] = rain.z[i]
      rp[o + 3] = rain.x[i] - vx * 0.035
      rp[o + 4] = rain.y[i] + 0.38
      rp[o + 5] = rain.z[i]
    }
    rain.geo.attributes.position.needsUpdate = true

    // snow
    const sp = snow.geo.attributes.position.array
    const sa = snow.geo.attributes.aAlpha.array
    const ss = snow.geo.attributes.aSize.array
    for (let i = 0; i < SNOW_N; i++) {
      if (snow.y[i] < -100) {
        sa[i] = 0
        continue
      }
      snow.ph[i] += dt
      snow.y[i] -= 1.5 * dt
      snow.x[i] += (-WIND * 0.8 + Math.sin(snow.ph[i] * 2.1) * 0.5) * dt
      snow.z[i] += Math.cos(snow.ph[i] * 1.7) * 0.4 * dt
      if (snow.y[i] <= snow.g[i] + 0.03) {
        snow.y[i] = -999
        sa[i] = 0
        continue
      }
      sp[i * 3] = snow.x[i]
      sp[i * 3 + 1] = snow.y[i]
      sp[i * 3 + 2] = snow.z[i]
      sa[i] = 0.95
      ss[i] = 0.16
    }
    snow.geo.attributes.position.needsUpdate = true
    snow.geo.attributes.aAlpha.needsUpdate = true
    snow.geo.attributes.aSize.needsUpdate = true
  })

  return (
    <group>
      <lineSegments geometry={rain.geo} frustumCulled={false}>
        <lineBasicMaterial color="#8fb8e0" transparent opacity={0.8} depthWrite={false} />
      </lineSegments>
      <points geometry={snow.geo} material={snowMat} frustumCulled={false} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Evaporation: faint, invisible-in-reality water vapour drawn as subtle motes
// rising from open water. Near the cloud layer they brighten (condensation)
// and merge into the clouds.
// ---------------------------------------------------------------------------
const VAPOR_N = 650
const CLOUD_BASE = 9.6

export function Evaporation() {
  const geo = useMemo(() => makePointsGeometry(VAPOR_N), [])
  const mat = useMemo(() => makePointsMaterial({ color: '#e8f4ff' }), [])
  usePointScale(mat)
  const P = useMemo(
    () => ({
      x: new Float32Array(VAPOR_N),
      y: new Float32Array(VAPOR_N).fill(-999),
      z: new Float32Array(VAPOR_N),
      v: new Float32Array(VAPOR_N),
      ph: new Float32Array(VAPOR_N),
      start: new Float32Array(VAPOR_N),
    }),
    []
  )
  const acc = useRef(0)
  const cursor = useRef(0)
  const resetCount = useSim((s) => s.resetCount)
  useEffect(() => P.y.fill(-999), [resetCount, P])

  useFrame((_, delta) => {
    const dt = simDelta(delta)
    if (dt === 0) return
    acc.current += sim.rates.evaporation * 95 * dt
    let n = Math.min(Math.floor(acc.current), 60)
    acc.current -= Math.floor(acc.current)
    while (n-- > 0) {
      const pt = randomOceanPoint(Math.random, 0.2)
      if (!pt) break
      const [x, z, depth] = pt
      // no evaporation through sea ice
      if (depth / 5 < sim.seaIce * 1.08) continue
      const i = cursor.current
      cursor.current = (i + 1) % VAPOR_N
      P.x[i] = x
      P.z[i] = z
      P.y[i] = 0.05
      P.start[i] = 0.05
      P.v[i] = 0.9 + Math.random() * 0.8
      P.ph[i] = Math.random() * 10
    }
    const pos = geo.attributes.position.array
    const al = geo.attributes.aAlpha.array
    const sz = geo.attributes.aSize.array
    for (let i = 0; i < VAPOR_N; i++) {
      if (P.y[i] < -100) {
        al[i] = 0
        continue
      }
      P.ph[i] += dt
      P.y[i] += P.v[i] * dt
      P.x[i] += (-WIND * 0.9 + Math.sin(P.ph[i] * 1.3) * 0.35) * dt
      P.z[i] += Math.cos(P.ph[i] * 0.9) * 0.3 * dt
      const y = P.y[i]
      if (y > CLOUD_BASE + 1.2) {
        P.y[i] = -999
        al[i] = 0
        continue
      }
      pos[i * 3] = P.x[i]
      pos[i * 3 + 1] = y
      pos[i * 3 + 2] = P.z[i]
      // subtle while rising; denser & brighter as it condenses near cloud base
      const fadeIn = smoothstep(0.05, 1.2, y)
      const cond = smoothstep(CLOUD_BASE - 2.2, CLOUD_BASE, y)
      const fadeOut = 1 - smoothstep(CLOUD_BASE + 0.2, CLOUD_BASE + 1.2, y)
      al[i] = fadeIn * fadeOut * (0.42 + 0.4 * cond)
      sz[i] = 0.2 + cond * 0.22
    }
    geo.attributes.position.needsUpdate = true
    geo.attributes.aAlpha.needsUpdate = true
    geo.attributes.aSize.needsUpdate = true
  })

  return <points geometry={geo} material={mat} frustumCulled={false} />
}

// ---------------------------------------------------------------------------
// Runoff: meltwater and rainwater trickling downhill into the river, and
// tracers carried by the river back to the ocean.
// ---------------------------------------------------------------------------
const SLOPE_N = 420
const RIVER_N = 220
const riverLength = riverCurve.getLength() * RIVER_MOUTH_T

export function Runoff() {
  const slopeGeo = useMemo(() => makePointsGeometry(SLOPE_N), [])
  const riverGeo = useMemo(() => makePointsGeometry(RIVER_N), [])
  const slopeMat = useMemo(() => makePointsMaterial({ color: '#6fc3ff' }), [])
  const riverMat = useMemo(() => makePointsMaterial({ color: '#e6f7ff' }), [])
  usePointScale(slopeMat)
  usePointScale(riverMat)
  const S = useMemo(
    () => ({
      x: new Float32Array(SLOPE_N),
      y: new Float32Array(SLOPE_N).fill(-999),
      z: new Float32Array(SLOPE_N),
      life: new Float32Array(SLOPE_N),
    }),
    []
  )
  const R = useMemo(() => {
    const t = new Float32Array(RIVER_N)
    const off = new Float32Array(RIVER_N)
    const sp = new Float32Array(RIVER_N)
    for (let i = 0; i < RIVER_N; i++) {
      t[i] = Math.random() * RIVER_MOUTH_T
      off[i] = (Math.random() - 0.5) * 1.1
      sp[i] = 0.75 + Math.random() * 0.5
    }
    return { t, off, sp }
  }, [])
  const acc = useRef(0)
  const cursor = useRef(0)
  const flow = useRef(0.3)
  const ice = useRef(0)
  const resetCount = useSim((s) => s.resetCount)
  useEffect(() => S.y.fill(-999), [resetCount, S])
  const tmpP = useMemo(() => new THREE.Vector3(), [])
  const tmpT = useMemo(() => new THREE.Vector3(), [])
  const grad = useMemo(() => [0, 0], [])

  useFrame((_, delta) => {
    const dt = simDelta(delta)
    if (dt === 0) return
    const k = 1 - Math.exp(-dt * 2)
    flow.current += (sim.runoff - flow.current) * k
    ice.current += (sim.riverIce - ice.current) * k

    // --- spawn slope trickles: snowmelt near the snow line, rain on land
    const T = sim.temperature
    const rainOnLand = sim.rates.precipitation * (1 - sim.snowFrac)
    const melt = sim.rates.melting
    acc.current += (rainOnLand * 70 + melt * 80) * dt
    let n = Math.min(Math.floor(acc.current), 40)
    acc.current -= Math.floor(acc.current)
    const meltShare = melt / (melt + rainOnLand + 1e-6)
    while (n-- > 0) {
      const fromMelt = Math.random() < meltShare
      let found = false
      let x = 0
      let z = 0
      for (let tries = 0; tries < 25 && !found; tries++) {
        x = lerp(WORLD.minX + 0.5, 4, Math.random())
        z = lerp(WORLD.minZ + 0.5, WORLD.maxZ - 0.5, Math.random())
        const h = heightAt(x, z)
        if (fromMelt) {
          found = h > sim.snowLine - 0.6 && h < sim.snowLine + 0.8 && h > 0.8
        } else {
          found = h > 1.0 && tempAtHeight(T, h) > RAIN_SNOW_C
        }
        if (found && riverDistanceAt(x, z) < 1.3) found = false
      }
      if (!found) continue
      const i = cursor.current
      cursor.current = (i + 1) % SLOPE_N
      S.x[i] = x
      S.z[i] = z
      S.y[i] = heightAt(x, z)
      S.life[i] = 0
    }

    const pos = slopeGeo.attributes.position.array
    const al = slopeGeo.attributes.aAlpha.array
    const sz = slopeGeo.attributes.aSize.array
    for (let i = 0; i < SLOPE_N; i++) {
      if (S.y[i] < -100) {
        al[i] = 0
        continue
      }
      S.life[i] += dt
      gradientAt(S.x[i], S.z[i], grad)
      const g = Math.hypot(grad[0], grad[1]) + 1e-5
      const speed = 0.8 + Math.min(g, 1.5) * 1.6
      S.x[i] -= (grad[0] / g) * speed * dt
      S.z[i] -= (grad[1] / g) * speed * dt
      const h = heightAt(S.x[i], S.z[i])
      const rd = riverDistanceAt(S.x[i], S.z[i])
      if (h < 0.08 || rd < 0.8 || S.life[i] > 7 || (g < 0.03 && S.life[i] > 2)) {
        S.y[i] = -999
        al[i] = 0
        continue
      }
      S.y[i] = h + 0.07
      pos[i * 3] = S.x[i]
      pos[i * 3 + 1] = S.y[i]
      pos[i * 3 + 2] = S.z[i]
      al[i] = smoothstep(0, 0.4, S.life[i]) * (1 - smoothstep(5.5, 7, S.life[i])) * 0.9
      sz[i] = 0.15
    }
    slopeGeo.attributes.position.needsUpdate = true
    slopeGeo.attributes.aAlpha.needsUpdate = true
    slopeGeo.attributes.aSize.needsUpdate = true

    // --- river tracers
    const visible = clamp(flow.current / 0.9, 0.12, 1) * (1 - ice.current)
    const vel = (0.8 + 2.6 * Math.min(flow.current, 1.2)) * (1 - 0.9 * ice.current)
    const rpos = riverGeo.attributes.position.array
    const ral = riverGeo.attributes.aAlpha.array
    const rsz = riverGeo.attributes.aSize.array
    for (let i = 0; i < RIVER_N; i++) {
      // faster in the steep upper course
      const steep = 1 + 1.2 * (1 - smoothstep(0, 0.25, R.t[i]))
      R.t[i] += ((vel * R.sp[i] * steep) / riverLength) * dt * RIVER_MOUTH_T
      if (R.t[i] > RIVER_MOUTH_T + 0.03) {
        R.t[i] = Math.random() * 0.05
        R.off[i] = (Math.random() - 0.5) * 1.1
      }
      const t = R.t[i]
      riverCurve.getPointAt(Math.min(t, 1), tmpP)
      riverCurve.getTangentAt(Math.min(t, 1), tmpT)
      const w = 0.55 + 0.45 * Math.min(1, t / 0.12)
      rpos[i * 3] = tmpP.x - tmpT.z * R.off[i] * w
      rpos[i * 3 + 1] = riverSurfaceAt(t) + 0.05
      rpos[i * 3 + 2] = tmpP.z + tmpT.x * R.off[i] * w
      const on = i / RIVER_N < visible ? 1 : 0
      ral[i] = on * 0.75 * smoothstep(0, 0.04, t) * (1 - smoothstep(RIVER_MOUTH_T - 0.02, RIVER_MOUTH_T + 0.03, t))
      rsz[i] = 0.13
    }
    riverGeo.attributes.position.needsUpdate = true
    riverGeo.attributes.aAlpha.needsUpdate = true
    riverGeo.attributes.aSize.needsUpdate = true
  })

  return (
    <group>
      <points geometry={slopeGeo} material={slopeMat} frustumCulled={false} renderOrder={4} />
      <points geometry={riverGeo} material={riverMat} frustumCulled={false} renderOrder={4} />
    </group>
  )
}
