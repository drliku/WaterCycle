import World from './scene/World.jsx'
import ControlPanel from './ui/ControlPanel.jsx'
import { ProcessPanel, InfoCard } from './ui/ProcessPanel.jsx'
import MoleculeViewer from './ui/MoleculeViewer.jsx'
import { useSim } from './sim/store.js'
import { DropIcon } from './ui/Icons.jsx'

function Readouts() {
  const snap = useSim((s) => s.snapshot)
  const items = [
    ['Freezing level', snap.freezingLevelM > 0 ? `${snap.freezingLevelM.toLocaleString()} m` : 'Ground level'],
    ['Cloud cover', `${Math.round(snap.cover * 100)}%`],
    ['Snowpack', `${Math.round(snap.snowpack * 100)}%`],
    ['Sea ice', `${Math.round(snap.seaIce * 100)}%`],
  ]
  return (
    <div className="readouts">
      {items.map(([k, v]) => (
        <div key={k}>
          <span>{k}</span>
          <strong>{v}</strong>
        </div>
      ))}
    </div>
  )
}

export default function App() {
  return (
    <div className="app">
      <div className="stage">
        <World />
      </div>

      <div className="overlay left">
        <header className="title-card panel">
          <div className="logo">
            <DropIcon />
          </div>
          <div>
            <h1>Water Cycle Simulator</h1>
            <p>Drag to orbit · scroll to zoom</p>
          </div>
        </header>
        <Readouts />
        <ControlPanel />
      </div>

      <div className="overlay right">
        <ProcessPanel />
        <MoleculeViewer />
      </div>

      <InfoCard />
    </div>
  )
}
