import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { WORLD, heightAt, riverDistanceAt, slopeNormalY, mulberry32, lerp, smoothstep } from '../world/terrain.js'
import { sim } from '../sim/store.js'

function placeTrees() {
  const rand = mulberry32(42)
  const trees = []
  let tries = 0
  while (trees.length < 170 && tries < 9000) {
    tries++
    const x = lerp(WORLD.minX + 0.8, 6, rand())
    const z = lerp(WORLD.minZ + 0.8, WORLD.maxZ - 0.8, rand())
    const h = heightAt(x, z)
    if (h < 0.55 || h > 4.6) continue
    if (riverDistanceAt(x, z) < 1.7) continue
    if (slopeNormalY(x, z) < 0.8) continue
    // forests cluster: thin out using a coarse pattern
    const cluster = Math.sin(x * 0.45 + 1.3) * Math.cos(z * 0.38 - 0.7)
    if (cluster < -0.15 && rand() < 0.8) continue
    if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 0.7)) continue
    const conifer = h > 2.2 ? rand() < 0.9 : rand() < 0.45
    trees.push({ x, z, y: h, s: 0.75 + rand() * 0.55, conifer, rot: rand() * Math.PI * 2 })
  }
  return trees
}

const GREEN_CONIFER = new THREE.Color('#2f5e33')
const GREEN_LEAF = new THREE.Color('#4f8a3a')
const AUTUMN = new THREE.Color('#9a8a3c')
const SNOWY = new THREE.Color('#e8eef4')

export default function Trees() {
  const trees = useMemo(placeTrees, [])
  const conifers = useMemo(() => trees.filter((t) => t.conifer), [trees])
  const leafy = useMemo(() => trees.filter((t) => !t.conifer), [trees])
  const trunkRef = useRef()
  const coneRef = useRef()
  const cone2Ref = useRef()
  const leafRef = useRef()
  const last = useRef({ snow: -99, dry: -1, frame: 0 })

  const geos = useMemo(() => {
    const trunk = new THREE.CylinderGeometry(0.07, 0.1, 0.6, 6)
    trunk.translate(0, 0.3, 0)
    const cone = new THREE.ConeGeometry(0.48, 1.0, 7)
    cone.translate(0, 0.95, 0)
    const cone2 = new THREE.ConeGeometry(0.34, 0.75, 7)
    cone2.translate(0, 1.45, 0)
    const leaf = new THREE.IcosahedronGeometry(0.5, 1)
    leaf.scale(1, 0.9, 1)
    leaf.translate(0, 0.95, 0)
    return { trunk, cone, cone2, leaf }
  }, [])

  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const set = (mesh, list) => {
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t.rot)
        m.compose(new THREE.Vector3(t.x, t.y - 0.05, t.z), q, new THREE.Vector3(t.s, t.s, t.s))
        mesh.setMatrixAt(i, m)
      })
      mesh.instanceMatrix.needsUpdate = true
    }
    set(trunkRef.current, trees)
    set(coneRef.current, conifers)
    set(cone2Ref.current, conifers)
    set(leafRef.current, leafy)
  }, [trees, conifers, leafy])

  // Snow settles on trees above the snow line; leaves brown in extreme heat.
  useFrame(() => {
    const L = last.current
    L.frame++
    if (L.frame % 6 && L.snow > -90) return
    const snowLine = sim.snowLine
    const dry = smoothstep(32, 46, sim.temperature)
    if (Math.abs(snowLine - L.snow) < 0.03 && Math.abs(dry - L.dry) < 0.01) return
    L.snow = snowLine
    L.dry = dry
    const c = new THREE.Color()
    const paint = (mesh, list, base) => {
      list.forEach((t, i) => {
        const snow = smoothstep(snowLine - 0.5, snowLine + 0.4, t.y + 0.9)
        c.copy(base).lerp(AUTUMN, dry * 0.7).lerp(SNOWY, snow * 0.85)
        mesh.setColorAt(i, c)
      })
      mesh.instanceColor.needsUpdate = true
    }
    paint(coneRef.current, conifers, GREEN_CONIFER)
    paint(cone2Ref.current, conifers, GREEN_CONIFER)
    paint(leafRef.current, leafy, GREEN_LEAF)
  })

  return (
    <group>
      <instancedMesh ref={trunkRef} args={[geos.trunk, undefined, trees.length]} castShadow>
        <meshStandardMaterial color="#6b4a32" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={coneRef} args={[geos.cone, undefined, conifers.length]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.9} flatShading />
      </instancedMesh>
      <instancedMesh ref={cone2Ref} args={[geos.cone2, undefined, conifers.length]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.9} flatShading />
      </instancedMesh>
      <instancedMesh ref={leafRef} args={[geos.leaf, undefined, leafy.length]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.9} flatShading />
      </instancedMesh>
    </group>
  )
}
