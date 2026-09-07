# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Build the trek GPX from trek.json.

Route: OpenStreetMap hiking relations (trek.json "route.osm_relations", in walking order) or a
GPX file ("route.gpx_in"). Each relation becomes one track named "ROUTE i of N · <label>".
Waypoints: trek.json "waypoints" (nights, passes, escapes, notes) plus OpenStreetMap water,
huts, shelters and campsites within 300 m of the line, plus an optional protected-area boundary
track. Colours and icons come from the waypoint type. Run tools/elevation.py afterwards.
"""
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from xml.sax.saxutils import escape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import NS, OSMAND, hav, overpass  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TREK = json.loads((ROOT / "trek.json").read_text())
OUT = ROOT / TREK["gpx"]

STYLE = {  # waypoint type -> (osmand color, icon, background)
    "Night": ("#C8322B", "tourism_camp_site", "circle"), "Flag": ("#C8322B", "special_flag_finish", "circle"),
    "Lodging": ("#8B5A2B", "tourism_alpine_hut", "circle"), "Campsite": ("#A0522D", "tourism_camp_site", "circle"),
    "Water": ("#2C6A8A", "amenity_drinking_water", "circle"), "Summit": ("#6B7775", "natural_peak", "octagon"),
    "SideTrip": ("#D9820B", "natural_peak", "octagon"), "ViaFerrata": ("#8E44AD", "sport_climbing", "square"),
    "Escape": ("#5B8A3C", "highway_bus_stop", "square"), "Transport": ("#5B8A3C", "highway_bus_stop", "square"),
    "Shelter": ("#A0522D", "amenity_shelter", "square"), "Info": ("#B3701C", "special_information", "square"),
}


def fetch_relation(rid: int):
    d = overpass(f"[out:json][timeout:180];relation({rid});out body;way(r);out geom;")
    rel = [e for e in d["elements"] if e["type"] == "relation"][0]
    ways = {e["id"]: [(p["lat"], p["lon"]) for p in e["geometry"]] for e in d["elements"] if e["type"] == "way"}
    order = [m["ref"] for m in rel["members"] if m["type"] == "way" and m["ref"] in ways]
    return rel["tags"].get("name", str(rid)), [ways[i] for i in order]


def chain(ways, start):
    """Greedy chain of ways from `start`: nearest endpoint next, oriented; a gap over 1 km starts a new segment."""
    left, out, cur = list(ways), [], start
    while left:
        d, rev, w = min([(hav(cur, w[0]), False, w) for w in left] + [(hav(cur, w[-1]), True, w) for w in left], key=lambda t: t[0])
        left.remove(w)
        pts = list(reversed(w)) if rev else list(w)
        if d > 1000:
            out.append(None)
        out.append(pts)
        cur = pts[-1]
    return out


def route_tracks():
    r = TREK["route"]
    if "gpx_in" in r:
        t = ET.parse(ROOT / r["gpx_in"]).getroot()
        ns = {"g": NS}
        tracks = []
        for i, trk in enumerate(t.findall("g:trk", ns), 1):
            segs = [[(float(p.get("lat")), float(p.get("lon"))) for p in s.findall("g:trkpt", ns)] for s in trk.findall("g:trkseg", ns)]
            tracks.append((trk.findtext("g:name", default=f"part {i}", namespaces=ns), segs))
        return tracks
    rels = r["osm_relations"]
    start = tuple(r["start"])
    tracks, cur = [], start
    for i, item in enumerate(rels, 1):
        rid, label = (item["id"], item.get("label")) if isinstance(item, dict) else (item, None)
        name, ways = fetch_relation(rid)
        print(f"relation {rid} {name}: {len(ways)} ways", file=sys.stderr)
        parts, segs, seg = chain(ways, cur), [], []
        for p in parts:
            if p is None:
                if seg:
                    segs.append(seg)
                seg = []
                continue
            seg += p
        if seg:
            segs.append(seg)
        cur = segs[-1][-1]
        tracks.append((f"ROUTE {i} of {len(rels)} · {label or name} · ALWAYS ON", segs))
    return tracks


def enrich(all_pts):
    """OpenStreetMap water, huts, shelters and campsites near the line, named by nearest landmark."""
    cfg = TREK.get("enrich", {})
    if not cfg:
        return []
    lats = [p[0] for p in all_pts]
    lons = [p[1] for p in all_pts]
    bbox = f"{min(lats) - .02},{min(lons) - .02},{max(lats) + .02},{max(lons) + .02}"
    q = f"""[out:json][timeout:180];(
      node["natural"="spring"]({bbox}); node["amenity"="drinking_water"]({bbox}); node["man_made"="water_tap"]({bbox});
      node["amenity"="fountain"]["drinking_water"="yes"]({bbox}); node["natural"="water"]["name"]({bbox});
      node["tourism"~"alpine_hut|wilderness_hut|camp_site"]({bbox}); node["amenity"="shelter"]({bbox}););out body;"""
    d = overpass(q)
    landmarks = [((w["name"].split(" · ")[-1] if " · " in w["name"] else w["name"]).split(":")[0].split(" - ")[0][:40], w["lat"], w["lon"])
                 for w in TREK["waypoints"] if w["type"] in ("Night", "Flag", "Lodging", "Summit")]
    sample = all_pts[::3]
    out = []

    def near_lm(la, lo):
        return min(landmarks, key=lambda x: hav((la, lo), (x[1], x[2])))[0] if landmarks else ""

    for e in d["elements"]:
        tg, la, lo = e.get("tags", {}), e["lat"], e["lon"]
        dist = min(hav((la, lo), p) for p in sample)
        kind = None
        if tg.get("natural") == "spring":
            spring = tg.get("name:en") or tg.get("name")
            kind, label = "Water", "WATER · spring" + (" - " + spring if spring else "") + (" (drinking)" if tg.get("drinking_water") == "yes" else " (untreated)")
        elif tg.get("amenity") in ("drinking_water", "fountain") or tg.get("man_made") == "water_tap":
            kind, label = "Water", "WATER · tap" + (" - " + tg["name"] if tg.get("name") else "")
        elif tg.get("natural") == "water":
            kind, label = "Water", "WATER · " + tg["name"] + " (untreated)"
        elif tg.get("tourism") in ("alpine_hut", "wilderness_hut"):
            kind, label = "Lodging", "HUT · " + tg.get("name", "unnamed")
        elif tg.get("tourism") == "camp_site":
            kind, label = "Campsite", "CAMPSITE · " + tg.get("name", "unnamed")
        elif tg.get("amenity") == "shelter":
            kind, label = "Shelter", "SHELTER · " + (tg.get("name") or tg.get("shelter_type") or "unnamed")
        if not kind:
            continue
        lim = 600 if kind in ("Lodging", "Campsite", "Shelter") else cfg.get("water_radius_m", 300)
        if dist > lim:
            continue
        if any(o["type"] == kind and hav((la, lo), (o["lat"], o["lon"])) < 120 for o in out):
            continue
        lm = near_lm(la, lo)
        label += (" · " + lm if lm else "") + (f" · {round(dist)} m off track" if dist > 60 else "")
        out.append({"name": label, "lat": la, "lon": lo, "type": kind})
    print(f"enrichment: {len(out)} points", file=sys.stderr)
    return out


def boundary_track():
    b = TREK.get("enrich", {}).get("boundary")
    if not b:
        return None
    d = overpass(f"[out:json][timeout:240];relation({b['osm_relation']});way(r)({b['bbox']});out geom;")
    ways = [[(p["lat"], p["lon"]) for p in w["geometry"]] for w in d["elements"] if w["type"] == "way"]
    return (b.get("name", "BOUNDARY · protected area"), ways, "#5B8A3C")


def main():
    tracks = route_tracks()
    all_pts = [p for _, segs in tracks for s in segs for p in s]
    wpts = list(TREK["waypoints"]) + enrich(all_pts)
    x = ['<?xml version="1.0" encoding="UTF-8"?>',
         f'<gpx version="1.1" creator="trek-site-template" xmlns="{NS}" xmlns:osmand="{OSMAND}">',
         f"<metadata><name>{escape(TREK['name'])}</name><desc>{escape(TREK.get('gpxDescription', 'Route from OpenStreetMap contributors (ODbL).'))}</desc></metadata>"]
    for w in wpts:
        col, icon, bg = STYLE.get(w["type"], STYLE["Info"])
        x.append(f'<wpt lat="{w["lat"]:.5f}" lon="{w["lon"]:.5f}"><name>{escape(w["name"])}</name><type>{w["type"]}</type>'
                 f"<extensions><osmand:color>{col}</osmand:color><osmand:icon>{icon}</osmand:icon><osmand:background>{bg}</osmand:background></extensions></wpt>")

    def trk(name, segs, color):
        return (f"<trk><name>{escape(name)}</name><extensions><osmand:color>{color}</osmand:color></extensions>"
                + "".join("<trkseg>" + "".join(f'<trkpt lat="{a:.6f}" lon="{b:.6f}"/>' for a, b in s) + "</trkseg>" for s in segs) + "</trk>")

    for name, segs in tracks:
        x.append(trk(name, segs, "#C8322B"))
    bt = boundary_track()
    if bt:
        x.append(trk(bt[0], bt[1], bt[2]))
    for st in TREK.get("side_tracks", []):
        x.append(trk(st["name"], [[tuple(p) for p in st["points"]]], st.get("color", "#D9820B")))
    x.append("</gpx>")
    OUT.write_text("\n".join(x))
    print(f"wrote {OUT.relative_to(ROOT)}: {len(tracks)} route tracks, {len(wpts)} waypoints", file=sys.stderr)


if __name__ == "__main__":
    main()
