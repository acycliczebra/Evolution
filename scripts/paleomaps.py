"""Build globe textures for the site from scientific paleogeography sources.

  0–540 Ma      PALEOMAP PaleoDEMs (Scotese & Wright 2018, CC BY 4.0), elevation + bathymetry every 5 Myr
                https://www.earthbyte.org/webdav/ftp/Data_Collections/Scotese_Wright_2018_PaleoDEM/
                (paleoDEM_0.2Deg_grids.zip, unzipped)
  545–1000 Ma   GPlates Web Service, plate model MERDITH2021 (Merdith et al. 2021): reconstructed
                coastlines only (no elevation), every 25 Myr
  > 1000 Ma     no reliable global reconstruction: stylised placeholder globes

Writes web/public/earth/*.webp and web/public/earth/index.json.

Usage (needs numpy, pillow, netCDF4):
  python paleomaps.py <paleodem_grid_dir> <cache_dir> <repo_root>
"""
import glob
import json
import os
import re
import sys
import urllib.request

import netCDF4
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 2048, 1024          # colour texture (equirectangular)
BW, BH = 1024, 512         # bump (height) texture
GPLATES = "https://gws.gplates.org/reconstruct/coastlines/?time={t}&model=MERDITH2021"
GPLATES_TIMES = list(range(550, 1001, 25))

# hypsometric palettes: (elevation m, rgb)
OCEAN = [(-7000, (8, 22, 58)), (-4500, (14, 42, 96)), (-2500, (22, 70, 138)), (-800, (34, 108, 170)),
         (-150, (58, 150, 196)), (0, (98, 190, 208))]
LAND_GREEN = [(0, (86, 124, 64)), (300, (112, 140, 76)), (800, (160, 150, 96)), (1600, (150, 118, 82)),
              (2800, (132, 112, 98)), (4000, (180, 174, 168)), (5500, (240, 240, 244))]
LAND_BARREN = [(0, (150, 116, 84)), (300, (166, 128, 92)), (800, (176, 142, 104)), (1600, (156, 120, 92)),
               (2800, (134, 112, 100)), (4000, (180, 174, 168)), (5500, (240, 240, 244))]


def ramp(z, stops):
    xs = [s[0] for s in stops]
    return np.stack([np.interp(z, xs, [s[1][c] for s in stops]) for c in range(3)], axis=-1)


def vegetation(ma):
    """0 = barren land (before land plants), 1 = vegetated; transition ~470 → 400 Ma."""
    return float(np.clip((470 - ma) / 70, 0, 1))


def hillshade(z, strength=1.0):
    # z rows run north → south; account for meridians converging towards the poles
    lat = np.linspace(90, -90, z.shape[0])[:, None]
    coslat = np.clip(np.cos(np.radians(lat)), 0.05, 1)
    cell = 40000e3 / z.shape[1]  # metres per pixel at the equator
    gy, gx = np.gradient(z)
    gx = gx / (cell * coslat)
    gy = gy / cell
    exaggeration = 25
    nx, ny = -gx * exaggeration, gy * exaggeration
    light = np.array([-0.6, 0.6, 0.55])
    light /= np.linalg.norm(light)
    shade = (nx * light[0] + ny * light[1] + light[2]) / np.sqrt(nx * nx + ny * ny + 1)
    return 1 + (np.clip(shade, 0, 1) / light[2] - 1) * strength


def resize_float(a, w, h):
    return np.asarray(Image.fromarray(a.astype(np.float32), mode="F").resize((w, h), Image.BILINEAR))


def land_center(land):
    """[lon, lat] of the centre of mass of the land (area-weighted), to face it on the globe."""
    h, w = land.shape
    lat = np.radians(np.linspace(90, -90, h))[:, None]
    lon = np.radians(np.linspace(-180, 180, w, endpoint=False))[None, :]
    wgt = land * np.cos(lat)
    if wgt.sum() == 0:
        return [0.0, 0.0]
    x = (wgt * np.cos(lat) * np.cos(lon)).sum()
    y = (wgt * np.cos(lat) * np.sin(lon)).sum()
    z = (wgt * np.sin(lat)).sum()
    return [round(float(np.degrees(np.arctan2(y, x))), 1), round(float(np.degrees(np.arctan2(z, np.hypot(x, y)))), 1)]


def save(rgb, path, quality=82):
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).save(path, "WEBP", quality=quality, method=6)


def save_bump(z, path):
    zb = resize_float(z, BW, BH)
    g = np.clip((zb + 7000) / 13000 * 255, 0, 255)
    Image.fromarray(g.astype(np.uint8), mode="L").save(path, "WEBP", quality=80, method=6)


def paleodem(path, ma, out):
    d = netCDF4.Dataset(path)
    z = np.asarray(d["z"][:], dtype=np.float32)
    lat = np.asarray(d["lat"][:])
    if lat[0] < lat[-1]:
        z = z[::-1]                     # north-up rows
    z = z[:, :-1]                       # drop duplicated 180° column
    z = resize_float(z, W, H)
    land = z > 0
    v = vegetation(ma)
    land_rgb = ramp(z, LAND_BARREN) * (1 - v) + ramp(z, LAND_GREEN) * v
    rgb = np.where(land[..., None], land_rgb, ramp(z, OCEAN))
    shade = np.where(land, hillshade(z, 1.0), hillshade(z, 0.35))
    rgb = rgb * shade[..., None]
    save(rgb, os.path.join(out, f"dem_{ma:g}.webp"))
    save_bump(z, os.path.join(out, f"dem_{ma:g}_h.webp"))
    return land_center(land)


