import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { sim, simDelta, useSim } from '../sim/store.js'
import { stepSimulation, describeSim } from '../sim/model.js'

// Advances the water-cycle model every frame and publishes a low-frequency
// snapshot for the UI meters.
export default function SimulationDriver() {
  const timer = useRef(0)
  useFrame((_, delta) => {
    const controls = useSim.getState()
    const dt = simDelta(delta)
    if (dt > 0) {
      // sub-step so 5× speed stays stable
      const steps = Math.ceil(dt / 0.05)
      for (let i = 0; i < steps; i++) stepSimulation(sim, controls, dt / steps)
      sim.riverPhase += dt * (0.25 + 1.3 * Math.min(sim.runoff, 1.2)) * (1 - 0.95 * sim.riverIce)
    } else {
      sim.temperature = controls.temperature
    }
    timer.current += delta
    if (timer.current > 0.2) {
      timer.current = 0
      controls.setSnapshot(describeSim(sim, controls))
    }
  })
  return null
}
