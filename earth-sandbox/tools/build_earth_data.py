"""Build earth-data.js: a coarse real-Earth elevation grid for Earth Sandbox.

Inputs (from the three-globe npm package, example/img/, MIT licensed; the
images are derived from NASA Blue Marble / topography data):
  earth-topology.png  2048x1024 greyscale land elevation, ~25 m per grey level
  earth-water.png     1600x800  water mask (white = water)

Land heights come from the topography image. Ocean depths are not in the
source, so they are approximated from distance to the nearest coast
(continental shelf, slope, abyssal plain). Small enclosed water bodies are
kept as lakes.

Usage: python3 build_earth_data.py <three-globe img dir> <output earth-data.js>
"""
import base64
import sys
from collections import deque

import numpy as np
from PIL import Image

W, H = 432, 216
M_PER_LEVEL = 25.0
LAKE_MAX_CELLS = 40

src, out = sys.argv[1], sys.argv[2]

topo = Image.open(f"{src}/earth-topology.png").convert("L").resize((W, H), Image.BOX)
topo_m = np.asarray(topo, dtype=np.float64) * M_PER_LEVEL
water_img = Image.open(f"{src}/earth-water.png").convert("L").resize((W, H), Image.BOX)
wf = np.asarray(water_img, dtype=np.float64) / 255.0  # water fraction per cell
is_water = wf >= 0.5


def neighbours(y, x):
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            ny = y + dy
            if 0 <= ny < H:
                yield ny, (x + dx) % W  # wrap east-west


# --- connected water bodies --------------------------------------------------
label = -np.ones((H, W), dtype=np.int32)
sizes = []
for y in range(H):
    for x in range(W):
        if not is_water[y, x] or label[y, x] >= 0:
            continue
        n = len(sizes)
        q = deque([(y, x)])
        label[y, x] = n
        count = 0
        while q:
            cy, cx = q.popleft()
            count += 1
            for ny, nx in neighbours(cy, cx):
                if is_water[ny, nx] and label[ny, nx] < 0:
                    label[ny, nx] = n
                    q.append((ny, nx))
        sizes.append(count)
lake_ids = {i for i, s in enumerate(sizes) if s <= LAKE_MAX_CELLS}
is_lake = np.isin(label, list(lake_ids)) & is_water
is_ocean = is_water & ~is_lake

# --- distance (in cells) from each ocean cell to land ---------------------------
dist = np.full((H, W), np.inf)
q = deque()
for y in range(H):
    for x in range(W):
        if not is_ocean[y, x]:
            dist[y, x] = 0
            q.append((y, x))
while q:
    cy, cx = q.popleft()
    for ny, nx in neighbours(cy, cx):
        if dist[ny, nx] > dist[cy, cx] + 1:
            dist[ny, nx] = dist[cy, cx] + 1
            q.append((ny, nx))


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


rng = np.random.default_rng(7)
noise = Image.fromarray((rng.random((H // 8, W // 8)) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
noise = np.asarray(noise, dtype=np.float64) / 255.0 - 0.5

# shelf (~0-200 m), continental slope, abyssal plain (~4-5.5 km)
depth = 40 + 160 * smooth(0, 1.5, dist) + 3800 * smooth(1.2, 6, dist) + 900 * noise * smooth(2, 6, dist)
# cells that are partly land sit on the shelf
depth *= np.where(wf < 0.75, 0.6, 1.0)

elev = np.where(is_ocean, -depth, 0.0)
# land: real topography, with a gentle rise inland from the coast so that
# low plains still drain toward the sea
coast_rise = 3 + (0.5 - np.minimum(wf, 0.5)) * 60
land = ~is_water
elev[land] = np.maximum(topo_m[land], coast_rise[land])

# lakes: surface at the lowest neighbouring land, with a modest depth
lakes = []
for y in range(H):
    for x in range(W):
        if not is_lake[y, x]:
            continue
        rim = [elev[ny, nx] for ny, nx in neighbours(y, x) if land[ny, nx]]
        surface = max(5.0, min(rim) if rim else topo_m[y, x])
        d = 40.0 + 60.0 * (wf[y, x] - 0.5) * 2
        elev[y, x] = surface - d
        lakes.append((y * W + x, int(round(d))))

elev_i16 = np.clip(np.round(elev), -8000, 9000).astype("<i2")
b64 = base64.b64encode(elev_i16.tobytes()).decode()
lake_flat = ",".join(f"{i},{d}" for i, d in lakes)

with open(out, "w") as f:
    f.write(
        "/* Real Earth elevation for Earth Sandbox: 432x216 cells, equirectangular\n"
        " * (180°W at the left edge, 90°N at the top), metres as little-endian int16.\n"
        " * Land heights from NASA-derived topography (three-globe, MIT); ocean depths\n"
        " * are approximated from distance to the coast. Built by tools/build_earth_data.py */\n"
    )
    f.write(f"window.EARTH_DATA = {{ w: {W}, h: {H}, elev: '{b64}', lakes: [{lake_flat}] }}\n")

print("land cells", int(land.sum()), "ocean", int(is_ocean.sum()), "lakes", len(lakes), "max", elev.max(), "min", elev.min())
