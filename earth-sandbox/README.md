# Earth Sandbox

A 2D world-building simulator. It starts on the **real Earth**: shape continents, change the
climate, and watch rivers, lakes, forests, deserts and ice sheets respond over time. You can also
generate random planets.

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
| **Real Earth / Random** | Load the real Earth, or generate a random planet. |
| **Reset** | Return the current world to how it began. |
| **Map view** | Biomes, temperature, rainfall, height, or People (habitability). |
| **Habitability meter** | How liveable the land is for humans (0–100), the change since the world started, and liveable land area. |

Scroll to zoom, and right-drag (or the Move tool) to pan. Hover over the map to inspect a location.

## How the world works

The map is a 432 × 216 grid in equirectangular projection (each cell is about 0.83° across).
Every tick the simulation updates:

- **Temperature** falls from the equator to the poles. It also drops 6.5 °C per km of altitude,
  and oceans make it milder. Painted warm or cold areas and the global slider shift it.
- **Rainfall** comes from moist air carried by the prevailing winds: trade winds near the
  equator, westerlies in mid-latitudes and polar easterlies. Air picks up moisture over water
  and drops it over land, much more where it is forced up mountains. That leaves dry rain
  shadows behind ranges and dry continental interiors. The equator is wet, and the subtropics
  around 30° are dry.
- **Water**: rain lands on the ground, evaporates or flows to the lowest neighbouring cell.
  The flow builds river networks and fills basins into lakes. Rivers slowly carve their valleys.
- **Snow and ice** fall where it is below freezing. Snow only lasts year-round where summers stay
  below freezing, so Siberia has taiga and Greenland has an ice sheet. Sea ice forms on cold
  oceans.
- **Vegetation** grows toward what temperature and moisture support (rainfall compared with
  evaporation). Warm, wet land becomes forest. Hot, dry land becomes desert. Land along rivers
  stays green.
- **Sea level** follows the slider, plus thermal expansion, plus water released from or locked
  into land ice. Melting all the land ice adds about 70 m. A new ice age can lower the sea by
  more than 100 m.

- **Habitability** rates each land cell for people from 0 to 1. Mild yearly temperatures
  (about 10–23 °C) score best, and dangerous heat sets in above about 25 °C. The other factors
  are fresh water from rain, rivers and lakes; altitude (thin air above about 2.5 km);
  permanent ice; and vegetation for food. The meter is the land-area-weighted average, and
  "liveable land" counts cells scoring above 0.45.

All changes approach their new state gradually, so you can watch the world adjust.

## Real Earth data

`earth-data.js` holds a 432 × 216 elevation grid in metres. Land heights come from the
NASA-derived topography and water mask images in the
[three-globe](https://github.com/vasturiano/three-globe) package (MIT licence). Those images
have no ocean depths, so the sea floor is estimated from distance to the coast (shelf, slope,
abyssal plain). Rebuild the file with:

```bash
npm pack three-globe && tar -xzf three-globe-*.tgz
python3 tools/build_earth_data.py package/example/img earth-data.js   # needs numpy and Pillow
```

The climate is a simple annual-average model. It reproduces the broad pattern: deserts near 30°,
rainforests at the equator, dry continental interiors, rain shadows and polar ice. It leaves out
monsoons and ocean currents, so some regions, such as India and Western Europe, come out drier
or colder than in reality.
