import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sim, useSim } from '../sim/store.js'

export const SUN_POS = new THREE.Vector3(0, 20, -27)
export const SUN_DIR = SUN_POS.clone().normalize()

function makeGlowTexture() {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grd.addColorStop(0, 'rgba(255,248,220,1)')
  grd.addColorStop(0.25, 'rgba(255,226,150,0.55)')
  grd.addColorStop(0.6, 'rgba(255,200,120,0.12)')
  grd.addColorStop(1, 'rgba(255,200,120,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const skyFragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uSunDir;
  uniform float uSun;
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.6, h));
    col = mix(col, uBottom, smoothstep(0.0, -0.35, h));
    float sd = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
    col += vec3(1.0, 0.85, 0.6) * pow(sd, 12.0) * 0.25 * uSun;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const lin = (hex) => new THREE.Color(hex)
const CLEAR = { top: lin('#3f86d8'), horizon: lin('#b9d8f2'), bottom: lin('#dce8f3') }
const GREY = { top: lin('#6e7c8c'), horizon: lin('#b8c0c8'), bottom: lin('#d5d9de') }
const COLD = { top: lin('#6d93c0'), horizon: lin('#e3edf6'), bottom: lin('#eef3f8') }
const HOT = { top: lin('#4f8fcf'), horizon: lin('#f3e2c4'), bottom: lin('#f3ede4') }

export default function Sky() {
  const glow = useMemo(makeGlowTexture, [])
  const sunRef = useRef()
  const glowRef = useRef()
  const dirRef = useRef()
  const hemiRef = useRef()
  const tmp = useMemo(() => ({ a: new THREE.Color(), b: new THREE.Color() }), [])
  const uniforms = useMemo(
    () => ({
      uTop: { value: CLEAR.top.clone() },
      uHorizon: { value: CLEAR.horizon.clone() },
      uBottom: { value: CLEAR.bottom.clone() },
      uSunDir: { value: SUN_DIR.clone() },
      uSun: { value: 1 },
    }),
    []
  )
  const smooth = useRef({ sun: 0.7, cover: 0.4 })

  useFrame((state, delta) => {
    const s = smooth.current
    const k = 1 - Math.exp(-delta * 2.5)
    const { sunlight: sunPct, weather } = useSim.getState()
    const sunlight = sunPct / 100
    s.sun += (sunlight - s.sun) * k
    s.cover += (sim.cover - s.cover) * k
    const T = sim.temperature
    const hot = THREE.MathUtils.smoothstep(T, 28, 45)
    const cold = THREE.MathUtils.smoothstep(-T, 0, 15)
    for (const key of ['top', 'horizon', 'bottom']) {
      const u = uniforms[key === 'top' ? 'uTop' : key === 'horizon' ? 'uHorizon' : 'uBottom'].value
      tmp.a.copy(CLEAR[key]).lerp(HOT[key], hot).lerp(COLD[key], cold)
      tmp.a.lerp(GREY[key], Math.pow(s.cover, 1.6) * (weather === 'sunny' ? 0.35 : 0.85))
      // dim the whole sky a little when sunlight is weak
      tmp.a.multiplyScalar(0.62 + 0.38 * s.sun)
      u.copy(tmp.a)
    }
    uniforms.uSun.value = s.sun * (1 - s.cover * 0.8)

    const eff = s.sun * (1 - 0.55 * s.cover)
    if (dirRef.current) dirRef.current.intensity = 0.35 + 2.6 * eff
    if (hemiRef.current) hemiRef.current.intensity = 0.55 + 0.35 * s.sun
    if (sunRef.current) {
      const sc = 0.6 + 0.7 * s.sun
      sunRef.current.scale.setScalar(sc)
      sunRef.current.material.color.setRGB(1, 0.93 + 0.05 * s.sun, 0.7 + 0.15 * s.sun)
    }
    if (glowRef.current) {
      glowRef.current.scale.setScalar(5 + 9 * s.sun)
      glowRef.current.material.opacity = (0.25 + 0.75 * s.sun) * (1 - s.cover * 0.5)
    }
  })

  return (
    <group>
      <mesh scale={160} renderOrder={-10}>
        <sphereGeometry args={[1, 32, 16]} />
        <shaderMaterial
          vertexShader={skyVertex}
          fragmentShader={skyFragment}
          uniforms={uniforms}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>

      <group position={SUN_POS}>
        <mesh ref={sunRef}>
          <sphereGeometry args={[1.5, 32, 16]} />
          <meshBasicMaterial color="#fff2c0" toneMapped={false} />
        </mesh>
        <sprite ref={glowRef} scale={12}>
          <spriteMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </sprite>
      </group>

      <hemisphereLight ref={hemiRef} args={['#dbeaff', '#5b6b4a', 0.8]} />
      <directionalLight
        ref={dirRef}
        position={SUN_POS.clone().multiplyScalar(1.6)}
        intensity={2}
        color="#fff4e0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
    </group>
  )
}
