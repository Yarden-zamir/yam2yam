# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml"]
# ///
"""Check trek.json, content.yaml and the GPX for the mistakes that break the site, with fixes spelled out.

Exit 1 on errors; warnings do not fail. Run before build and again before deploy.
"""
import datetime as dt
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
NS = {"g": "http://www.topografix.com/GPX/1/1"}
errors, warns = [], []
E, W = errors.append, warns.append

# ---- trek.json
tp = ROOT / "trek.json"
if not tp.exists():
    sys.exit("no trek.json: run tools/new.py or copy trek.example.json")
T = json.loads(tp.read_text())
for k in ("slug", "name", "description", "hostname", "gpx", "timezone", "languages", "route"):
    if not T.get(k):
        E(f"trek.json: '{k}' is missing")
if not re.fullmatch(r"[a-z0-9-]+", T.get("slug", "")):
    E("trek.json: slug must be lowercase letters, digits, dashes")
if T.get("accent") and not re.fullmatch(r"#[0-9A-Fa-f]{6}", T["accent"]):
    E(f"trek.json: accent '{T['accent']}' is not #RRGGBB")
r = T.get("route", {})
if not (r.get("osm_relations") or r.get("gpx_in")):
    E("trek.json: route needs osm_relations (ids in walking order) or gpx_in")
if r.get("osm_relations") and not r.get("start"):
    E("trek.json: route.start [lat, lon] is needed to orient the OpenStreetMap chain")
for z in T.get("exposed", []):
    if not all(k in z for k in ("fromKm", "toKm", "name")):
        E(f"trek.json: exposed entry {z} needs fromKm, toKm, name")

# ---- waypoints
wps = T.get("waypoints", [])
if not wps and (ROOT / T.get("gpx", "site/route.gpx")).exists():
    _g = ET.parse(ROOT / T["gpx"]).getroot()
    wps = [{"name": w.findtext("g:name", namespaces=NS), "lat": float(w.get("lat")), "lon": float(w.get("lon")), "type": w.findtext("g:type", default="Info", namespaces=NS)} for w in _g.findall("g:wpt", NS)]
    W("trek.json has no waypoints; using the ones in the GPX")
nights = {}
for w in wps:
    for k in ("name", "lat", "lon", "type"):
        if k not in w:
            E(f"waypoint {w.get('name', w)}: missing '{k}'")
    m = re.match(r"^NIGHT (\d+)( option B)? · ", w.get("name", ""))
    if m and not m.group(2):
        nights[int(m.group(1))] = w
    if w.get("type") == "Night" and not m and not w.get("name", "").startswith("FALLBACK"):
        W(f"waypoint '{w['name']}': type Night but the name does not start with 'NIGHT n · '")
finish = [w for w in wps if w.get("name", "").startswith("FINISH · ")]
if not nights.get(0):
    E("waypoints: no 'NIGHT 0 · …' (the night before day 1)")
if not finish:
    E("waypoints: no 'FINISH · …'")
last = max(nights) if nights else 0
for n in range(0, last + 1):
    if n not in nights:
        E(f"waypoints: NIGHT {n} is missing (nights must be consecutive)")
if last and not any(w.get("type") == "Summit" and w["name"].startswith("PASS · ") for w in wps):
    W("waypoints: no 'PASS · …' points; day high points will have no names")

