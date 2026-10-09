import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mulberry32, smoothstep, clamp } from '../world/terrain.js'
import { sim, simDelta } from '../sim/store.js'

// Clouds form over the ocean, drift inland on the sea breeze, rise over the
// mountains (where they rain or snow) and dissipate in the rain shadow beyond.
export const CLOUD_COUNT = 10
const RANGE_MAX = 25
const RANGE_MIN = -26
const SPAN = RANGE_MAX - RANGE_MIN
export const WIND = 0.55 // units per simulated second, blowing west (−x)

const rand = mulberry32(7)
const ranks = Array.from({ length: CLOUD_COUNT }, (_, i) => i).sort(() => rand() - 0.5)

export const CLOUDS = Array.from({ length: CLOUD_COUNT }, (_, i) => {
  const puffs = []
  const n = 7 + Math.floor(rand() * 4)
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2
    puffs.push({
      dx: Math.cos(a) * (0.6 + rand() * 1.5),
      dy: rand() * 0.55,
      dz: Math.sin(a) * (0.4 + rand() * 0.8),
      r: 0.75 + rand() * 0.75,
    })
  }
  puffs.push({ dx: 0, dy: 0.55, dz: 0, r: 1.35 + rand() * 0.3 })
  return {
    x0: RANGE_MIN + (i / CLOUD_COUNT) * SPAN + rand() * 2,
    z: -13 + ((i * 7) % CLOUD_COUNT) * (26 / CLOUD_COUNT) + rand() * 1.5,
    y0: 10.6 + rand() * 1.1,
    rank: ranks[i],
    puffs,
    // live values (updated every frame)
    x: 0,
    y: 0,
    size: 0,
    precip: 0,
  }
})

const PUFF_COUNT = CLOUDS.reduce((n, c) => n + c.puffs.length, 0)
const WHITE = new THREE.Color('#ffffff')
const STORM = new THREE.Color('#7d8794')

export default function Clouds() {
  const meshRef = useRef()
  const geo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 3)
    return g
  }, [])
  const smooth = useRef({ cover: 0.5, precip: 0, thick: 0.5, offset: 0 })
  const tmp = useMemo(
    () => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color() }),
    []
  )

  useLayoutEffect(() => {
    const mesh = meshRef.current
    for (let i = 0; i < PUFF_COUNT; i++) mesh.setColorAt(i, WHITE)
  }, [])

  useFrame((_, delta) => {
    const sdt = simDelta(delta)
    const S = smooth.current
    const k = 1 - Math.exp(-Math.max(sdt, delta * 0.25) * 1.5)
    S.cover += (sim.cover - S.cover) * k
    S.precip += (sim.rates.precipitation - S.precip) * k
    S.thick += (clamp(sim.cloud / 1.2, 0, 1) - S.thick) * k
    S.offset += sdt * WIND

    const mesh = meshRef.current
    let idx = 0
    for (const c of CLOUDS) {
      let x = c.x0 - S.offset
      x = RANGE_MIN + ((((x - RANGE_MIN) % SPAN) + SPAN) % SPAN)
      const life = smoothstep(RANGE_MAX - 1, 15, x) * smoothstep(RANGE_MIN + 1, -18, x)
      const vis = clamp(S.cover * 1.3 * CLOUD_COUNT - c.rank + 0.3, 0, 1)
      const size = vis * life * (0.7 + 0.45 * S.thick)
      // orographic lift over the mountains
      const lift = 1.1 * Math.exp(-((x + 10) ** 2) / 60)
      c.x = x
      c.y = c.y0 + lift
      c.size = size
      let p = clamp(S.precip * 2.2 - (c.rank / CLOUD_COUNT) * 1.6, 0, 1) * smoothstep(0.35, 0.75, size)
      if (x > 7) p *= 0.55 // less rain falls over the open ocean in this miniature
      c.precip = p
      tmp.c.copy(WHITE).lerp(STORM, Math.min(1, p * 0.85 + S.thick * 0.15))
      for (const puff of c.puffs) {
        const r = puff.r * size
        tmp.p.set(x + puff.dx * (0.8 + 0.2 * size), c.y + puff.dy * size, c.z + puff.dz)
        tmp.s.set(r * 1.15, r * 0.78, r)
        tmp.m.compose(tmp.p, tmp.q, tmp.s)
        mesh.setMatrixAt(idx, tmp.m)
        mesh.setColorAt(idx, tmp.c)
        idx++
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[geo, undefined, PUFF_COUNT]} castShadow frustumCulled={false}>
      <meshStandardMaterial roughness={1} metalness={0} emissive="#c8d6e6" emissiveIntensity={0.18} />
    </instancedMesh>
  )
}
