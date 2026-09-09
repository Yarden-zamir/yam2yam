"""Shared helpers for the trek tools: Overpass with backoff, haversine, GPX namespaces."""
import math
import sys
import time

import requests

UA = {"User-Agent": "trek-site-template/1.0 (personal hiking plan; https://github.com/Yarden-zamir/trek-site-template)"}
NS = "http://www.topografix.com/GPX/1/1"
OSMAND = "https://osmand.net"


OVERPASS_SERVERS = ("https://overpass-api.de/api/interpreter", "https://overpass.openstreetmap.fr/api/interpreter",
                    "https://overpass.kumi.systems/api/interpreter")


def overpass(query: str, timeout: int = 240) -> dict:
    """Run an Overpass query; rotate mirrors and back off on 429/504, which the public servers return often."""
    for attempt in range(9):
        server = OVERPASS_SERVERS[attempt % len(OVERPASS_SERVERS)]
        try:
            r = requests.post(server, data={"data": query}, headers=UA, timeout=timeout)
        except requests.RequestException as e:
            print(f"overpass {server}: {e}, next mirror", file=sys.stderr)
            time.sleep(5)
            continue
        if r.status_code in (429, 504, 502) or "Dispatcher_Client" in r.text[:2000]:
            wait = 10 * (attempt + 1)
            print(f"overpass {server} {r.status_code}, retry in {wait}s", file=sys.stderr)
            time.sleep(wait)
            continue
        r.raise_for_status()
        time.sleep(3)
        return r.json()
    raise SystemExit("Overpass keeps rate limiting; wait a few minutes and rerun")


def hav(a, b) -> float:
    """Metres between two (lat, lon) pairs."""
    R = 6371000
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def walking_line(gpx_root):
    """The route as one list of (lat, lon, ele, dist_m): ROUTE tracks in order, each track's segments
    chained from the longest one through segments that connect within 500 m. Alternates and loops that
    do not connect are dropped, as the app does, so distances match the page."""
    ns = {"g": NS}
    pts, d, prev = [], 0.0, None
    for trk in gpx_root.findall("g:trk", ns):
        if not (trk.findtext("g:name", default="", namespaces=ns)).startswith("ROUTE"):
            continue
        segs = []
        for s in trk.findall("g:trkseg", ns):
            seg = []
            for p in s.findall("g:trkpt", ns):
                e = p.find("g:ele", ns)
                seg.append((float(p.get("lat")), float(p.get("lon")), float(e.text) if e is not None else None))
            if seg:
                segs.append(seg)
        left = list(segs)
        if prev is None and left:
            left.sort(key=len, reverse=True)
            seg = left.pop(0)
            for q in seg:
                if prev:
                    d += hav(prev[:2], q[:2])
                pts.append((q[0], q[1], q[2], d))
                prev = q
        while left:
            gap, rev, seg = min([(hav(prev[:2], s[0][:2]), False, s) for s in left] + [(hav(prev[:2], s[-1][:2]), True, s) for s in left], key=lambda t: t[0])
            if gap > 500:
                break
            left.remove(seg)
            for q in (list(reversed(seg)) if rev else seg):
                d += hav(prev[:2], q[:2])
                pts.append((q[0], q[1], q[2], d))
                prev = q
    return pts