# ---- content.yaml
cp = ROOT / "content.yaml"
if cp.exists():
    C = yaml.safe_load(cp.read_text()) or {}
    for lang in T.get("languages", []):
        c = C.get(lang)
        if not c:
            E(f"content.yaml: no '{lang}' block")
            continue
        for k in ("eyebrow", "title", "lede", "days"):
            if not c.get(k):
                E(f"content.yaml[{lang}]: '{k}' is missing")
        days = c.get("days") or []
        ns = [int(d["n"]) for d in days]
        if ns != list(range(0, last + 2)) and last:
            E(f"content.yaml[{lang}]: days are {ns}, waypoints imply days 0..{last + 1} (NIGHT 0..{last} plus the finish day)")
        for d in days:
            n = int(d["n"])
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(d.get("date", ""))):
                E(f"content.yaml[{lang}] day {n}: date must be YYYY-MM-DD")
            else:
                wp = nights.get(n) if n <= last else (finish[0] if finish else None)
                if wp:
                    dd = dt.date.fromisoformat(str(d["date"]))
                    day_token = dd.strftime("%-d %b")
                    if day_token not in wp["name"] and dd.strftime("%d %b") not in wp["name"]:
                        W(f"content.yaml[{lang}] day {n}: date {d['date']} but waypoint '{wp['name'][:40]}' does not mention '{day_token}'")
            if n >= 1 and not d.get("hours"):
                E(f"content.yaml[{lang}] day {n}: 'hours' (planned walking hours, a number) is required; it drives the arrival estimate")
            if not d.get("title") or not d.get("label"):
                E(f"content.yaml[{lang}] day {n}: title and label are required")
        if len(c.get("facts", [])) > 6:
            W(f"content.yaml[{lang}]: more than 6 facts; only 6 are shown")
        for key in ("refuges", "tech"):
            t = c.get(key)
            if t:
                for i, row in enumerate(t.get("rows", [])):
                    if len(row) != len(t["columns"]):
                        E(f"content.yaml[{lang}] {key} row {i + 1}: {len(row)} cells for {len(t['columns'])} columns")
        keys = [s["key"] for s in c.get("section_maps", [])]
        for k in keys:
            if k not in [s["key"] for s in T.get("sectionMaps", [])]:
                E(f"content.yaml[{lang}]: section map '{k}' is not in trek.json sectionMaps")
    if T.get("languages", [""])[0] not in C:
        E("content.yaml: the first language in trek.json has no block")
    dates = [str(d["date"]) for d in (C.get(T["languages"][0], {}).get("days") or []) if d.get("date")]
    if dates:
        first = dt.date.fromisoformat(min(dates))
        lead = (first - dt.date.today()).days
        if lead > 16:
            W(f"trek starts in {lead} days: beyond Open-Meteo's 16-day horizon, weather cards will say 'not yet available' until then")
        elif lead < -1:
            W("trek dates are in the past")
elif (ROOT / "src" / "body.html").exists():
    W("no content.yaml: building from a hand-written src/body.html (run tools/import_body.py to convert)")
else:
    E("no content.yaml and no src/body.html")

# ---- places
places = T.get("places", {})
if cp.exists() and places:
    blob = cp.read_text()
    for term in places:
        if term not in blob:
            W(f"places: '{term}' never appears in content.yaml")
elif not places:
    W("trek.json: no 'places'; place names will not link to the map (tools/derive.py can propose them)")

# ---- section maps
sm = T.get("sectionMaps", [])
if not sm:
    W("trek.json: no sectionMaps (tools/derive.py can propose them from the day extents)")
for s in sm:
    if not all(k in s for k in ("key", "bbox", "zoom", "title")):
        E(f"sectionMaps entry {s} needs key, bbox [lat0, lat1, lon0, lon1], zoom, title")
    elif not (s["bbox"][0] < s["bbox"][1] and s["bbox"][2] < s["bbox"][3]):
        E(f"sectionMaps '{s['key']}': bbox must be [lat0 < lat1, lon0 < lon1]")
    elif not (ROOT / "site" / "maps" / f"{s['key']}.webp").exists():
        W(f"sectionMaps '{s['key']}': not rendered yet (tools/maps.py)")

# ---- gpx
gp = ROOT / T.get("gpx", "site/route.gpx")
if gp.exists():
    g = ET.parse(gp).getroot()
    trks = g.findall("g:trk", NS)
    routes = [t for t in trks if (t.findtext("g:name", default="", namespaces=NS)).startswith("ROUTE")]
    if not routes:
        E("gpx: no 'ROUTE i of N' tracks (tools/build_gpx.py)")
    pts = [p for t in routes for p in t.iter("{http://www.topografix.com/GPX/1/1}trkpt")]
    noele = [p for p in pts if p.find("g:ele", NS) is None]
    if pts and len(noele) > len(pts) * 0.05:
        E(f"gpx: {len(noele)} of {len(pts)} route points have no elevation (tools/elevation.py)")
    wp_names = [w.findtext("g:name", namespaces=NS) for w in g.findall("g:wpt", NS)]
    if not any(n.startswith("NIGHT 0 ") for n in wp_names):
        E("gpx: NIGHT 0 waypoint missing; rebuild with tools/build_gpx.py after editing trek.json")
else:
    W(f"gpx not built yet: {gp.relative_to(ROOT)} (tools/build_gpx.py)")

for w in warns:
    print("WARN  " + w)
for e in errors:
    print("ERROR " + e)
print(f"\n{len(errors)} errors, {len(warns)} warnings")
sys.exit(1 if errors else 0)
