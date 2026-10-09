import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useSim } from '../sim/store.js'
import { WATER_STATES } from '../content/processes.js'

// --- geometry of a water molecule ------------------------------------------------
const HOH_HALF_ANGLE = THREE.MathUtils.degToRad(104.5 / 2)
const OH = 0.3 // O–H distance in display units (O–O hydrogen-bond distance = 1)
const H_LOCAL = [
  new THREE.Vector3(Math.sin(HOH_HALF_ANGLE) * OH, Math.cos(HOH_HALF_ANGLE) * OH, 0),
  new THREE.Vector3(-Math.sin(HOH_HALF_ANGLE) * OH, Math.cos(HOH_HALF_ANGLE) * OH, 0),
]

// Orientation that points the two O–H bonds along directions u1 and u2.
function orientTowards(u1, u2) {
  const b = u1.clone().add(u2).normalize()
  const perp = u1.clone().sub(b.clone().multiplyScalar(u1.dot(b))).normalize()
  const z = new THREE.Vector3().crossVectors(perp, b).normalize()
  const m = new THREE.Matrix4().makeBasis(perp, b, z)
  return new THREE.Quaternion().setFromRotationMatrix(m)
}

// --- hexagonal ice (Ih) fragment: two puckered honeycomb bilayers ---------------
function buildIceLattice() {
  const d = 1
  const pucker = 0.33
  const sites = []
  const a1 = [Math.sqrt(3) * d, 0]
  const a2 = [(Math.sqrt(3) / 2) * d, 1.5 * d]
  const R = 2.55
  for (let i = -4; i <= 4; i++) {
    for (let j = -4; j <= 4; j++) {
      const ax = i * a1[0] + j * a2[0]
      const az = i * a1[1] + j * a2[1] - 0.5 * d
      const bx = ax
      const bz = az + d
      for (const [x, z, sub] of [
        [ax, az, 'A'],
        [bx, bz, 'B'],
      ]) {
        if (x * x + z * z > R * R) continue
        // bilayer 1: A low, B high; bilayer 2 sits on top (B below, A above)
        sites.push(new THREE.Vector3(x, sub === 'A' ? 0 : pucker, z))
        sites.push(new THREE.Vector3(x, sub === 'A' ? 1 + 2 * pucker : 1 + pucker, z))
      }
    }
  }
  // centre vertically
  const cy = (1 + 2 * pucker) / 2
  sites.forEach((p) => (p.y -= cy))

  // hydrogen-bond network: nearest neighbours
  const bonds = []
  const neighbours = sites.map(() => [])
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      if (sites[i].distanceTo(sites[j]) < 1.12) {
        bonds.push([i, j])
        neighbours[i].push(j)
        neighbours[j].push(i)
      }
    }
  }
  // Ice rules: each bond carries exactly one H; each molecule donates two.
  const donors = sites.map(() => [])
  const order = [...bonds].sort(() => Math.random() - 0.5)
  for (const [i, j] of order) {
    if (donors[i].length < 2 && (donors[j].length >= 2 || Math.random() < 0.5)) donors[i].push(j)
    else if (donors[j].length < 2) donors[j].push(i)
  }
  const tetra = [
    new THREE.Vector3(1, 1, 1),
    new THREE.Vector3(-1, -1, 1),
    new THREE.Vector3(-1, 1, -1),
    new THREE.Vector3(1, -1, -1),
  ].map((v) => v.normalize())
  const quats = sites.map((p, i) => {
    const dirs = donors[i].map((j) => sites[j].clone().sub(p).normalize())
    // edge molecules: point remaining H into free space
    for (const t of tetra) {
      if (dirs.length >= 2) break
      if (dirs.every((v) => v.dot(t) < 0.5)) dirs.push(t.clone())
    }
    return orientTowards(dirs[0], dirs[1])
  })
  return { sites, quats }
}

// box: container half-size, cam: camera distance, phi: camera angle from
// vertical (ice is viewed from above to show its hexagonal rings)
const MODE_CONF = {
  solid: { box: 3.1, cam: 10, phi: 0.55 },
  liquid: { box: 3.1, cam: 10, phi: 1.15 },
  gas: { box: 5.6, cam: 16.5, phi: 1.15 },
}
const MAX_LINES = 160

