# Interactive 3D Water Cycle Simulator

A miniature, museum-style 3D diorama of the water cycle, built with **React**, **Three.js** and
**@react-three/fiber**. You can change the temperature, sunlight and weather and watch water move
between the ocean, the air, clouds, snow, ice and rivers.

## Run it

```bash
npm install
npm run dev      # open the printed URL (default http://localhost:5173)
npm run build    # production build in dist/
npm run preview  # serve the production build
```

## What you can do

| Control | Effect |
| --- | --- |
| **Temperature** (−20 °C to 50 °C, at sea level) | Moves the freezing level up and down the mountain, so snow cover grows or melts. Freezes the river below 0 °C and grows sea ice below −1.9 °C. Speeds up evaporation exponentially. Dries the grass in extreme heat. |
| **Sunlight** | Solar heating that drives evaporation and melting. Also sets the brightness of the scene. |
| **Weather**: Sunny / Rainy / Snowy | Sunny gives scattered clouds that re-evaporate in the sun. Rainy and Snowy bring in a moist storm system. Snowy lowers the temperature below freezing. Whether rain or snow reaches the ground still depends on the temperature there. |
| **Speed** 1× / 2× / 5×, **Pause/Play**, **Reset** | Control simulation time. |
| **Solid / Liquid / Gas** | An animated H₂O molecule view: a hexagonal ice lattice, liquid molecules tumbling past each other, or vapour molecules flying apart. |
| Process labels and the **Water cycle** list | Click one to show a short explanation of evaporation, condensation, precipitation, freezing, melting or runoff. The meters show how active each process is right now. |

Drag to orbit the landscape and scroll to zoom.

## The science model (simplified)

- **Evaporation** scales with the saturation vapour pressure of water (Bolton's formula, ~7% more
  per °C) and with solar heating. Sea ice blocks it.
- **Condensation** turns vapour into cloud water. **Precipitation** starts once clouds hold enough water.
- **Air cools with altitude** (6.5 °C per km, with 1 scene unit = 300 m). Each raindrop or snowflake
  is chosen from the temperature at the ground below it, so mild weather can give snow on the
  peaks and rain in the valleys.
- **Snowpack** builds from snowfall and melts above 0 °C. Fresh water freezes at 0 °C. Seawater
  freezes at about −1.9 °C, and sea ice spreads outward from the shallow coast.
- **Runoff** collects rain on land, meltwater and groundwater baseflow into the river. The river
  carries it back to the ocean, and ice slows it down.

## Project layout

```
src/
  world/terrain.js      procedural terrain, carved river, height sampling
  sim/model.js          water-cycle model (rates, stocks, phase changes)
  sim/store.js          zustand store for controls + shared mutable sim state
  scene/                3D components: terrain, ocean/river shaders, sky & sun,
                        trees, clouds, rain/snow, vapour, runoff, labels
  ui/                   control panel, process panel & info card, molecule viewer
  content/processes.js  educational text
```
