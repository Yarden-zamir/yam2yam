# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""What the weather usually is on these dates: ten years of ERA5 reanalysis from Open-Meteo's archive
for each night spot and each day's high point, over the trek's calendar window ±7 days. Writes
research/climate.md with, per point: typical min/max, the 10th and 90th percentile, share of days with
rain over 5 mm, with thunderstorm codes, with frost, with heat over the trek's heatLimit, and the mean
freezing level. Also proposes plannedStart, heatLimit and a sleeping-bag rating. Run after the GPX
and elevation exist.
"""
import datetime as dt
import json
import statistics as st
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import NS, UA  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
T = json.loads((ROOT / "trek.json").read_text())
ns = {"g": NS}
g = ET.parse(ROOT / T["gpx"]).getroot()
wp = [(w.findtext("g:name", namespaces=ns), float(w.get("lat")), float(w.get("lon")), float(w.findtext("g:ele", default="0", namespaces=ns))) for w in g.findall("g:wpt", ns)]
nights = [w for w in wp if w[0].startswith(("NIGHT ", "FINISH")) and "option" not in w[0] and "FALLBACK" not in w[0]]
passes = [w for w in wp if w[0].startswith("PASS · ")]
points = [(w[0].split(" · ")[-1].split(":")[0][:32], w[1], w[2], w[3]) for w in nights] + [(w[0].split(" · ")[1].split(" - ")[0][:32], w[1], w[2], w[3]) for w in passes]
import re
m = re.search(r"NIGHT 1 · \w+ (\d+) (\w{3})", " ".join(w[0] for w in nights))
if not m:
    sys.exit("need a 'NIGHT 1 · <dow> <day> <Mon>' waypoint to know the dates")
month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].index(m.group(2)) + 1
day = int(m.group(1))
year0 = dt.date.today().year
rows = []
S = requests.Session()
S.headers.update(UA)
lim = T.get("heatLimit", 32)
for name, lat, lon, ele in points:
    tmin, tmax, rain, storm, frost, heat, fl = [], [], [], [], [], [], []
    for y in range(year0 - 10, year0):
        d0 = dt.date(y, month, day) - dt.timedelta(days=7)
        d1 = dt.date(y, month, day) + dt.timedelta(days=10)
        for attempt in range(4):
            r = S.get("https://archive-api.open-meteo.com/v1/archive", params={"latitude": lat, "longitude": lon, "elevation": round(ele), "start_date": d0, "end_date": d1,
                      "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code", "timezone": "auto"}, timeout=60)
            if r.status_code == 429:
                time.sleep(5)
                continue
            break
        j = r.json()
        if "daily" not in j:
            continue
        dd = j["daily"]
        tmin += [v for v in dd["temperature_2m_min"] if v is not None]
        tmax += [v for v in dd["temperature_2m_max"] if v is not None]
        rain += [v for v in dd["precipitation_sum"] if v is not None]
        storm += [c for c in dd["weather_code"] if c is not None]
        time.sleep(0.3)
    if not tmin:
        continue
    q = lambda xs, p: sorted(xs)[int(len(xs) * p)]
    rows.append({"point": name, "ele": round(ele), "tmin_med": round(st.median(tmin), 1), "tmin_p10": round(q(tmin, .1), 1), "tmax_med": round(st.median(tmax), 1), "tmax_p90": round(q(tmax, .9), 1),
                 "rain5": round(100 * sum(1 for v in rain if v >= 5) / len(rain)), "storm": round(100 * sum(1 for c in storm if c >= 95) / len(storm)), "frost": round(100 * sum(1 for v in tmin if v <= 0) / len(tmin)), "heat": round(100 * sum(1 for v in tmax if v >= lim) / len(tmax)), "n": len(tmin)})
out = [f"# Climate on the trek dates (ERA5, {year0 - 10}–{year0 - 1}, ±7 days around {day} {m.group(2)})\n",
       f"| point | ele | min (median / p10) | max (median / p90) | days rain ≥5 mm | thunder days | frost days | days ≥{lim} °C |", "|---|---|---|---|---|---|---|---|"]
for r in rows:
    out.append(f"| {r['point']} | {r['ele']} m | {r['tmin_med']} / {r['tmin_p10']} °C | {r['tmax_med']} / {r['tmax_p90']} °C | {r['rain5']} % | {r['storm']} % | {r['frost']} % | {r['heat']} % |")
coldest = min(rows, key=lambda r: r["tmin_p10"]) if rows else None
hottest = max(rows, key=lambda r: r["tmax_p90"]) if rows else None
adv = []
if coldest:
    adv.append(f"- sleeping bag: comfort to about {round(coldest['tmin_p10'] - 3)} °C ({coldest['point']} p10 night {coldest['tmin_p10']} °C)")
if hottest:
    adv.append(f"- plannedStart: {'6' if hottest['tmax_p90'] >= 30 else '7' if hottest['tmax_p90'] >= 26 else '8'} (p90 max {hottest['tmax_p90']} °C at {hottest['point']})")
    adv.append(f"- heatLimit: {'30' if hottest['tmax_p90'] >= 32 else '32'}")
if rows and max(r["storm"] for r in rows) >= 10:
    adv.append("- thunderstorms are a normal feature of these dates: plan passes for the morning")
if rows and max(r["frost"] for r in rows) >= 10:
    adv.append("- frost is normal at the high nights: pack for it")
out.append("\n## Suggested settings\n" + "\n".join(adv))
txt = "\n".join(out) + "\n"
(ROOT / "research").mkdir(exist_ok=True)
(ROOT / "research" / "climate.md").write_text(txt)
print(txt)
