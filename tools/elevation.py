# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Add <ele> to every track point and waypoint of the trek GPX from OpenTopoData.

Dataset from trek.json "elevationDataset" (eudem25m for Europe, srtm30m elsewhere, aster30m as a
fallback). Skips BOUNDARY tracks. Respects the public limits: 100 points per call, 1 call per second,
1000 calls per day. Safe to rerun: only points without <ele> are queried.
"""
import json
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import NS, OSMAND  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TREK = json.loads((ROOT / "trek.json").read_text())
ET.register_namespace("", NS)
ET.register_namespace("osmand", OSMAND)
ns = {"g": NS}
path = ROOT / TREK["gpx"]
dataset = TREK.get("elevationDataset", "srtm30m")
tree = ET.parse(path)
root = tree.getroot()
todo = []
for trk in root.findall("g:trk", ns):
    if trk.findtext("g:name", namespaces=ns).startswith("BOUNDARY"):
        continue
    todo += [p for p in trk.iter(f"{{{NS}}}trkpt") if p.find("g:ele", ns) is None]
wp = [w for w in root.findall("g:wpt", ns) if w.find("g:ele", ns) is None]
todo += wp
print(f"{len(todo)} points need elevation ({dataset})", file=sys.stderr)
s = requests.Session()
for i in range(0, len(todo), 100):
    batch = todo[i : i + 100]
    locs = "|".join(f"{p.get('lat')},{p.get('lon')}" for p in batch)
    for attempt in range(6):
        r = s.get(f"https://api.opentopodata.org/v1/{dataset}", params={"locations": locs}, timeout=60)
        if r.status_code == 429:
            time.sleep(6)
            continue
        r.raise_for_status()
        break
    else:
        raise SystemExit("OpenTopoData rate limit; rerun later, progress is kept")
    for p, res in zip(batch, r.json()["results"]):
        if res["elevation"] is None:
            continue
        e = ET.Element(f"{{{NS}}}ele")
        e.text = f"{res['elevation']:.0f}"
        p.insert(0, e)  # GPX order: ele before name
    tree.write(path, encoding="UTF-8", xml_declaration=True)
    print(f"{i + len(batch)}/{len(todo)}", file=sys.stderr)
    time.sleep(1.05)
print("done", file=sys.stderr)
