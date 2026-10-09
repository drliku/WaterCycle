# Earth Sandbox

A 2D world-building simulator. Shape continents, change the climate, and watch rivers, lakes,
forests, deserts and ice sheets respond over time.

Open `index.html` in a browser. There is no build step, and it works offline (the Barlow body font
loads from Google Fonts when online and falls back to a system font).

## Controls

| | |
| --- | --- |
| **Tools** (bottom dock, keys 1–6) | Move, Raise, Lower, Water, Temp (warmer / colder), Rain (wetter / drier). Drag on the map to use them. |
| **Brush** | Brush size (or `[` and `]`). |
| **Global temperature** | Shifts the whole climate by −10 °C to +10 °C. |
| **Rainfall** | Scales precipitation from 25% to 250%. |
| **Sea level** | Raises or lowers the ocean by up to 200 m. |
| **Speed / Pause** | 0.25× to 8×. `P` pauses. |
| **New world / Reset world** | Generate a fresh planet, or return to the start of the current one. |
| **Map view** | Biomes, temperature, rainfall or height. |

Scroll to zoom, and right-drag (or the Move tool) to pan. Hover over the map to inspect a location.

## How the world works

The map is a grid of 384 × 240 cells. Every tick the simulation updates:

- **Temperature** falls from the equator to the poles. It also drops 6.5 °C per km of altitude,
  and oceans make it milder. Painted warm or cold areas and the global slider shift it.
- **Rainfall** comes from moist air carried by the prevailing winds: trade winds near the
  equator, westerlies in mid-latitudes and polar easterlies. Air picks up moisture over water
  and drops it over land, much more where it is forced up mountains. That leaves dry rain
  shadows behind ranges and dry continental interiors. The equator is wet, and the subtropics
  around 30° are dry.
- **Water**: rain lands on the ground, evaporates or flows to the lowest neighbouring cell.
  The flow builds river networks and fills basins into lakes. Rivers slowly carve their valleys.
- **Snow and ice** build up where it is below freezing and melt when it warms. Sea ice forms on
  cold oceans.
- **Vegetation** grows toward what temperature and moisture support (rainfall compared with
  evaporation). Warm, wet land becomes forest. Hot, dry land becomes desert. Land along rivers
  stays green.
- **Sea level** follows the slider, plus thermal expansion, plus water released from or locked
  into land ice. Melting all the land ice adds about 70 m. A new ice age can lower the sea by
  more than 100 m.

All changes approach their new state gradually, so you can watch the world adjust.
