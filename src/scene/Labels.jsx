import { Html } from '@react-three/drei'
import { useSim } from '../sim/store.js'
import { PROCESSES } from '../content/processes.js'
import { heightAt, riverCurve } from '../world/terrain.js'

const riverMid = riverCurve.getPointAt(0.42)

// Positions chosen where each process happens in the landscape
const LABELS = [
  { id: 'evaporation', pos: [14, 3.2, 5.5] },
  { id: 'condensation', pos: [11, 9.3, -9] },
  { id: 'precipitation', pos: [-3.5, 6.6, -6.5] },
  { id: 'freezing', pos: [8.5, 1.4, -10.5] },
  { id: 'melting', pos: [-9.5, 6.4, -1.5] },
  { id: 'runoff', pos: [riverMid.x, heightAt(riverMid.x, riverMid.z) + 1.4, riverMid.z] },
]

export default function Labels() {
  const selected = useSim((s) => s.selectedProcess)
  const select = useSim((s) => s.selectProcess)
  const rates = useSim((s) => s.snapshot.rates)
  return (
    <group>
      {LABELS.map(({ id, pos }) => {
        const p = PROCESSES[id]
        const active = rates[id] > 0.06
        return (
          <Html key={id} position={pos} center zIndexRange={[20, 0]}>
            <button
              className={`scene-label${selected === id ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
              style={{ '--accent': p.color }}
              onClick={() => select(id)}
              title={p.summary}
            >
              <span className="dot" />
              {p.title}
            </button>
          </Html>
        )
      })}
    </group>
  )
}