function Molecules({ mode }) {
  const lattice = useMemo(buildIceLattice, [])
  const N = lattice.sites.length
  const oRef = useRef()
  const hRef = useRef()
  const boxRef = useRef()
  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_LINES * 6), 3))
    g.setDrawRange(0, 0)
    return g
  }, [])
  const mols = useMemo(
    () =>
      lattice.sites.map((p, i) => ({
        pos: p.clone(),
        vel: new THREE.Vector3(),
        quat: lattice.quats[i].clone(),
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5),
        phase: Math.random() * 10,
      })),
    [lattice]
  )
  const tmp = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      v: new THREE.Vector3(),
      w: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      e: new THREE.Euler(),
      one: new THREE.Vector3(1, 1, 1),
      target: new THREE.Vector3(),
    }),
    []
  )
  const view = useRef({ box: 3.1, cam: 10, phi: 1.15, t: 0 })
  const sph = useMemo(() => new THREE.Spherical(), [])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const V = view.current
    V.t += dt
    const conf = MODE_CONF[mode]
    V.box += (conf.box - V.box) * (1 - Math.exp(-dt * 2))
    V.cam += (conf.cam - V.cam) * (1 - Math.exp(-dt * 2))
    V.phi += (conf.phi - V.phi) * (1 - Math.exp(-dt * 2))
    const cam = state.camera
    sph.setFromVector3(cam.position)
    sph.radius = V.cam
    sph.phi = V.phi
    cam.position.setFromSpherical(sph)
    cam.lookAt(0, 0, 0)
    if (boxRef.current) boxRef.current.scale.setScalar(V.box)

    for (let i = 0; i < N; i++) {
      const m = mols[i]
      if (mode === 'solid') {
        // locked in the lattice, vibrating about fixed sites
        const s = lattice.sites[i]
        tmp.target.set(
          s.x + Math.sin(V.t * 9 + m.phase) * 0.035,
          s.y + Math.sin(V.t * 11 + m.phase * 1.7) * 0.035,
          s.z + Math.sin(V.t * 10 + m.phase * 2.3) * 0.035
        )
        m.pos.lerp(tmp.target, 1 - Math.exp(-dt * 3.5))
        m.quat.slerp(lattice.quats[i], 1 - Math.exp(-dt * 3.5))
        m.vel.set(0, 0, 0)
      } else {
        const gas = mode === 'gas'
        // random thermal kicks
        m.vel.x += (Math.random() - 0.5) * (gas ? 2 : 6) * dt
        m.vel.y += (Math.random() - 0.5) * (gas ? 2 : 6) * dt
        m.vel.z += (Math.random() - 0.5) * (gas ? 2 : 6) * dt
        if (!gas) {
          // molecules stay close: short-range repulsion + cohesion
          for (let j = 0; j < N; j++) {
            if (j === i) continue
            tmp.v.subVectors(m.pos, mols[j].pos)
            const d = tmp.v.length()
            if (d < 0.95 && d > 1e-4) m.vel.addScaledVector(tmp.v, ((0.95 - d) / d) * 9 * dt)
          }
          const r = m.pos.length()
          if (r > 2.25) m.vel.addScaledVector(m.pos, -((r - 2.25) / r) * 6 * dt)
          m.vel.multiplyScalar(Math.exp(-dt * 1.6))
          const sp = m.vel.length()
          if (sp > 1.3) m.vel.multiplyScalar(1.3 / sp)
        } else {
          // free flight; keep the molecules fast
          const sp = m.vel.length()
          if (sp < 3.2) m.vel.multiplyScalar(sp > 1e-3 ? 1 + (3.4 / sp - 1) * Math.min(1, dt * 2) : 1)
          if (sp < 1e-3) m.vel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3)
          const lim = V.box - 0.3
          for (const ax of ['x', 'y', 'z']) {
            if (m.pos[ax] > lim && m.vel[ax] > 0) m.vel[ax] *= -1
            if (m.pos[ax] < -lim && m.vel[ax] < 0) m.vel[ax] *= -1
          }
        }
        m.pos.addScaledVector(m.vel, dt)
        const spin = gas ? 3.5 : 1.6
        m.spin.x += (Math.random() - 0.5) * dt * 4
        m.spin.y += (Math.random() - 0.5) * dt * 4
        m.spin.z += (Math.random() - 0.5) * dt * 4
        m.spin.clampLength(0, 1)
        tmp.e.set(m.spin.x * spin * dt, m.spin.y * spin * dt, m.spin.z * spin * dt)
        tmp.q.setFromEuler(tmp.e)
        m.quat.multiply(tmp.q).normalize()
      }
      tmp.m.compose(m.pos, m.quat, tmp.one)
      oRef.current.setMatrixAt(i, tmp.m)
      for (let h = 0; h < 2; h++) {
        tmp.w.copy(H_LOCAL[h]).applyQuaternion(m.quat).add(m.pos)
        tmp.m.makeTranslation(tmp.w.x, tmp.w.y, tmp.w.z)
        hRef.current.setMatrixAt(i * 2 + h, tmp.m)
      }
    }
    oRef.current.instanceMatrix.needsUpdate = true
    hRef.current.instanceMatrix.needsUpdate = true

    // hydrogen bonds between close neighbours (none in the gas)
    const arr = lineGeo.attributes.position.array
    let n = 0
    const maxD = mode === 'solid' ? 1.15 : 1.08
    for (let i = 0; i < N && n < MAX_LINES; i++) {
      for (let j = i + 1; j < N && n < MAX_LINES; j++) {
        if (mols[i].pos.distanceTo(mols[j].pos) < maxD) {
          const a = mols[i].pos
          const b = mols[j].pos
          arr.set([a.x, a.y, a.z, b.x, b.y, b.z], n * 6)
          n++
        }
      }
    }
    lineGeo.setDrawRange(0, n * 2)
    lineGeo.attributes.position.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={oRef} args={[undefined, undefined, N]}>
        <sphereGeometry args={[0.24, 20, 14]} />
        <meshStandardMaterial color="#e2493f" roughness={0.35} />
      </instancedMesh>
      <instancedMesh ref={hRef} args={[undefined, undefined, N * 2]}>
        <sphereGeometry args={[0.15, 16, 10]} />
        <meshStandardMaterial color="#f4f6f8" roughness={0.35} />
      </instancedMesh>
      <lineSegments geometry={lineGeo}>
        <lineBasicMaterial color="#8fd0ff" transparent opacity={0.55} />
      </lineSegments>
      <lineSegments ref={boxRef}>
        <edgesGeometry args={[new THREE.BoxGeometry(2, 2, 2)]} />
        <lineBasicMaterial color="#9fb3c8" transparent opacity={0.25} />
      </lineSegments>
    </group>
  )
}