def value_noise(w, h, seed, octaves=6):
    rng = np.random.default_rng(seed)
    acc = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        gw, gh = 4 * 2 ** o, 2 * 2 ** o
        grid = rng.random((gh, gw)).astype(np.float32)
        grid = np.concatenate([grid, grid[:, :1]], axis=1)  # wrap east-west: no seam at the dateline
        acc += resize_float(grid, w + w // gw, h)[:, :w] * amp
        total += amp
        amp *= 0.55
    return acc / total


def gplates(t, cache, out):
    fn = os.path.join(cache, f"merdith2021_{t}.json")
    if not os.path.exists(fn):
        req = urllib.request.Request(GPLATES.format(t=t), headers={"User-Agent": "EvolutionTreeBuilder/1.0"})
        with urllib.request.urlopen(req, timeout=120) as r, open(fn, "wb") as f:
            f.write(r.read())
    feats = json.load(open(fn, encoding="utf-8"))["features"]
    mask = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(mask)
    for f in feats:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            ring = [((x + 180) / 360 * W, (90 - y) / 180 * H) for x, y in poly[0]]
            if len(ring) >= 3:
                draw.polygon(ring, fill=255)
    m = np.asarray(mask, np.float32) / 255
    # no elevation data: synthesise gentle relief inside land and a continental shelf around it
    shelf = np.asarray(mask.filter(ImageFilter.GaussianBlur(22)), np.float32) / 255
    relief = value_noise(W, H, seed=t)
    z = np.where(m > 0.5, 30 + relief ** 1.6 * 1800, -4300 + np.clip(shelf * 2.2, 0, 1) * 4150)
    land_rgb = ramp(z, LAND_BARREN)
    rgb = np.where((m > 0.5)[..., None], land_rgb, ramp(z, OCEAN))
    rgb = rgb * hillshade(np.where(m > 0.5, z, -4000), 0.6)[..., None]
    save(rgb, os.path.join(out, f"gp_{t}.webp"))
    save_bump(z, os.path.join(out, f"gp_{t}_h.webp"))
    return land_center(m > 0.5)


def placeholder(kind, out):
    n = value_noise(W, H, seed=7 if kind == "hadean" else 11, octaves=7)
    if kind == "hadean":
        # dark cooling crust with glowing magma between plates
        cracks = np.clip(1 - np.abs(n - 0.5) * 18, 0, 1) ** 2
        base = ramp(n * 1000, [(0, (40, 26, 24)), (500, (70, 44, 34)), (1000, (30, 22, 22))])
        rgb = base * (1 - cracks[..., None]) + np.array([255, 110, 30]) * cracks[..., None]
        z = n * 2000
    else:
        # water world: the continents of this age are too poorly known to draw
        z = -3500 + n * 3000
        rgb = ramp(z, OCEAN)
    save(rgb * hillshade(z, 0.3)[..., None], os.path.join(out, f"{kind}.webp"))
    save_bump(z, os.path.join(out, f"{kind}_h.webp"))


def main():
    dem_dir, cache, root = sys.argv[1:4]
    out = os.path.join(root, "web", "public", "earth")
    os.makedirs(out, exist_ok=True)
    os.makedirs(cache, exist_ok=True)
    index = []
    for path in sorted(glob.glob(os.path.join(dem_dir, "*.nc"))):
        name = os.path.basename(path)
        m = re.search(r"PALEOMAP_1deg_(.+)_(\d+(?:\.\d+)?)Ma", name)
        ma = float(m.group(2))
        label = m.group(1).replace("_", " ").replace("Cambrian Precambrian", "Cambrian/Precambrian")
        center = paleodem(path, ma, out)
        index.append({"ma": ma, "src": "paleodem", "tex": f"dem_{ma:g}.webp", "bump": f"dem_{ma:g}_h.webp",
                      "label": label, "center": center})
        print(f"PaleoDEM {ma:g} Ma  {label}", flush=True)
    for t in GPLATES_TIMES:
        center = gplates(t, cache, out)
        index.append({"ma": t, "src": "gplates", "tex": f"gp_{t}.webp", "bump": f"gp_{t}_h.webp", "center": center})
        print(f"GPlates {t} Ma", flush=True)
    for kind, lo, hi in (("precambrian", 1000, 4031), ("hadean", 4031, 4567)):
        placeholder(kind, out)
        index.append({"from": lo, "to": hi, "src": kind, "tex": f"{kind}.webp", "bump": f"{kind}_h.webp"})
    index.sort(key=lambda e: e.get("ma", e.get("from")))
    with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, indent=0)
    total = sum(os.path.getsize(os.path.join(out, x)) for x in os.listdir(out))
    print(f"{len(index)} globes, {total / 1e6:.1f} MB", flush=True)


if __name__ == "__main__":
    main()
