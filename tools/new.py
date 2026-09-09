# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml"]
# ///
"""Scaffold a new trek repo from this template and wire the GitHub repo and KitSHn deploy key.

  uv run tools/new.py --slug yam2yam --name "Sea to Sea Dossier" --hostname yam2yam.yarden-zamir.com \
      --start 2026-09-10 --days 4 --arrival 2026-09-09 [--languages en,he] [--owner Yarden-zamir] [--no-github]

Creates ~/Github/<slug>/ with trek.json and content.yaml skeletons (one day entry per date, labels
filled), the README intro, an initial commit, the public GitHub repo, and runs `kitshn recipe auth`
BEFORE the first push so the first push deploys. Prints the remaining steps.
"""
import argparse
import datetime as dt
import json
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

TEMPLATE = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--slug", required=True)
ap.add_argument("--name", required=True)
ap.add_argument("--hostname", required=True)
ap.add_argument("--start", required=True, help="first walking day, YYYY-MM-DD")
ap.add_argument("--days", type=int, required=True, help="number of walking days")
ap.add_argument("--arrival", help="arrival day (night 0), default the day before --start")
ap.add_argument("--languages", default="en,he")
ap.add_argument("--owner", default="Yarden-zamir")
ap.add_argument("--vps", default="root@89.233.108.13")
ap.add_argument("--dest", default=str(Path.home() / "Github"))
ap.add_argument("--no-github", action="store_true", help="only scaffold files")
a = ap.parse_args()

dest = Path(a.dest) / a.slug
if dest.exists():
    sys.exit(f"{dest} exists; remove it or pick another slug")
langs = a.languages.split(",")
start = dt.date.fromisoformat(a.start)
arrival = dt.date.fromisoformat(a.arrival) if a.arrival else start - dt.timedelta(days=1)
dates = [arrival] + [start + dt.timedelta(days=i) for i in range(a.days)]

# ---- copy the template
skip = {".git", ".tiles", "trek.example.json", "content.yaml", "site/index.html", "site/sw.js", "site/manifest.webmanifest", "Caddyfile.j2", "site/maps", "checks"}
for p in TEMPLATE.rglob("*"):
    rel = p.relative_to(TEMPLATE)
    if any(str(rel).startswith(s) for s in skip) or p.is_dir():
        continue
    out = dest / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(p, out)
(dest / "src" / "body.html").unlink(missing_ok=True)

# ---- trek.json
ex = json.loads((TEMPLATE / "trek.example.json").read_text())
trek = {
    "slug": a.slug, "name": a.name, "shortName": a.slug.upper()[:12], "description": f"{a.name}: {a.days}-day plan, {start:%d %b} to {dates[-1]:%d %b %Y}.",
    "hostname": a.hostname, "gpx": f"site/{a.slug}.gpx", "gpxDescription": ex.get("gpxDescription", ""), "timezone": "auto", "languages": langs,
    "accent": "#C8322B", "places": {}, "waypoints": [], "route": {"osm_relations": [], "start": None},
    "sectionMaps": [], "enrich": {"water_radius_m": 300}, "strings": {},
}
(dest / "trek.json").write_text(json.dumps(trek, ensure_ascii=False, indent=2) + "\n")

# ---- content.yaml skeleton
def day(i, d):
    return {"n": i, "date": d.isoformat(), "label": d.strftime("%a %-d %b").upper(), "title": "START → END" if i else "Arrival → START",
            "stats": ["≈NN km", "+NNN / −NNN m", "N–N h", "sleep: where, rules"] if i else ["transport, times", "check-in window"], "hours": 7 if i else None,
            "text": ["What the day is, water, the hard bit, the option, the fallback."]}
content = {}
for lang in langs:
    content[lang] = {"eyebrow": f"TRAIL · REGION · {start:%-d}–{dates[-1]:%-d %B %Y}", "title": a.name, "lede": "Who, when, where, style, what the page is for.",
                     "facts": [{"value": "≈NN km", "label": "START → END"}, {"value": "≈N,NNN m", "label": "total ascent"}, {"value": "≈N,NNN m", "label": "total descent"},
                               {"value": "N,NNN m", "label": "high point"}, {"value": f"{a.days} days", "label": f"{start:%a %-d} → {dates[-1]:%a %-d %b}"}, {"value": "N L", "label": "water on dry days"}],
                     "plan_intro": "Pace assumptions, the rules that shape the day, the GPX in Downloads.",
                     "days": [day(i, d) for i, d in enumerate(dates)], "plan_note": "Spare day? … Faster? …",
                     "rules": [{"title": "Camping rules", "text": "…"}, {"title": "Protected zones", "text": "…"}, {"title": "Dry stretches", "text": "…"}],
                     "refuges": {"caption": "Huts, water and where to pitch", "columns": ["Place", "Alt.", "Open", "Tent", "Note"], "rows": [["PLACE", "N,NNN m", "…", "…", "…"]]},
                     "tech_intro": "What is on the line, then what can be added.",
                     "tech": {"caption": "Technical options and side trips", "columns": ["Objective", "From", "What it is", "Time"], "rows": [["…", "…", "…", "N h"]]},
                     "practical": [{"title": "Season", "items": ["…"]}, {"title": "Transport", "items": ["…"]}], "practical_right": [{"title": "Gear", "items": ["…", "Emergency: 112."]}],
                     "links": {"reports": ["<a href=\"…\">…</a>, when, style, why read it."], "official": ["<a href=\"…\">…</a>"]}}
    for d in content[lang]["days"]:
        if d["hours"] is None:
            del d["hours"]
(dest / "content.yaml").write_text(yaml.safe_dump(content, allow_unicode=True, sort_keys=False, width=1000))

# ---- README intro
readme = (dest / "README.md").read_text()
head_end = readme.index("## How it fits together")
readme = f"# {a.name}\n\n{a.name}, {a.days} days, {start:%-d %B} to {dates[-1]:%-d %B %Y}. Live at https://{a.hostname}.\nBuilt with the trek-site-template; see `skills/trek-dossier/SKILL.md` for the workflow.\n\n" + readme[head_end:]
readme = readme.replace("## Per-trek README\n\nKeep this file's structure; replace the heading and the first paragraph with the trek, its dates\nand the live URL, and drop this section.\n\n", "")
(dest / "README.md").write_text(readme)

# ---- git and GitHub
def run(*cmd, **kw):
    print("$ " + " ".join(cmd), file=sys.stderr)
    return subprocess.run(cmd, cwd=dest, check=True, **kw)

run("git", "init", "-q", "-b", "main")
run("git", "add", "-A")
run("git", "commit", "-q", "-m", f"feat: scaffold {a.name} from trek-site-template")
if not a.no_github:
    run("gh", "repo", "create", f"{a.owner}/{a.slug}", "--public", "--description", trek["description"], "--homepage", f"https://{a.hostname}")
    run("git", "remote", "add", "origin", f"https://github.com/{a.owner}/{a.slug}.git")
    run("kitshn", "recipe", "auth", "--vps-host", a.vps)
print(f"""
scaffolded {dest}

next:
  1. research (tools/find_route.py, tools/research.py, tools/calendar.py, tools/climate.py) and fill trek.json route + waypoints
  2. uv run tools/build_gpx.py && uv run tools/elevation.py && uv run tools/derive.py && uv run tools/maps.py
  3. write content.yaml (every language), then uv run tools/all.py --from build
  4. git push -u origin main   (deploys), then uv run tools/check.py --url https://{a.hostname}/
  5. $DOTFILES/bin/wt-migrate --yes {dest}   (bare + worktree layout; checkout moves to {dest}/main)
""")
