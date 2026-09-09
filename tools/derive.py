# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml"]
# ///
"""Fill trek.json with what can be derived, so fewer things are typed by hand.

- places: map links for every night, pass, escape and note waypoint name (plus aliases you add later)
- sectionMaps: one overview plus one map per 2 or 3 days, from the GPX extents
- defaults: timezone, elevationDataset, weatherModel(+label), treeline, heatLimit, plannedStart from
  the route's location and the trek month, when they are unset
Existing values are kept; pass --force to recompute the derived ones.
"""
import datetime as dt
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import walking_line  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
tp = ROOT / "trek.json"
T = json.loads(tp.read_text())
force = "--force" in sys.argv
NS = {"g": "http://www.topografix.com/GPX/1/1"}
gp = ROOT / T["gpx"]
changed = []

# ---- location-based defaults
lat0, lon0 = (T["route"].get("start") or [None, None])[:2]
if lat0 is None and gp.exists():
    p = ET.parse(gp).getroot().find(".//g:trkpt", NS)
    lat0, lon0 = float(p.get("lat")), float(p.get("lon"))
if lat0 is not None:
    in_eu = 34 <= lat0 <= 72 and -25 <= lon0 <= 45 and not (29 <= lat0 <= 34 and 34 <= lon0 <= 36)
    in_il = 29 <= lat0 <= 33.5 and 34 <= lon0 <= 36
    in_fr = 41 <= lat0 <= 51.5 and -5.5 <= lon0 <= 9.7
    defaults = {
        "elevationDataset": "eudem25m" if in_eu else "srtm30m",
        "timezone": "Asia/Jerusalem" if in_il else ("Europe/Paris" if in_fr else "auto"),
        "weatherModel": "meteofrance_seamless" if in_fr else None,
        "weatherModelLabel": "Météo-France AROME/ARPEGE, blend beyond 4 days" if in_fr else None,
        "treeline": (2100 if in_fr else None) if in_eu else None,
        "heatLimit": 30 if in_il else 32,
    }
    for k, v in defaults.items():
        if v is not None and (force or k not in T or T[k] in (None, "auto")):
            T[k] = v
            changed.append(k)

WPS = T.get("waypoints") or ([{"name": w.findtext("g:name", namespaces=NS), "lat": float(w.get("lat")), "lon": float(w.get("lon")), "type": w.findtext("g:type", default="Info", namespaces=NS)} for w in ET.parse(gp).getroot().findall("g:wpt", NS)] if gp.exists() else [])

# ---- month-based start hour
dates = [w["name"] for w in WPS if w["name"].startswith("NIGHT 1 ")]
if ("plannedStart" not in T or force) and dates:
    month = None
    for mname in ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"):
        if f" {mname}" in dates[0]:
            month = mname
    hot = month in ("Jun", "Jul", "Aug", "Sep") and (lat0 or 45) < 40
    T["plannedStart"] = 6 if hot else 8
    changed.append("plannedStart")

# ---- places from waypoints
if force or not T.get("places"):
    places = {}
    for w in WPS:
        n = w["name"]
        if n.startswith("NIGHT ") and "option" not in n:
            place = n.split(" · ")[-1].split(":")[0].split(",")[0].strip()
            key = n.split(" · ")[0]
            if place:
                places[place] = key
        elif n.startswith("FINISH · "):
            places[n.split(" · ")[-1].split(",")[0].strip()] = "FINISH"
        elif n.startswith("PASS · "):
            pname = n.split(" · ")[1].split(" - ")[0]
            pname_clean = " ".join(x for x in pname.split() if not x.endswith("m") or not x[:-1].isdigit()).strip()
            places[pname_clean] = n.split(" - ")[0]
        elif n.startswith("ESCAPE · "):
            places[n.split(" · ")[1].split(",")[0].strip()] = n.split(",")[0]
    T["places"] = {k: v for k, v in places.items() if len(k) > 3}
    changed.append(f"places ({len(T['places'])})")

# ---- section maps from the GPX
if gp.exists() and (force or not T.get("sectionMaps")):
    g = ET.parse(gp).getroot()
    pts = [(p[0], p[1]) for p in walking_line(g)]
    nights = sorted(((int(w.findtext("g:name", namespaces=NS).split(" ")[1]), float(w.get("lat")), float(w.get("lon"))) for w in g.findall("g:wpt", NS) if w.findtext("g:name", namespaces=NS).startswith("NIGHT ") and "option" not in w.findtext("g:name", namespaces=NS)))
    def bbox(ps, pad):
        la = [p[0] for p in ps]; lo = [p[1] for p in ps]
        return [round(min(la) - pad, 3), round(max(la) + pad, 3), round(min(lo) - pad * 1.3, 3), round(max(lo) + pad * 1.3, 3)]
    maps = [{"key": "overview", "bbox": bbox(pts, .02), "zoom": 11, "title": T["name"] + " overview"}]
    # split the route at nights into groups of 2-3 days
    idx = [min(range(len(pts)), key=lambda i: (pts[i][0] - la) ** 2 + (pts[i][1] - lo) ** 2) for _, la, lo in nights] + [len(pts) - 1]
    idx = [0] + sorted(set(idx))
    ndays = len(idx) - 1
    per = 3 if ndays >= 6 else 2 if ndays >= 3 else ndays
    d = 1
    while d <= ndays:
        e = min(d + per - 1, ndays)
        seg = pts[idx[d - 1]:idx[e] + 1]
        maps.append({"key": f"days{d}-{e}" if e > d else f"day{d}", "bbox": bbox(seg, .012), "zoom": 13, "title": f"Days {d}–{e}" if e > d else f"Day {d}"})
        d = e + 1
    T["sectionMaps"] = maps
    changed.append(f"sectionMaps ({len(maps)})")

tp.write_text(json.dumps(T, ensure_ascii=False, indent=2) + "\n")
print("derived: " + (", ".join(changed) if changed else "nothing (all set; use --force to recompute)"), file=sys.stderr)
