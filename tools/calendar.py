# /// script
# requires-python = ">=3.11"
# dependencies = ["holidays", "astral", "requests"]
# ///
"""Calendar facts for the trek dates that change transport and opening hours: public and religious
holidays (national and regional), Shabbat where relevant, sunrise, sunset, civil twilight, daylight,
moon phase, and DST changes. Writes research/calendar.md and prints it.

  uv run tools/calendar.py                 # dates from content.yaml days, location from trek.json route.start
  uv run tools/calendar.py --country FR --subdiv 06
Country is inferred from the start point when not given (IL, FR, IT, ES, CH, AT, DE, GR, PT, GB).
"""
import argparse
import datetime as dt
import json
import sys
from pathlib import Path

import holidays
import yaml
from astral import LocationInfo, moon
from astral.sun import sun

ROOT = Path(__file__).resolve().parent.parent
T = json.loads((ROOT / "trek.json").read_text())
ap = argparse.ArgumentParser()
ap.add_argument("--country")
ap.add_argument("--subdiv")
a = ap.parse_args()
lat, lon = T["route"].get("start") or (None, None)
if lat is None:
    sys.exit("trek.json route.start is needed")
country = a.country
if not country:
    boxes = {"IL": (29, 33.5, 34, 36), "FR": (41, 51.5, -5.5, 9.7), "IT": (36, 47.2, 6.5, 18.6), "ES": (36, 43.9, -9.5, 3.4), "CH": (45.8, 47.9, 5.9, 10.6), "AT": (46.3, 49.1, 9.5, 17.2), "DE": (47.2, 55.1, 5.8, 15.1), "GR": (34.8, 41.8, 19.3, 28.3), "PT": (36.9, 42.2, -9.6, -6.1), "GB": (49.9, 60.9, -8.7, 1.8)}
    for c, (la0, la1, lo0, lo1) in boxes.items():
        if la0 <= lat <= la1 and lo0 <= lon <= lo1:
            country = c
            break
country = country or "FR"
content = yaml.safe_load((ROOT / "content.yaml").read_text()) if (ROOT / "content.yaml").exists() else {}
days = (content.get(T["languages"][0], {}) or {}).get("days") or []
dates = [dt.date.fromisoformat(str(d["date"])) for d in days] if days else []
if not dates:
    sys.exit("no dates: fill content.yaml days first")
span = [dates[0] + dt.timedelta(days=i) for i in range((dates[-1] - dates[0]).days + 1)]
hol = holidays.country_holidays(country, subdiv=a.subdiv, years={d.year for d in span}, language="en") if hasattr(holidays, "country_holidays") else holidays.CountryHoliday(country, years={d.year for d in span})
loc = LocationInfo("start", country, T.get("timezone", "UTC"), lat, lon)
tz = T.get("timezone") if T.get("timezone") not in (None, "auto") else "UTC"
out = [f"# Calendar for {T['name']} ({country}{'-' + a.subdiv if a.subdiv else ''}, {tz})\n", "| date | weekday | holiday | sunrise | sunset | daylight | dusk (civil) | moon |", "|---|---|---|---|---|---|---|---|"]
flags = []
for d in span:
    s = sun(loc.observer, date=d, tzinfo=tz)
    h = hol.get(d)
    note = h or ""
    if country == "IL":
        if d.weekday() == 4:
            note = (note + "; " if note else "") + "Friday: Shabbat begins at sunset, buses stop early afternoon"
        if d.weekday() == 5:
            note = (note + "; " if note else "") + "Shabbat: no public transport until evening"
    if d.weekday() == 6 and country != "IL":
        note = (note + "; " if note else "") + "Sunday: reduced transport in most of Europe"
    daylight = s["sunset"] - s["sunrise"]
    phase = moon.phase(d)
    mtxt = "new" if phase < 1.8 else "waxing" if phase < 12.9 else "full" if phase < 16 else "waning" if phase < 26.5 else "new"
    out.append(f"| {d} | {d.strftime('%a')} | {note} | {s['sunrise']:%H:%M} | {s['sunset']:%H:%M} | {str(daylight)[:-3]} h | {s['dusk']:%H:%M} | {mtxt} ({phase:.0f}) |")
    if h:
        flags.append(f"{d} {d.strftime('%a')}: {h}")
# DST changes inside or right after the window
try:
    import zoneinfo
    z = zoneinfo.ZoneInfo(tz)
    for d in span + [span[-1] + dt.timedelta(days=i) for i in range(1, 8)]:
        a0 = dt.datetime(d.year, d.month, d.day, 1, tzinfo=z).utcoffset()
        b0 = dt.datetime(d.year, d.month, d.day, 23, tzinfo=z).utcoffset()
        if a0 != b0:
            flags.append(f"{d}: clocks change (UTC offset {a0} → {b0})")
except Exception:
    pass
out.append("")
out.append("## Flags\n" + ("\n".join("- " + f for f in flags) if flags else "- no holidays or clock changes on the trek dates"))
txt = "\n".join(out) + "\n"
(ROOT / "research").mkdir(exist_ok=True)
(ROOT / "research" / "calendar.md").write_text(txt)
print(txt)
