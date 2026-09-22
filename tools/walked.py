# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Turn the planned GPX into the route as walked: walked.json next to trek.json lists the changes.

The plan is kept in research/plan.gpx (copied from the trek GPX on the first run) and every run
rebuilds the trek GPX from it, so the edits can be refined and rerun. Each edit is one of:

  {"replace": {"from": [lat, lon], "to": [lat, lon], "via": [[lat, lon], ...], "note": "..."}}
      the walking line between the two points (nearest route points) is replaced by the OpenStreetMap
      paths through the via points; a leg with no path becomes a straight line
  {"spur": {"at": [lat, lon], "to": [lat, lon], "via": [...], "note": "..."}}
      an out-and-back from the route (at: nearest route point, or the point nearest "to") to a place;
      "straight": true on either draws straight legs, for a line the map does not know
  {"move": {"waypoint": "NIGHT 3", "to": [lat, lon], "name": "new name"}}
      a waypoint (matched by the start of its name) goes elsewhere, renamed when "name" is given
  {"add": {"name": "HUT · Refuge de Nice", "lat": .., "lon": .., "type": "Lodging"}}
  {"drop": {"waypoint": "NIGHT 2 option B"}}

Points added to the line have no <ele>; run tools/elevation.py afterwards. Paths come from Overpass
(cached under the system temp dir), so the first run needs the network.
"""
import hashlib
import heapq
import json
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import NS, OSMAND, hav, overpass  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TREK = json.loads((ROOT / "trek.json").read_text())
GPX = ROOT / TREK["gpx"]
PLAN = ROOT / "research" / "plan.gpx"
WALKED = ROOT / "walked.json"
CACHE = Path(tempfile.gettempdir()) / "trek-walked"
ET.register_namespace("", NS)
ET.register_namespace("osmand", OSMAND)
ns = {"g": NS}
HIGHWAYS = "path|footway|track|steps|bridleway|unclassified|tertiary|residential|service|pedestrian|living_street|secondary|cycleway"
STYLE = {"Night": ("#C8322B", "tourism_camp_site", "circle"), "Lodging": ("#8B5A2B", "tourism_alpine_hut", "circle"), "Summit": ("#6B7775", "natural_peak", "octagon"),
         "Water": ("#2C6A8A", "amenity_drinking_water", "circle"), "Info": ("#B3701C", "special_information", "square"), "Shop": ("#B3701C", "shop_convenience", "square")}


def ways_in(bbox):
    """OpenStreetMap ways one can walk on inside the box, as node lists, cached by box."""
    key = hashlib.sha1(repr(bbox).encode()).hexdigest()[:12]
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"ways-{key}.json"
    if f.exists():
        return json.loads(f.read_text())
    d = overpass(f'[out:json][timeout:180];way["highway"~"^({HIGHWAYS})$"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]});out geom;')
    ways = [{"id": w["id"], "pts": [(p["lat"], p["lon"]) for p in w["geometry"]], "tags": w.get("tags", {})} for w in d["elements"] if w["type"] == "way"]
    f.write_text(json.dumps(ways))
    return ways


class Graph:
    def __init__(self, ways):
        self.adj = {}
        for w in ways:
            pts = [tuple(p) for p in w["pts"]]
            for a, b in zip(pts, pts[1:]):
                d = hav(a, b)
                self.adj.setdefault(a, []).append((b, d))
                self.adj.setdefault(b, []).append((a, d))
        self.nodes = list(self.adj)

    def snap(self, p):
        return min(self.nodes, key=lambda n: hav(n, p)) if self.nodes else None

    def path(self, a, b):
        """Shortest path between two graph nodes, or None."""
        dist, prev, seen = {a: 0.0}, {}, set()
        q = [(0.0, a)]
        while q:
            d, u = heapq.heappop(q)
            if u in seen:
                continue
            seen.add(u)
            if u == b:
                out = [b]
                while out[-1] != a:
                    out.append(prev[out[-1]])
                return out[::-1]
            for v, w in self.adj.get(u, []):
                nd = d + w
                if nd < dist.get(v, 1e18):
                    dist[v], prev[v] = nd, u
                    heapq.heappush(q, (nd, v))
        return None


def route_between(points, note, straight=False):
    """The walked line through the points, leg by leg on OpenStreetMap paths, straight where none
    (or where the edit says "straight": a line the map does not know, a crest, a bog bank)."""
    lats, lons = [p[0] for p in points], [p[1] for p in points]
    bbox = (round(min(lats) - .012, 3), round(min(lons) - .015, 3), round(max(lats) + .012, 3), round(max(lons) + .015, 3))
    g = Graph([] if straight else ways_in(bbox))
    out = [tuple(points[0])]
    for a, b in zip(points, points[1:]):
        na, nb = g.snap(a), g.snap(b)
        leg = None
        if na and nb and hav(na, a) < 250 and hav(nb, b) < 250:
            leg = g.path(na, nb)
        if leg:
            straight, along = hav(a, b), sum(hav(x, y) for x, y in zip(leg, leg[1:]))
            if along > max(4 * straight, straight + 3000):  # a huge detour means the map has no real path here
                leg = None
        if leg:
            out += [tuple(a)] + [tuple(p) for p in leg] + [tuple(b)]
            print(f"  {note}: leg on paths, {sum(hav(x, y) for x, y in zip(leg, leg[1:])) / 1000:.1f} km", file=sys.stderr)
        else:
            out += [tuple(a), tuple(b)]
            print(f"  {note}: leg straight, {hav(a, b) / 1000:.1f} km (no path on the map)", file=sys.stderr)
    dedup = [out[0]]
    for p in out[1:]:
        if hav(p, dedup[-1]) > 1:
            dedup.append(p)
    return dedup


def main():
    if not PLAN.exists():
        PLAN.parent.mkdir(exist_ok=True)
        shutil.copy(GPX, PLAN)
        print(f"kept the plan in {PLAN.relative_to(ROOT)}", file=sys.stderr)
    edits = json.loads(WALKED.read_text())["edits"] if WALKED.exists() else []
    tree = ET.parse(PLAN)
    root = tree.getroot()
    # the walking line: every ROUTE track point in order, tagged with its (track, segment) so it can be put back
    line = []
    for ti, trk in enumerate(root.findall("g:trk", ns)):
        if not trk.findtext("g:name", default="", namespaces=ns).startswith("ROUTE"):
            continue
        for si, seg in enumerate(trk.findall("g:trkseg", ns)):
            for p in seg.findall("g:trkpt", ns):
                ele = p.findtext("g:ele", namespaces=ns)
                line.append({"ll": (float(p.get("lat")), float(p.get("lon"))), "ele": ele, "key": (ti, si)})

    def nearest(ll):
        return min(range(len(line)), key=lambda i: hav(line[i]["ll"], ll))

    wpts = root.findall("g:wpt", ns)
    added = 0
    for e in edits:
        kind, a = next(iter(e.items()))
        if kind == "replace":
            i, j = nearest(a["from"]), nearest(a["to"])
            if i > j:
                i, j = j, i
            print(f"replace {a.get('note', '')}: from {line[i]['ll']} to {line[j]['ll']}", file=sys.stderr)
            pts = route_between([line[i]["ll"]] + [tuple(v) for v in a.get("via", [])] + [line[j]["ll"]], a.get("note", "replace"), a.get("straight", False))
            key = line[i]["key"]
            cut = sum(hav(line[k]["ll"], line[k + 1]["ll"]) for k in range(i, j) if line[k]["key"] == line[k + 1]["key"])
            line[i:j + 1] = [{"ll": p, "ele": None, "key": key} for p in pts]
            print(f"replace {a.get('note', '')}: {cut / 1000:.1f} km of plan → {sum(hav(x, y) for x, y in zip(pts, pts[1:])) / 1000:.1f} km walked", file=sys.stderr)
        elif kind == "spur":
            i = nearest(a["at"] if a.get("at") else a["to"])
            print(f"spur {a.get('note', '')}: leaves the route at {line[i]['ll']}, {hav(line[i]['ll'], tuple(a['to'])) / 1000:.1f} km as the crow flies", file=sys.stderr)
            pts = route_between([line[i]["ll"]] + [tuple(v) for v in a.get("via", [])] + [tuple(a["to"])], a.get("note", "spur"), a.get("straight", False))
            both = pts + pts[-2::-1]
            key = line[i]["key"]
            line[i + 1:i + 1] = [{"ll": p, "ele": None, "key": key} for p in both]
            print(f"spur {a.get('note', '')}: {sum(hav(x, y) for x, y in zip(both, both[1:])) / 1000:.1f} km out and back", file=sys.stderr)
        elif kind == "move":
            w = next((w for w in wpts if w.findtext("g:name", default="", namespaces=ns).startswith(a["waypoint"])), None)
            if w is None:
                sys.exit(f"move: no waypoint starts with {a['waypoint']!r}")
            w.set("lat", f"{a['to'][0]:.5f}")
            w.set("lon", f"{a['to'][1]:.5f}")
            el = w.find("g:ele", ns)
            if el is not None:
                w.remove(el)
            if a.get("name"):
                w.find("g:name", ns).text = a["name"]
        elif kind == "drop":
            for w in [w for w in wpts if w.findtext("g:name", default="", namespaces=ns).startswith(a["waypoint"])]:
                root.remove(w)
                wpts.remove(w)
        elif kind == "add":
            col, icon, bg = STYLE.get(a.get("type", "Info"), STYLE["Info"])
            w = ET.Element(f"{{{NS}}}wpt", {"lat": f"{a['lat']:.5f}", "lon": f"{a['lon']:.5f}"})
            ET.SubElement(w, f"{{{NS}}}name").text = a["name"]
            ET.SubElement(w, f"{{{NS}}}type").text = a.get("type", "Info")
            ext = ET.SubElement(w, f"{{{NS}}}extensions")
            ET.SubElement(ext, f"{{{OSMAND}}}color").text = col
            ET.SubElement(ext, f"{{{OSMAND}}}icon").text = icon
            ET.SubElement(ext, f"{{{OSMAND}}}background").text = bg
            w.tail = "\n"
            root.insert(1 + added, w)  # first in the file, so a place name finds it before the water taps
            added += 1
            wpts.insert(added - 1, w)
        else:
            sys.exit(f"unknown edit {kind}")
    # put the line back into its tracks and segments
    for ti, trk in enumerate(root.findall("g:trk", ns)):
        if not trk.findtext("g:name", default="", namespaces=ns).startswith("ROUTE"):
            continue
        for si, seg in enumerate(trk.findall("g:trkseg", ns)):
            for p in seg.findall("g:trkpt", ns):
                seg.remove(p)
            for p in line:
                if p["key"] != (ti, si):
                    continue
                el = ET.SubElement(seg, f"{{{NS}}}trkpt", {"lat": f"{p['ll'][0]:.6f}", "lon": f"{p['ll'][1]:.6f}"})
                if p["ele"] is not None:
                    ET.SubElement(el, f"{{{NS}}}ele").text = p["ele"]
        for seg in [s for s in trk.findall("g:trkseg", ns) if s.find("g:trkpt", ns) is None]:
            trk.remove(seg)  # an alternate that fell inside a replaced stretch
    tree.write(GPX, xml_declaration=True, encoding="UTF-8")
    total = sum(hav(line[k]["ll"], line[k + 1]["ll"]) for k in range(len(line) - 1) if line[k]["key"] == line[k + 1]["key"])
    print(f"wrote {GPX.relative_to(ROOT)}: {len(edits)} edits, walking line {total / 1000:.1f} km; run tools/elevation.py next", file=sys.stderr)


if __name__ == "__main__":
    main()
