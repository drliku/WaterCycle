import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import Terrain from './Terrain.jsx'
import { Ocean, River } from './Water.jsx'
import Sky from './Sky.jsx'
import Trees from './Trees.jsx'
import Clouds from './Clouds.jsx'
import { Precipitation, Evaporation, Runoff } from './Particles.jsx'
import Labels from './Labels.jsx'
import SimulationDriver from './SimulationDriver.jsx'

export default function World() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [38, 29, 40], fov: 42, near: 0.5, far: 500 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
    >
      <SimulationDriver />
      <Sky />
      <Terrain />
      <Ocean />
      <River />
      <Trees />
      <Clouds />
      <Evaporation />
      <Precipitation />
      <Runoff />
      <Labels />
      <OrbitControls
        makeDefault
        target={[0, 2, 0]}
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minDistance={14}
        maxDistance={90}
        maxPolarAngle={Math.PI * 0.47}
        rotateSpeed={0.6}
        zoomSpeed={0.8}
      />
    </Canvas>
  )
}
