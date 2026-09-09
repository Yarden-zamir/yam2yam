# /// script
# requires-python = ">=3.11"
# ///
"""Run the whole pipeline in order, stopping at the first failure, with a summary at the end.

  uv run tools/all.py            # doctor → gpx → elevation → maps → build → doctor → check
  uv run tools/all.py --from build   # start at a step (doctor, gpx, elevation, maps, build, check)
  uv run tools/all.py --skip maps    # skip a step (repeatable)
Steps that are already done are cheap to rerun: elevation only fetches missing points, maps reuse tiles.
"""
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STEPS = [
    ("doctor", ["tools/doctor.py"]),
    ("gpx", ["tools/build_gpx.py"]),
    ("elevation", ["tools/elevation.py"]),
    ("maps", ["tools/maps.py"]),
    ("build", ["src/build.py"]),
    ("doctor2", ["tools/doctor.py"]),
    ("check", ["tools/check.py"]),
]
args = sys.argv[1:]
start = args[args.index("--from") + 1] if "--from" in args else "doctor"
skip = {args[i + 1] for i, a in enumerate(args) if a == "--skip"}
names = [s for s, _ in STEPS]
todo = STEPS[names.index(start):] if start in names else STEPS
results = []
for name, cmd in todo:
    if name in skip or (name == "doctor2" and "doctor" in skip):
        results.append((name, "skipped", 0))
        continue
    t0 = time.time()
    print(f"\n=== {name}: uv run {' '.join(cmd)}", flush=True)
    rc = subprocess.call(["uv", "run", *cmd], cwd=ROOT)
    results.append((name, "ok" if rc == 0 else f"FAILED ({rc})", time.time() - t0))
    if rc != 0:
        break
print("\n=== summary")
for name, status, secs in results:
    print(f"  {name:10} {status:12} {secs:5.0f}s")
sys.exit(0 if all(s in ("ok", "skipped") for _, s, _ in results) and len(results) == len(todo) else 1)
