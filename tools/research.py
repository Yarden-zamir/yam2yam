# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Deep OpenStreetMap research along the route, the things a web search misses. Writes research/osm.md
and research/osm.json, and proposes waypoints (research/waypoints.proposed.json) to merge into trek.json.

Per day and for the whole line:
- difficulty: sac_scale, trail_visibility, via_ferrata_scale and highway=path|scramble on the route's own
  ways, so "T3" sections get named before the guidebook says so
- hazards: ford=yes, hazard=*, natural=cliff crossings, tunnels, bridges tagged unsafe, seasonal closures
- protected areas crossed (national parks, reserves, military zones) with their tags: camping rules live there
- huts, campsites, shelters, alpine huts with opening_hours, phone, website, fee, reservation, capacity
- water: springs, taps, fountains, wells, troughs with drinking_water and seasonal tags
- bail-outs: bus stops, stations, roads and parking within 400 m, with route refs
- peaks and cols near the line (side trips), via ferrata routes within 3 km
- shops, fuel, restaurants, ATMs within 500 m (resupply)
Run after tools/build_gpx.py (needs the GPX).
"""
import json
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import NS, hav, overpass, walking_line  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
T = json.loads((ROOT / "trek.json").read_text())
ns = {"g": NS}
gp = ROOT / T["gpx"]
if not gp.exists():
    sys.exit("build the GPX first (tools/build_gpx.py)")
out_dir = ROOT / "research"
out_dir.mkdir(exist_ok=True)
g = ET.parse(gp).getroot()
line = [(p[0], p[1], p[3]) for p in walking_line(g)]  # (lat, lon, metres along the walking line)
nights = sorted((int(w.findtext("g:name", namespaces=ns).split(" ")[1]), float(w.get("lat")), float(w.get("lon")), w.findtext("g:name", namespaces=ns))
                for w in g.findall("g:wpt", ns) if w.findtext("g:name", namespaces=ns).startswith("NIGHT ") and "option" not in w.findtext("g:name", namespaces=ns))
finish = [w for w in g.findall("g:wpt", ns) if w.findtext("g:name", namespaces=ns).startswith("FINISH")]


def along(lat, lon):
    best = min(line[::2], key=lambda q: hav((lat, lon), q[:2]))
    return best[2], hav((lat, lon), best[:2])


NIGHT_KM = sorted((n, along(la, lo)[0]) for n, la, lo, _ in nights)  # (night number, distance along)


def day_of(dist):
    """Day n runs from NIGHT n-1 to NIGHT n; before NIGHT 0 is day 0, after the last night is the finish day."""
    for n, km in NIGHT_KM:
        if dist <= km + 50:
            return n
    return (NIGHT_KM[-1][0] + 1) if NIGHT_KM else 1


lats = [p[0] for p in line]
lons = [p[1] for p in line]
bbox = f"{min(lats) - .03},{min(lons) - .04},{max(lats) + .03},{max(lons) + .04}"
report, found, proposed = [], {}, []

# ---- 1. the route's own ways: difficulty and hazards (relation members or ways under the line)
rel_ids = [x["id"] if isinstance(x, dict) else x for x in T["route"].get("osm_relations", [])]
if rel_ids:
    q = "[out:json][timeout:240];(" + "".join(f"relation({i});" for i in rel_ids) + ");(._;>>;);out tags geom;"
else:
    q = f'[out:json][timeout:240];way["highway"]["sac_scale"]({bbox});out tags geom;'
data = overpass(q)
ways = [e for e in data["elements"] if e["type"] == "way" and "geometry" in e]
diff = defaultdict(list)
for w in ways:
    t = w.get("tags", {})
    keys = {k: t[k] for k in ("sac_scale", "trail_visibility", "via_ferrata_scale", "ford", "hazard", "surface", "highway", "seasonal", "access", "opening_hours", "name") if k in t}
    if not any(k in keys for k in ("sac_scale", "trail_visibility", "via_ferrata_scale", "ford", "hazard", "seasonal", "access")) and keys.get("highway") not in ("scramble", "via_ferrata"):
        continue
    mid = w["geometry"][len(w["geometry"]) // 2]
    dist, off = along(mid["lat"], mid["lon"])
    if off > 150 and rel_ids:
        continue
    keys["km"] = round(dist / 1000, 1)
    keys["day"] = day_of(dist)
    keys["lat"], keys["lon"] = round(mid["lat"], 5), round(mid["lon"], 5)
    diff[keys["day"]].append(keys)
report.append("# OpenStreetMap research along the route\n")
report.append("## Difficulty and hazards on the route's own ways\n")
for day in sorted(diff):
    report.append(f"### Day {day}")
    for k in sorted(diff[day], key=lambda x: x["km"]):
        tags = ", ".join(f"{a}={b}" for a, b in k.items() if a not in ("km", "day", "lat", "lon"))
        report.append(f"- km {k['km']}: {tags}")
        if k.get("sac_scale") in ("demanding_mountain_hiking", "alpine_hiking", "demanding_alpine_hiking", "difficult_alpine_hiking") or k.get("ford") == "yes" or k.get("hazard") or k.get("highway") in ("scramble", "via_ferrata"):
            label = k.get("name") or k.get("highway", "path")
            note = "ROUTE NOTE · " + (f"{label}: " if k.get("name") else "") + tags
            proposed.append({"name": note[:140], "lat": k["lat"], "lon": k["lon"], "type": "Info", "_day": day, "_km": k["km"]})
found["difficulty"] = {str(k): v for k, v in diff.items()}

# ---- 2. everything else near the line, in one query
q = f"""[out:json][timeout:240];(
  relation["boundary"~"protected_area|national_park"]({bbox}); relation["landuse"="military"]({bbox}); way["landuse"="military"]({bbox});
  nwr["tourism"~"alpine_hut|wilderness_hut|camp_site|guest_house|hostel|hotel"]({bbox}); nwr["amenity"="shelter"]({bbox});
  node["natural"="spring"]({bbox}); node["amenity"~"drinking_water|fountain|watering_place"]({bbox}); node["man_made"~"water_tap|water_well"]({bbox});
  node["highway"="bus_stop"]({bbox}); node["railway"~"station|halt"]({bbox}); node["amenity"="parking"]({bbox}); way["amenity"="parking"]({bbox});
  node["natural"~"peak|saddle"]({bbox}); nwr["highway"="via_ferrata"]({bbox}); way["ford"="yes"]({bbox}); node["ford"="yes"]({bbox});
  nwr["shop"~"supermarket|convenience|bakery|general"]({bbox}); nwr["amenity"~"fuel|restaurant|cafe|atm|pharmacy"]({bbox}); nwr["emergency"~"phone|rescue"]({bbox});
);out tags center;"""
data = overpass(q)
groups = defaultdict(list)
for e in data["elements"]:
    t = e.get("tags", {})
    if e["type"] == "relation" and t.get("boundary"):
        groups["protected areas (rules live here)"].append({"name": t.get("name"), "protect_class": t.get("protect_class"), "boundary": t.get("boundary"), "website": t.get("website"), "id": e["id"]})
        continue
    la, lo = (e.get("lat"), e.get("lon")) if "lat" in e else (e.get("center", {}).get("lat"), e.get("center", {}).get("lon"))
    if la is None:
        continue
    dist, off = along(la, lo)
    item = {"name": t.get("name") or t.get("name:en"), "km": round(dist / 1000, 1), "day": day_of(dist), "off_m": round(off), "lat": round(la, 5), "lon": round(lo, 5)}
    lim, grp = 400, None
    if t.get("tourism") in ("alpine_hut", "wilderness_hut", "camp_site", "guest_house", "hostel", "hotel"):
        grp, lim = "sleeping", 800
        item.update({k: t[k] for k in ("tourism", "opening_hours", "phone", "contact:phone", "website", "contact:website", "fee", "reservation", "capacity", "email", "operator") if k in t})
    elif t.get("amenity") == "shelter":
        grp, lim = "shelters", 600
        item.update({k: t[k] for k in ("shelter_type", "bivouac") if k in t})
    elif t.get("natural") == "spring" or t.get("amenity") in ("drinking_water", "fountain", "watering_place") or t.get("man_made") in ("water_tap", "water_well"):
        grp, lim = "water", 300
        item.update({k: t[k] for k in ("drinking_water", "seasonal", "intermittent", "description") if k in t})
    elif t.get("highway") == "bus_stop":
        grp, lim = "bus stops (bail-outs)", 500
        item.update({k: t[k] for k in ("route_ref", "operator", "network") if k in t})
    elif t.get("railway") in ("station", "halt"):
        grp, lim = "stations", 2500
    elif t.get("amenity") == "parking":
        grp, lim = "parking (road access)", 300
    elif t.get("natural") in ("peak", "saddle"):
        grp, lim = "peaks and saddles (side trips)", 1500
        if not t.get("ele"):
            continue
        item.update({k: t[k] for k in ("ele", "natural") if k in t})
    elif t.get("highway") == "via_ferrata" or t.get("route") == "via_ferrata":
        grp, lim = "via ferrata", 3000
        item.update({k: t[k] for k in ("via_ferrata_scale", "website") if k in t})
    elif t.get("ford") == "yes":
        grp, lim = "fords", 150
    elif t.get("shop") or t.get("amenity") in ("fuel", "restaurant", "cafe", "atm", "pharmacy"):
        grp, lim = "resupply", 500
        item.update({k: t[k] for k in ("shop", "amenity", "opening_hours") if k in t})
    elif t.get("emergency"):
        grp, lim = "emergency", 1000
        item.update({k: t[k] for k in ("emergency", "phone") if k in t})
    if grp and off <= lim:
        groups[grp].append(item)
    if grp == "military" or t.get("landuse") == "military":
        groups["military zones"].append(item)
for grp, items in groups.items():
    items.sort(key=lambda x: (x.get("km", 0), x.get("off_m", 0)))
    report.append(f"\n## {grp} ({len(items)})")
    for it in items:
        rest = ", ".join(f"{k}={v}" for k, v in it.items() if k not in ("name", "km", "day", "off_m", "lat", "lon", "id") and v)
        report.append(f"- day {it.get('day', '?')} km {it.get('km', '?')} ({it.get('off_m', '?')} m off): {it.get('name') or '(unnamed)'}" + (f" · {rest}" if rest else ""))
    found[grp] = items
# proposals: stations and bus stops as escapes, fords as notes, huts as lodging
for it in groups.get("stations", []):
    proposed.append({"name": f"ESCAPE · {it.get('name') or 'station'}, railway station · {it['off_m']} m off the line", "lat": it["lat"], "lon": it["lon"], "type": "Escape", "_day": it["day"], "_km": it["km"]})
_fords = sorted(groups.get("fords", []), key=lambda x: x["km"])
_run = []
for it in _fords + [None]:
    if it and (not _run or it["km"] - _run[-1]["km"] <= 1.0):
        _run.append(it)
        continue
    if _run:
        f0 = _run[0]
        label = f"FORD · km {f0['km']} · dangerous in heavy rain" if len(_run) == 1 else f"FORDS · km {f0['km']}–{_run[-1]['km']} · {len(_run)} stream crossings, impassable in flood"
        proposed.append({"name": label, "lat": f0["lat"], "lon": f0["lon"], "type": "Info", "_day": f0["day"], "_km": f0["km"]})
    _run = [it] if it else []
for it in groups.get("sleeping", []):
    if it.get("tourism") in ("alpine_hut", "camp_site") and it["off_m"] <= 400:
        proposed.append({"name": f"{'HUT' if it['tourism'] == 'alpine_hut' else 'CAMPSITE'} · {it.get('name') or 'unnamed'}" + (f" · {it['opening_hours']}" if it.get("opening_hours") else "") + (f" · {it.get('phone') or it.get('contact:phone')}" if it.get("phone") or it.get("contact:phone") else ""), "lat": it["lat"], "lon": it["lon"], "type": "Lodging" if it["tourism"] == "alpine_hut" else "Campsite", "_day": it["day"], "_km": it["km"]})
proposed.sort(key=lambda x: (x["_day"], x["_km"]))
(out_dir / "osm.md").write_text("\n".join(report) + "\n")
(out_dir / "osm.json").write_text(json.dumps(found, ensure_ascii=False, indent=1))
(out_dir / "waypoints.proposed.json").write_text(json.dumps(proposed, ensure_ascii=False, indent=1))
print(f"wrote research/osm.md ({sum(len(v) for v in groups.values())} items in {len(groups)} groups), research/osm.json, research/waypoints.proposed.json ({len(proposed)} proposals)", file=sys.stderr)
