# Research

Everything a walker acts on needs a source. Fill `findings.md` from the template below as you go; the
tools write the rest of this folder. Copy source URLs into `content.yaml` links.

## Tools (run in this order, each writes here)

| tool | writes | what it catches that a web search misses |
|---|---|---|
| `tools/find_route.py` | route into `trek.json` | the real OpenStreetMap relation, its true length, gaps in the chain, superroutes |
| `tools/research.py` | `osm.md`, `osm.json`, `waypoints.proposed.json` | T-grades and hazards on the route's own ways, fords, protected areas (where the rules live), huts with hours and phones, water with drinking tags, bus stops and stations within reach, peaks for side trips, via ferrata nearby, shops and fuel |
| `tools/dates.py` | `calendar.md` | holidays and Shabbat on the dates, sunrise, sunset, dusk, daylight, moon, clock changes |
| `tools/climate.py` | `climate.md` | ten years of reanalysis on these dates per night and pass: typical temperatures, rain, thunder, frost and heat frequencies; suggested start hour, heat limit and sleeping-bag rating |

## findings.md template

```markdown
# Findings: <trek>

## Rules (camping hours, zones, dogs, fires, gates)   — source
## Sleeping (each night: place, open dates, price, booking, phone) — source per line
## Water (per day: reliable, seasonal, dry stretches) — source
## Transport (to start, from end, bail-outs, times on the dates) — source
## Difficulty (named sections, grades, what the reports say) — source
## Season (what the reports from the same month say) — source
## Emergency (numbers, rescue, nearest hospital)
## Open questions (what could not be verified)
```
