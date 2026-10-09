import { useSim } from '../sim/store.js'
import { SunIcon, RainIcon, SnowIcon, PlayIcon, PauseIcon, ResetIcon, ThermoIcon } from './Icons.jsx'

function temperatureHint(T) {
  if (T <= -2) return 'Below −1.9 °C: sea ice spreads from the coast; rivers freeze.'
  if (T < 0) return 'Below 0 °C: fresh water freezes. Salty seawater needs about −1.9 °C.'
  if (T < 8) return 'Cold: snow on the mountains, little evaporation.'
  if (T < 25) return 'Mild: snow only on the high peaks, steady evaporation.'
  if (T < 38) return 'Warm: snow melts, evaporation speeds up.'
  return 'Hot: rapid evaporation, towering clouds, dry land.'
}

const WEATHER = [
  { id: 'sunny', label: 'Sunny', Icon: SunIcon },
  { id: 'rainy', label: 'Rainy', Icon: RainIcon },
  { id: 'snowy', label: 'Snowy', Icon: SnowIcon },
]

export default function ControlPanel() {
  const s = useSim()
  const precipType = s.snapshot.precipType
  const T = s.temperature
  const tPct = ((T + 20) / 70) * 100
  let weatherNote = null
  if (s.weather === 'snowy' && T > 2) weatherNote = 'Too warm for snow at sea level, so it falls as rain (snow only on the peaks).'
  if (s.weather === 'rainy' && T < 0) weatherNote = 'Below freezing, the rain falls as snow instead.'

  return (
    <section className="panel controls">
      <header className="panel-head">
        <h2>Controls</h2>
        <span className={`status-pill ${s.paused ? 'paused' : ''}`}>{s.paused ? 'Paused' : 'Running'}</span>
      </header>

      <div className="control">
        <label htmlFor="temp">
          <ThermoIcon /> Temperature <span className="muted small">(sea level)</span>
          <output className={T < 0 ? 'cold' : T > 30 ? 'hot' : ''}>{T > 0 ? `+${T}` : T} °C</output>
        </label>
        <input
          id="temp"
          type="range"
          className="slider temp"
          min={-20}
          max={50}
          step={1}
          value={T}
          style={{ '--pct': `${tPct}%` }}
          onChange={(e) => s.setTemperature(Number(e.target.value))}
        />
        <div className="ticks">
          <span>−20</span>
          <span style={{ left: `${(20 / 70) * 100}%` }}>0</span>
          <span style={{ left: `${(40 / 70) * 100}%` }}>20</span>
          <span>50</span>
        </div>
        <p className="hint">{temperatureHint(T)}</p>
      </div>

      <div className="control">
        <label htmlFor="sun">
          <SunIcon /> Sunlight <span className="muted small">(solar heating)</span>
          <output>{s.sunlight}%</output>
        </label>
        <input
          id="sun"
          type="range"
          className="slider sun"
          min={0}
          max={100}
          step={1}
          value={s.sunlight}
          style={{ '--pct': `${s.sunlight}%` }}
          onChange={(e) => s.setSunlight(Number(e.target.value))}
        />
      </div>

      <div className="control">
        <span className="control-label">Weather</span>
        <div className="segmented three">
          {WEATHER.map(({ id, label, Icon }) => (
            <button key={id} className={s.weather === id ? 'on' : ''} onClick={() => s.setWeather(id)}>
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <p className="hint">
          Falling now: <strong>{precipType}</strong>
          {weatherNote && <span className="note"> · {weatherNote}</span>}
        </p>
      </div>

      <div className="control row">
        <div className="grow">
          <span className="control-label">Simulation speed</span>
          <div className="segmented three compact">
            {[1, 2, 5].map((v) => (
              <button key={v} className={s.speed === v ? 'on' : ''} onClick={() => s.setSpeed(v)}>
                {v}×
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="actions">
        <button className="btn primary" onClick={s.togglePaused}>
          {s.paused ? <PlayIcon /> : <PauseIcon />}
          {s.paused ? 'Play' : 'Pause'}
        </button>
        <button className="btn" onClick={s.reset}>
          <ResetIcon /> Reset
        </button>
      </div>
    </section>
  )
}
