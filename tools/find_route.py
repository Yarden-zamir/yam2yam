# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Find the OpenStreetMap hiking relations for a trail and write the chosen chain into trek.json.

  uv run tools/find_route.py --bbox 32.7,34.9,33.2,35.7 [--name "sea to sea|ים אל ים"] [--pick 2860967,123]
  uv run tools/find_route.py --near "Saint-Dalmas-Valdeblore" --near "Menton" --name "GR 52|GR52"

Lists every route=hiking relation touching the box with names in all languages, ref, member count,
superroute parents and children, geometry length and endpoints, and flags gaps when chained. Nominatim
rarely finds trails and the OSM name is often not the common one, so search by box and read the list.
--pick writes route.osm_relations and route.start (the first relation's start) into trek.json.
"""
import argparse
import json
import re
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import UA, hav, overpass  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--bbox", help="lat0,lon0,lat1,lon1")
ap.add_argument("--near", action="append", help="place names to geocode; the box is drawn around them (repeatable)")
ap.add_argument("--name", help="regex on name, name:en, name:he, ref (case-insensitive)")
ap.add_argument("--pick", help="comma-separated relation ids in walking order to write into trek.json")
a = ap.parse_args()

if a.near:
    pts = []
    for q in a.near:
        r = requests.get("https://nominatim.openstreetmap.org/search", params={"q": q, "format": "json", "limit": 1}, headers=UA, timeout=30).json()
        if not r:
            sys.exit(f"nominatim: '{q}' not found")
        pts.append((float(r[0]["lat"]), float(r[0]["lon"])))
        print(f"{q}: {r[0]['display_name'][:70]} ({r[0]['lat']}, {r[0]['lon']})", file=sys.stderr)
    lat0, lat1 = min(p[0] for p in pts) - .15, max(p[0] for p in pts) + .15
    lon0, lon1 = min(p[1] for p in pts) - .2, max(p[1] for p in pts) + .2
elif a.bbox:
    lat0, lon0, lat1, lon1 = map(float, a.bbox.split(","))
else:
    sys.exit("give --bbox or --near")

d = overpass(f'[out:json][timeout:180];relation["route"="hiking"]({lat0},{lon0},{lat1},{lon1});out tags;')
rels = d["elements"]
pat = re.compile(a.name, re.I) if a.name else None
rows = []
for e in rels:
    t = e["tags"]
    names = " | ".join(v for k, v in t.items() if k == "name" or k.startswith("name:"))
    if pat and not pat.search(names + " " + t.get("ref", "")):
        continue
    rows.append((e["id"], t.get("ref", ""), names, t.get("type", ""), t.get("network", ""), t.get("colour", "")))
if not rows:
    sys.exit("no matching hiking relations; widen the box or drop --name")
print(f"\n{len(rows)} relations:")
for rid, ref, names, typ, net, col in sorted(rows, key=lambda x: x[2]):
    print(f"  {rid:>10}  {ref:8} {typ:10} {net:5} {col:8} {names[:110]}")

# geometry summary for the candidates (superroutes expanded)
ids = [r[0] for r in rows][:25]
q = "[out:json][timeout:240];(" + "".join(f"relation({i});" for i in ids) + ");(._;>>;);out geom;"
g = overpass(q)
ways = {e["id"]: [(p["lat"], p["lon"]) for p in e["geometry"]] for e in g["elements"] if e["type"] == "way" and "geometry" in e}
relmap = {e["id"]: e for e in g["elements"] if e["type"] == "relation"}
print("\nGeometry (chained greedily from the first way; gap = largest jump between consecutive ways):")
for rid in ids:
    e = relmap.get(rid)
    if not e:
        continue
    members = [m for m in e["members"] if m["type"] == "way" and m["ref"] in ways]
    subs = [m["ref"] for m in e["members"] if m["type"] == "relation"]
    if not members and subs:
        print(f"  {rid:>10}  superroute of {len(subs)} relations: {subs}")
        continue
    pts, gap, length = [], 0.0, 0.0
    cur = None
    left = [ways[m["ref"]] for m in members]
    # start from the way end that is farthest from the centroid: an extremity of the trail, whatever the member order
    allp = [p for w in left for p in w]
    cx, cy = sum(p[0] for p in allp) / len(allp), sum(p[1] for p in allp) / len(allp)
    ends = [(hav((cx, cy), w[0]), i, False) for i, w in enumerate(left)] + [(hav((cx, cy), w[-1]), i, True) for i, w in enumerate(left)]
    _, i0, rev0 = max(ends)
    left.insert(0, left.pop(i0))
    if rev0:
        left[0] = list(reversed(left[0]))
    while left:
        if cur is None:
            w = left.pop(0)
        else:
            dist, rev, w = min([(hav(cur, x[0]), False, x) for x in left] + [(hav(cur, x[-1]), True, x) for x in left], key=lambda t: t[0])
            left.remove(w)
            gap = max(gap, dist)
            w = list(reversed(w)) if rev else w
        for p, q2 in zip(w, w[1:]):
            length += hav(p, q2)
        pts += w
        cur = w[-1]
    print(f"  {rid:>10}  {length / 1000:6.1f} km  {len(members):4} ways  start ({pts[0][0]:.4f}, {pts[0][1]:.4f})  end ({pts[-1][0]:.4f}, {pts[-1][1]:.4f})  max gap {gap:.0f} m" + ("  <-- gaps: check order or missing ways" if gap > 1000 else ""))

if a.pick:
    picked = [int(x) for x in a.pick.split(",")]
    tp = ROOT / "trek.json"
    T = json.loads(tp.read_text())
    first = relmap.get(picked[0])
    startpt = None
    if first:
        m0 = [m for m in first["members"] if m["type"] == "way" and m["ref"] in ways]
        if m0:
            startpt = list(ways[m0[0]["ref"]][0])
    T["route"] = {"osm_relations": [{"id": i, "label": (relmap.get(i, {}).get("tags", {}).get("name:en") or relmap.get(i, {}).get("tags", {}).get("name") or str(i))} for i in picked], "start": T.get("route", {}).get("start") or startpt}
    tp.write_text(json.dumps(T, ensure_ascii=False, indent=2) + "\n")
    print(f"\nwrote route into trek.json: {picked}; check route.start is the trailhead ({T['route']['start']}), reverse it if the chain should run the other way", file=sys.stderr)
