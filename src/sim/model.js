import { clamp, LAPSE_PER_UNIT, MAX_HEIGHT, METERS_PER_UNIT } from '../world/terrain.js'

// Saturation vapour pressure over water (hPa), Bolton (1980).
// Warmer air/water can hold exponentially more vapour (~7% per °C), which is
// why evaporation rises steeply with temperature.
export const saturationVaporPressure = (T) => 6.112 * Math.exp((17.67 * T) / (T + 243.5))
const ES_REF = saturationVaporPressure(20)

// Seawater freezes at about -1.9 °C because dissolved salt lowers its freezing point.
export const SEAWATER_FREEZE_C = -1.9
// Precipitation usually reaches the ground as snow when the air near the
// ground is below ~1 °C (flakes need time to melt as they fall).
export const RAIN_SNOW_C = 1

const WEATHER = {
  // advect: moist air carried in from elsewhere (storm systems)
  // kc: how readily vapour condenses (rising, cooling air)
  // thr: cloud water needed before droplets grow heavy enough to fall
  sunny: { advect: 0.0, kc: 0.25, thr: 0.7, clear: 0.45, max: 0.85 },
  rainy: { advect: 0.32, kc: 0.85, thr: 0.25, clear: 0.0, max: 1.6 },
  snowy: { advect: 0.28, kc: 0.85, thr: 0.25, clear: 0.0, max: 1.6 },
}

export function createSimState() {
  return {
    time: 0,
    riverPhase: 0,
    temperature: 12,
    vapor: 0.3,
    cloud: 0.55,
    snowpack: 0.35,
    seaIce: 0,
    riverIce: 0,
    wet: 0.1,
    runoff: 0.35,
    cover: 0.5,
    effSun: 0.6,
    precip: 0,
    snowFrac: 0,
    freezingLevel: 5,
    snowLine: 5,
    rates: { evaporation: 0, condensation: 0, precipitation: 0, freezing: 0, melting: 0, runoff: 0 },
  }
}

const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt))

