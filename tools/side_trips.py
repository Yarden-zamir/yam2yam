# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Route optional side trips over OpenStreetMap paths and add them to trek.json "side_tracks".

trek.json "side_trips": [{"name": "SIDE TRIP · Day 4 · Mont Bego", "from": [lat, lon], "to": [lat, lon]}].
Shortest path over highway=path|footway|track within a box around the two points. Prints the
one-way length. Rerun tools/build_gpx.py afterwards.
"""
import heapq
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import hav, overpass  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
p = ROOT / "trek.json"
TREK = json.loads(p.read_text())
out = []
for st in TREK.get("side_trips", []):
    a, b = st["from"], st["to"]
    lat0, lat1 = min(a[0], b[0]) - .02, max(a[0], b[0]) + .02
    lon0, lon1 = min(a[1], b[1]) - .03, max(a[1], b[1]) + .03
    d = overpass(f'[out:json][timeout:180];way["highway"~"^(path|footway|track)$"]({lat0},{lon0},{lat1},{lon1});out geom;')
    adj = {}
    for w in d["elements"]:
        g = [(pt["lat"], pt["lon"]) for pt in w["geometry"]]
        for u, v in zip(g, g[1:]):
            dd = hav(u, v)
            adj.setdefault(u, []).append((v, dd))
            adj.setdefault(v, []).append((u, dd))
    if not adj:
        print(f"{st['name']}: no paths found", file=sys.stderr)
        continue
    s = min(adj, key=lambda k: hav(k, a))
    t = min(adj, key=lambda k: hav(k, b))
    dist, prev, pq = {s: 0}, {}, [(0, s)]
    while pq:
        dc, u = heapq.heappop(pq)
        if u == t:
            break
        if dc > dist.get(u, 1e18):
            continue
        for v, w in adj[u]:
            nd = dc + w
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    if t not in dist:
        print(f"{st['name']}: no connected path", file=sys.stderr)
        continue
    path = [t]
    while path[-1] != s:
        path.append(prev[path[-1]])
    path.reverse()
    gap = hav(t, b)
    name = st["name"] + f" - {dist[t] / 1000:.1f} km one way" + (f", path ends {round(gap)} m before the target" if gap > 100 else "")
    out.append({"name": name, "points": [[round(x, 6), round(y, 6)] for x, y in path]})
    print(name, file=sys.stderr)
TREK["side_tracks"] = out
p.write_text(json.dumps(TREK, ensure_ascii=False, indent=2) + "\n")
