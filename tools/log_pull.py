# /// script
# requires-python = ">=3.11"
# dependencies = ["requests", "ruamel.yaml"]
# ///
"""Fold the edits made on the live log page into log/<user>/log.yaml.

  uv run tools/log_pull.py [--user yarden-zamir] [--url https://host]

The page keeps its edits (a day's text per language, a picture's caption, hidden pictures, the cover) in
/log/<user>/photos/edits.json next to the pictures; this reads that file and writes the same values
into the yaml, keeping comments and order, so git and the page agree again. Run src/build.py after.
"""
import argparse
import json
import sys
from pathlib import Path

import requests
from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap
from ruamel.yaml.scalarstring import DoubleQuotedScalarString as DQ

ROOT = Path(__file__).resolve().parent.parent
TREK = json.loads((ROOT / "trek.json").read_text())
ap = argparse.ArgumentParser()
ap.add_argument("--user", help="the log's GitHub user (default: the only log/*/ folder)")
ap.add_argument("--url", help="site root (default: https://<hostname> from trek.json)")
a = ap.parse_args()
logs = sorted(p.parent.name for p in (ROOT / "log").glob("*/log.yaml"))
user = a.user or (logs[0] if len(logs) == 1 else None)
if not user:
    sys.exit(f"which log? --user one of {logs}")
url = (a.url or "https://" + TREK["hostname"]).rstrip("/") + f"/log/{user}/photos/edits.json"
r = requests.get(url, timeout=30)
if r.status_code == 404:
    sys.exit("no edits on the page yet")
r.raise_for_status()
edits = r.json()
yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096
yaml.indent(mapping=2, sequence=4, offset=2)  # the layout the files use, so the diff shows only the edits
path = ROOT / "log" / user / "log.yaml"
doc = yaml.load(path.read_text(encoding="utf-8"))
changed = 0
by_n = {int(d["n"]): d for d in doc["days"]}
for n, d in (edits.get("days") or {}).items():
    day = by_n.get(int(n))
    if not day:
        print(f"day {n}: not in the yaml, skipped", file=sys.stderr)
        continue
    for lang, paras in (d.get("text") or {}).items():
        if not isinstance(day.get("text"), dict):
            day["text"] = {}
        day["text"][lang] = [DQ(p) for p in paras]
        changed += 1
if "cover" in edits:  # the cover picture: an id, or null when it was removed on the page
    cur = doc.get("cover")
    cur_id = cur.get("photo") if isinstance(cur, dict) else cur
    if edits["cover"] and edits["cover"] != cur_id:
        m = CommentedMap([("photo", edits["cover"]), ("y", (cur.get("y") if isinstance(cur, dict) else None) or "50%")])
        m.fa.set_flow_style()
        if "cover" in doc:
            doc["cover"] = m
        else:
            doc.insert(list(doc.keys()).index("days"), "cover", m)
        changed += 1
    elif not edits["cover"] and "cover" in doc:
        del doc["cover"]
        changed += 1
for kind in ("intro", "outro"):
    for lang, paras in (edits.get(kind) or {}).items():
        if not isinstance(doc.get(kind), dict):
            doc[kind] = {}
        doc[kind][lang] = [DQ(p) for p in paras]
        changed += 1
photos = doc.setdefault("photos", {})
for pid, e in (edits.get("photos") or {}).items():
    rec = photos.get(pid) if pid in photos else photos.get(int(pid)) if pid.isdigit() else None
    key = pid if pid in photos or not (pid.isdigit() and int(pid) in photos) else int(pid)
    if rec is None:
        rec = photos[key] = {}
    if "hide" in e:
        if e["hide"]:
            rec["hide"] = True
        else:
            rec.pop("hide", None)
        changed += 1
    if e.get("caption"):
        cap = rec.get("caption")
        if not isinstance(cap, dict):
            cap = {lang: cap for lang in TREK["languages"]} if cap else {}
        cap.update(e["caption"])
        rec["caption"] = cap
        changed += 1
yaml.dump(doc, path.open("w", encoding="utf-8"))
print(f"{changed} values from {url} folded into {path.relative_to(ROOT)}; run src/build.py", file=sys.stderr)