export function stepSimulation(s, c, dt) {
  if (dt <= 0) return
  s.time += dt
  const T = c.temperature
  s.temperature = T
  const sun = c.sunlight / 100
  const W = WEATHER[c.weather]

  // --- energy: clouds block part of the sunlight reaching the surface
  s.cover = clamp(s.cloud / 1.0, 0, 1)
  s.effSun = sun * (1 - 0.55 * s.cover)

  // --- evaporation from open (ice-free) ocean, driven by solar heating and
  // by temperature through the saturation vapour pressure
  const openWater = 1 - 0.9 * s.seaIce
  const evap = clamp(openWater * (0.12 + 0.88 * s.effSun) * (saturationVaporPressure(T) / ES_REF) * 0.5, 0, 2.6)

  // --- condensation: vapour cools as it rises and condenses into cloud droplets
  const cond = s.vapor * W.kc
  s.vapor = Math.max(0, s.vapor + (evap * 0.6 + W.advect - cond) * dt)

  // --- precipitation once cloud droplets grow heavy enough
  let precip = Math.max(0, s.cloud - W.thr) * 0.9
  // sunshine re-evaporates thin clouds on fair days
  const dissipate = W.clear * s.cloud * s.effSun
  let cloud = s.cloud + (cond - precip - dissipate) * dt
  // fair-weather clouds stay scattered: extra moisture rains out as showers
  if (cloud > W.max) {
    precip += (cloud - W.max) / dt
    cloud = W.max
  }
  s.cloud = Math.max(0, cloud)
  s.precip = precip

  // --- where does it fall as snow? (freezing level vs. terrain height)
  const freezingLevel = T / LAPSE_PER_UNIT // scene units above sea level where air hits 0 °C
  const snowLevel = (T - RAIN_SNOW_C) / LAPSE_PER_UNIT
  s.freezingLevel = freezingLevel
  s.snowFrac = clamp(1 - snowLevel / MAX_HEIGHT, 0, 1)
  const landPrecip = precip * 0.7 // mountains force air up: most falls over land
  const snowfall = landPrecip * s.snowFrac
  const rainLand = landPrecip * (1 - s.snowFrac)

  // --- snowpack: grows with snowfall, melts when air is above 0 °C
  const melt = s.snowpack * Math.max(0, T) * 0.012 * (0.4 + 0.6 * s.effSun)
  s.snowpack = clamp(s.snowpack + (snowfall * 0.45 - melt) * dt, 0, 1)

  // --- sea ice: forms from the shallow shore outwards below -1.9 °C
  const seaIceTarget = clamp((SEAWATER_FREEZE_C - T) / 14, 0, 1)
  let seaFreeze = 0
  let seaMelt = 0
  if (seaIceTarget > s.seaIce) {
    seaFreeze = (seaIceTarget - s.seaIce) * 0.14
    s.seaIce = Math.min(seaIceTarget, s.seaIce + seaFreeze * dt)
  } else if (s.seaIce > seaIceTarget) {
    seaMelt = (s.seaIce - seaIceTarget) * (0.12 + 0.012 * Math.max(0, T)) * (0.5 + s.effSun)
    s.seaIce = Math.max(seaIceTarget, s.seaIce - seaMelt * dt)
  }

  // --- river ice: fresh water freezes at 0 °C
  const riverIceTarget = T < 0 ? clamp(-T / 5, 0, 1) : 0
  let riverFreeze = 0
  let riverMelt = 0
  if (riverIceTarget > s.riverIce) {
    riverFreeze = (riverIceTarget - s.riverIce) * 0.35
    s.riverIce = Math.min(riverIceTarget, s.riverIce + riverFreeze * dt)
  } else if (s.riverIce > riverIceTarget) {
    riverMelt = (s.riverIce - riverIceTarget) * (0.25 + 0.02 * Math.max(0, T))
    s.riverIce = Math.max(riverIceTarget, s.riverIce - riverMelt * dt)
  }

  // --- runoff: rain on land + meltwater + groundwater baseflow, blocked by ice
  const baseflow = T > 0 ? 0.12 : 0.03
  const runoffTarget = (rainLand * 1.4 + melt * 5 + riverMelt * 1.5 + baseflow) * (1 - 0.85 * s.riverIce)
  s.runoff = approach(s.runoff, runoffTarget, 0.8, dt)
  s.wet = approach(s.wet, clamp(rainLand * 2.2, 0, 1), rainLand > 0.02 ? 0.6 : 0.12, dt)

  // Fresh snowpack pushes the visible snow line below the freezing level
  s.snowLine = freezingLevel - s.snowpack * 4.5

  const r = s.rates
  r.evaporation = clamp(evap / 0.9, 0, 1)
  r.condensation = clamp(cond / 0.6, 0, 1)
  r.precipitation = clamp(precip / 0.6, 0, 1)
  r.freezing = clamp((seaFreeze + riverFreeze) * 6 + (T < 0 ? 0.25 + 0.75 * s.snowFrac * r.precipitation * 0.5 : 0), 0, 1)
  r.melting = clamp(melt * 9 + (seaMelt + riverMelt) * 6, 0, 1)
  r.runoff = clamp(s.runoff / 1.1, 0, 1)
}

export function describeSim(s, c) {
  const T = c.temperature
  const precipActive = s.precip > 0.03
  let precipType = 'None'
  if (precipActive) {
    if (s.snowFrac > 0.97) precipType = 'Snow'
    else if (s.snowFrac < 0.05) precipType = 'Rain'
    else precipType = 'Snow on peaks, rain below'
  }
  return {
    temperature: T,
    freezingLevelM: Math.max(0, Math.round((s.freezingLevel * METERS_PER_UNIT) / 50) * 50),
    seaIce: s.seaIce,
    riverIce: s.riverIce,
    snowpack: s.snowpack,
    cover: s.cover,
    effSun: s.effSun,
    precipType,
    rates: { ...s.rates },
  }
}
