# /// script
# requires-python = ">=3.11"
# dependencies = ["requests", "pillow"]
# ///
"""Render annotated section maps as WebP from OpenTopoMap tiles, with the route and the nights.

trek.json "sectionMaps": [{"key": "overview", "bbox": [lat0, lat1, lon0, lon1], "zoom": 11, "title": "..."}].
Writes site/maps/<key>.webp and site/maps/index.json (sizes for the build). Tiles are cached in
.tiles/. Keep the total tile count modest: OpenTopoMap is a volunteer service.
"""
import base64
import io
import json
import math
import os
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import NS, UA  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TREK = json.loads((ROOT / "trek.json").read_text())
ns = {"g": NS}
OUT = ROOT / "site" / "maps"
OUT.mkdir(parents=True, exist_ok=True)
CACHE = ROOT / ".tiles"
CACHE.mkdir(exist_ok=True)
S = requests.Session()
S.headers.update(UA)

gpx = ET.parse(ROOT / TREK["gpx"]).getroot()
lines = []
for trk in gpx.findall("g:trk", ns):
    if not trk.findtext("g:name", namespaces=ns).startswith("ROUTE"):
        continue
    for seg in trk.findall("g:trkseg", ns):
        lines.append([(float(p.get("lat")), float(p.get("lon"))) for p in seg.findall("g:trkpt", ns)])
nights = [(w.findtext("g:name", namespaces=ns), float(w.get("lat")), float(w.get("lon"))) for w in gpx.findall("g:wpt", ns)
          if w.findtext("g:type", namespaces=ns) in ("Night", "Flag") and "FALLBACK" not in w.findtext("g:name", namespaces=ns) and "option" not in w.findtext("g:name", namespaces=ns)]
places = [(w.findtext("g:name", namespaces=ns), float(w.get("lat")), float(w.get("lon"))) for w in gpx.findall("g:wpt", ns)
          if w.findtext("g:type", namespaces=ns) in ("Summit", "Lodging") and not w.findtext("g:name", namespaces=ns).startswith("HUT")]


def deg2num(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def tile(z, x, y):
    fn = CACHE / f"{z}_{x}_{y}.png"
    if not fn.exists():
        for sub in "abc":
            r = S.get(f"https://{sub}.tile.opentopomap.org/{z}/{x}/{y}.png", timeout=30)
            if r.ok:
                fn.write_bytes(r.content)
                break
            time.sleep(1)
        else:
            raise SystemExit(f"tile {z}/{x}/{y} failed")
        time.sleep(0.15)
    return Image.open(fn).convert("RGB")


def font(sz):
    for p in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def short(name):
    return name.split(" · ")[0].replace("NIGHT ", "N") if name.startswith(("NIGHT", "FINISH")) else name.split(" · ")[-1].split(" - ")[0][:28]


sizes = {}
for sm in TREK["sectionMaps"]:
    lat0, lat1, lon0, lon1 = sm["bbox"]
    z = sm["zoom"]
    x0, y1 = deg2num(lat0, lon0, z)
    x1, y0 = deg2num(lat1, lon1, z)
    tx0, tx1, ty0, ty1 = int(x0), int(x1), int(y0), int(y1)
    W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    im = Image.new("RGB", (W, H))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            im.paste(tile(z, tx, ty), ((tx - tx0) * 256, (ty - ty0) * 256))

    def px(lat, lon):
        x, y = deg2num(lat, lon, z)
        return ((x - tx0) * 256, (y - ty0) * 256)

    d = ImageDraw.Draw(im)
    for ln in lines:
        pts = [px(a, b) for a, b in ln]
        if len(pts) > 1:
            d.line(pts, fill=(255, 255, 255), width=7)
            d.line(pts, fill=(200, 50, 43), width=4)
    f, fs = font(20 if z >= 13 else 15), font(15 if z >= 13 else 12)
    for nm, la, lo in places:
        x, y = px(la, lo)
        if 0 <= x < W and 0 <= y < H:
            d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(44, 106, 138), outline="white", width=2)
            d.text((x + 9, y - 9), short(nm), font=fs, fill=(30, 39, 38), stroke_width=3, stroke_fill="white")
    for nm, la, lo in nights:
        x, y = px(la, lo)
        if 0 <= x < W and 0 <= y < H:
            d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=(200, 50, 43), outline="white", width=3)
            d.text((x + 13, y - 12), short(nm), font=f, fill=(140, 20, 15), stroke_width=3, stroke_fill="white")
    cx0, cy1 = px(lat0, lon0)
    cx1, cy0 = px(lat1, lon1)
    im = im.crop((int(cx0), int(cy0), int(cx1), int(cy1)))
    d = ImageDraw.Draw(im)
    d.rectangle([0, im.height - 24, im.width, im.height], fill=(255, 255, 255))
    d.text((6, im.height - 20), f"{sm['title']}  ·  map data © OpenStreetMap contributors, SRTM  ·  style © OpenTopoMap (CC-BY-SA)", font=font(13), fill=(60, 60, 60))
    im.save(OUT / f"{sm['key']}.webp", "WEBP", quality=72, method=6)
    sizes[sm["key"]] = {"w": im.width, "h": im.height}
    print(f"{sm['key']}: {im.size}, {os.path.getsize(OUT / (sm['key'] + '.webp')) // 1024} KB", file=sys.stderr)
(OUT / "index.json").write_text(json.dumps(sizes, indent=1))
