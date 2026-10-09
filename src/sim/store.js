import { create } from 'zustand'
import { createSimState, describeSim } from './model.js'

export const DEFAULT_CONTROLS = {
  temperature: 12,
  sunlight: 70,
  weather: 'sunny',
  speed: 1,
  paused: false,
}

// The mutable simulation state is advanced every frame by <SimulationDriver/>
// and read directly by scene components inside useFrame (no React re-renders).
export const sim = createSimState()

export const useSim = create((set, get) => ({
  ...DEFAULT_CONTROLS,
  selectedProcess: null,
  waterState: 'liquid',
  resetCount: 0,
  snapshot: describeSim(sim, DEFAULT_CONTROLS),

  setTemperature: (temperature) => set({ temperature }),
  setSunlight: (sunlight) => set({ sunlight }),
  setSpeed: (speed) => set({ speed }),
  togglePaused: () => set({ paused: !get().paused }),
  setWeather: (weather) => {
    const s = get()
    const patch = { weather }
    // Presets nudge the conditions so the chosen weather can actually happen.
    if (weather === 'snowy' && s.temperature > -2) patch.temperature = -6
    if (weather === 'rainy' && s.temperature < 4) patch.temperature = 14
    if (weather === 'sunny' && s.sunlight < 60) patch.sunlight = 80
    set(patch)
  },
  selectProcess: (selectedProcess) =>
    set({ selectedProcess: get().selectedProcess === selectedProcess ? null : selectedProcess }),
  setWaterState: (waterState) => set({ waterState }),
  setSnapshot: (snapshot) => set({ snapshot }),
  reset: () => {
    Object.assign(sim, createSimState())
    set({ ...DEFAULT_CONTROLS, selectedProcess: null, resetCount: get().resetCount + 1 })
  },
}))

// Simulation time step for this frame (0 while paused), shared by every
// animated part of the scene so speed and pause apply consistently.
export function simDelta(delta) {
  const { paused, speed } = useSim.getState()
  return paused ? 0 : Math.min(delta, 0.05) * speed
}