export default function MoleculeViewer() {
  const waterState = useSim((s) => s.waterState)
  const setWaterState = useSim((s) => s.setWaterState)
  const temperature = useSim((s) => s.temperature)
  const info = WATER_STATES[waterState]
  return (
    <section className="panel molecules">
      <header className="panel-head">
        <h2>States of water</h2>
        <span className="muted small">H₂O molecules</span>
      </header>
      <div className="segmented three">
        {[
          ['solid', 'Solid', 'Ice'],
          ['liquid', 'Liquid', 'Water'],
          ['gas', 'Gas', 'Vapour'],
        ].map(([id, label, sub]) => (
          <button key={id} className={waterState === id ? 'on' : ''} onClick={() => setWaterState(id)}>
            <strong>{label}</strong>
            <span>{sub}</span>
          </button>
        ))}
      </div>
      <div className="molecule-canvas">
        <Canvas dpr={[1, 2]} camera={{ position: [3.5, 3.2, 8.5], fov: 40 }}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[4, 6, 5]} intensity={2.2} />
          <directionalLight position={[-5, -2, -3]} intensity={0.5} color="#9cc8ff" />
          <Molecules mode={waterState} />
          <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.8} />
        </Canvas>
        <div className="legend">
          <span>
            <i className="o" /> O
          </span>
          <span>
            <i className="h" /> H
          </span>
          {waterState !== 'gas' && (
            <span>
              <i className="hb" /> hydrogen bond
            </span>
          )}
        </div>
      </div>
      <p className="state-text">{info.text}</p>
      <p className="muted small now-note">
        {temperature < 0
          ? `At ${temperature} °C fresh water freezes into ice. Ice can still slowly turn straight into vapour (sublimation).`
          : temperature === 0
            ? 'At 0 °C ice and liquid water can exist together.'
            : `At ${temperature} °C water is liquid, and some of it evaporates into vapour.`}
      </p>
    </section>
  )
}
