import { useSim } from '../sim/store.js'
import { PROCESSES, PROCESS_ORDER } from '../content/processes.js'
import { CloseIcon } from './Icons.jsx'

export function ProcessPanel() {
  const rates = useSim((s) => s.snapshot.rates)
  const selected = useSim((s) => s.selectedProcess)
  const select = useSim((s) => s.selectProcess)
  return (
    <section className="panel processes">
      <header className="panel-head">
        <h2>Water cycle</h2>
        <span className="muted small">activity now</span>
      </header>
      <ul>
        {PROCESS_ORDER.map((id) => {
          const p = PROCESSES[id]
          const r = rates[id]
          return (
            <li key={id}>
              <button
                className={`process-row${selected === id ? ' on' : ''}`}
                style={{ '--accent': p.color }}
                onClick={() => select(id)}
              >
                <span className="dot" />
                <span className="name">{p.title}</span>
                <span className="meter">
                  <span style={{ width: `${Math.round(Math.max(0.02, r) * 100)}%` }} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="muted small">Click a process here or a label in the scene to learn what is happening.</p>
    </section>
  )
}

export function InfoCard() {
  const selected = useSim((s) => s.selectedProcess)
  const select = useSim((s) => s.selectProcess)
  if (!selected) return null
  const p = PROCESSES[selected]
  return (
    <aside className="info-card" style={{ '--accent': p.color }} key={selected}>
      <button className="icon-btn close" onClick={() => select(selected)} aria-label="Close explanation">
        <CloseIcon />
      </button>
      <div className="info-kicker">
        <span className="dot" /> Water cycle process
      </div>
      <h3>{p.title}</h3>
      <p className="info-summary">{p.summary}</p>
      {p.text.map((t, i) => (
        <p key={i}>{t}</p>
      ))}
      <p className="info-fact">{p.fact}</p>
      <p className="info-try">
        <strong>Try it:</strong> {p.tryIt}
      </p>
    </aside>
  )
}
