# Trek site template

A static, offline-capable trip dossier for a multi-day trek: a day plan in one or more languages,
an interactive map drawn from the real GPX, elevation profile, per-day live weather with derived
warnings, an hour-by-hour day simulator with a start-time slider, a position snapshot that marks
finished days done, annotated section maps, and the GPX as a download for any map app that reads it. Deploys to a VPS
with KitSHn. Content is data (`content.yaml`); the tools do the rest.

Sites built from it:

- [gr52.yarden-zamir.com](https://gr52.yarden-zamir.com), the GR52 across the Mercantour, 7 days, tent, alpine
- [yam2yam.yarden-zamir.com](https://yam2yam.yarden-zamir.com), the Israel Sea to Sea, 4 days, tent, heat

The `trek-dossier` agent skill in `skills/trek-dossier/SKILL.md` is the workflow. Install it with
`ln -s $(pwd)/skills/trek-dossier ~/.claude/skills/trek-dossier` so edits here are live.

## The two files you write

- `trek.json`: the config. `trek.example.json` shows every key. Route (OpenStreetMap relation ids in
  walking order, or a GPX), waypoints (nights, passes, escapes, notes), hostname, dates, accent
  colour, and the knobs the app uses (`plannedStart`, `treeline`, `exposed`, `heatLimit`,
  `weatherModel`). `tools/derive.py` fills `places`, `sectionMaps` and location-based defaults.
- `content.yaml`: the page text per language. One entry per day with `title`, `label`, `stats`,
  `hours`, `text`; then rules, the refuges table, technical options, practical lists, extra
  sections and links. Inline `<b>`, `<i>`, `<a>` are allowed; no other markup. The renderer emits
  every attribute the app depends on, so the structure cannot be wrong.

## Commands

```sh
uv run tools/new.py --slug … --name … --hostname … --start YYYY-MM-DD --days N   # scaffold a trek repo
uv run tools/find_route.py --bbox … [--name …] [--pick id,id]   # find the OpenStreetMap relations
uv run tools/research.py      # OSM deep dive along the line → research/osm.md + proposed waypoints
uv run tools/dates.py      # holidays, Shabbat, sun, moon, clock changes on the dates
uv run tools/climate.py       # ten years of reanalysis on the dates per night and pass
uv run tools/build_gpx.py     # route + waypoints + OSM water/huts/shelters → the GPX
uv run tools/elevation.py     # heights for every point (resumable)
uv run tools/walked.py        # after the trek: walked.json edits (bypasses, spurs, moved nights) → the GPX as walked
uv run tools/log_pull.py      # fold the edits made on the live log page into log/<user>/log.yaml
uv run tools/derive.py        # places, section maps, defaults into trek.json
uv run tools/maps.py          # annotated section maps as WebP
uv run tools/doctor.py        # config, waypoints, content and GPX checks with fixes spelled out
uv run src/build.py           # content.yaml → page, service worker, manifest, Caddyfile.j2, favicon
uv run tools/check.py [--url https://host/]   # headless Chrome: map, weather, links, snapshot, simulator, screenshot
uv run tools/all.py [--from build] [--skip maps]   # doctor → gpx → elevation → maps → build → doctor → check
uv run tools/import_body.py   # convert a hand-written src/body.html into content.yaml (migration)
uv run tools/side_trips.py    # optional: route side trips over OSM paths
```

## What the page does

- **Days as tabs**: every day card has Plan, Map and Weather tabs. The Map tab holds the live map
  scoped to that day's stretch (highlighted, fitted, with the day's elevation profile and stats); the
  Weather tab carries a badge with the day's warning count. One map per language moves between the
  day tabs and the whole-route host in the Maps section.
- **Map** from the GPX with layer toggles per track and waypoint kind, waypoint icons from the GPX
  `osmand:icon` names, rotation (two-finger twist, right-drag, ↺ ↻ buttons, compass resets north;
  `@tomickigrzegorz/leaflet-rotate`, MIT, vendored), place names and day titles linking to it, deep
  links `#map=<name>` and `#map=day:N`. A place link inside a day opens that day's Map tab.
- **Weather** per day at the night spot and the day's high point from Open-Meteo, with a per-trek
  model choice (`weatherModel`, values beyond its horizon filled from the default blend). Warnings
  are computed, not typed: storm (thunderstorm code, or CAPE ≥ 400 with lifted index ≤ −2 and rain
  chance ≥ 20 %), rain, snow, wind, frost, heat, fog, UV, late arrival. Every warning links to its
  numbers on Open-Meteo.
- **Day simulator**: a start-time slider over your altitude and exposure through the day, the
  weather at the place you would be, an ECMWF ensemble storm strip, the events you meet, and a
  recommended start. Weather for every hour at every sample point along the route is fetched once
  and cached, so the slider and offline use need no requests.
- **Snapshot**: the round button fixed at the bottom left takes one position fix (long-press to pick
  on the map instead). It draws you on the map and as a dot on the elevation profile from the same
  state, opens the Map tab of the day you are on, marks earlier days done and fills today's card with
  distance, ascent left and an arrival estimate.
- **Offline**: a versioned service worker precaches the page, GPX, app, section maps; tiles and
  fonts are cached as used; "Save whole route offline" stores a tile corridor (z12–16) straight into
  the tile cache. The last forecast is saved in the browser and painted first on every load, then
  replaced when the network answers; a stalled request times out after 30 s; a past day says so
  instead of "not yet available"; one bad card cannot blank the others; the GPX load retries with a
  growing pause until it succeeds.

## Trip log (unlisted)

After the trek, `log/<github-user>/log.yaml` makes `site/log/<github-user>/` (not linked, `noindex`):
an intro and one card per day with Log (the text, opened first, with `[[map:QUERY|label]]` links and
`[[photo:ID]]` pictures inline), Pictures (a grid of everything from that day), Map (the day's stretch
with the pictures as a "Pictures" overlay: one preview per group that would overlap at the current
zoom, up to four previews split in the circle and a count, tap for thumbnails; the whole-route map
shows them only once zoomed in) and Weather (that day's ERA5 history from Open-Meteo; the tab
disappears when there is none). Pictures are uploaded on the page itself to `/log/<user>/upload`, a
small service (`uploader/`, Python + Pillow) that reads the time and place from the picture, resizes
it (page, grid and a small square for the map), and keeps `photos/index.json` on a volume shared with the Caddy container (`compose.yml`). Nothing
uploaded enters git. Each day may carry `tips:` (per language, like `text:`), shown on a Tips tab for people
doing the same walk, and the log may carry `sections:` (`[{key, title: {lang}, text: {lang: [paras]}}]`),
reference sections rendered after the wrap-up, such as "Before you go" and "Links". With `"story": "<user>"`
in `trek.json` that log is also the front page (`site/index.html`), and the plan moves to `/plan/` under a
note that it is the plan as it was. `photos:` in `log.yaml` sets a picture's caption, day or place by id, or hides it
(`hide: true`). `cover: {photo: ID, y: 45%}` (or just the id) puts that picture behind the page header and
in the link preview (`og:image`); `y` is where the crop centres. The trip page borrows the log's cover
unless `trek.json` sets its own `"cover": {"src": "/path.jpg", "y": "45%"}`. On the page, long-press a
picture for "Use as the cover". A zip (a Google Photos album download) is unpacked in the browser, three pictures go up
at a time, a failed one is retried, and what the log already holds (same file name or same second) is
skipped, so a failed upload is finished by choosing the same zip again. There is no access control yet:
the page is unlisted and the service has size limits.

Editing on the page: the pencil on a day card opens its text (one paragraph per blank line, with the
`[[map:…]]`, `[[gmaps:…]]` and `[[photo:…]]` tokens) and saves it; a long press (or right click) on
any picture offers to put it in or take it out of that day's log, hide it, or change its caption.
Edits go to `POST /log/<user>/edit` and live in `photos/edits.json` beside the pictures, which the
page lays over the built HTML on load, so they show at once and survive deploys; `tools/log_pull.py`
folds them back into `log.yaml`. Set `LOG_EDIT_KEY` on the uploader to require a key for edits (the
page asks once and remembers it).

Links in the log are chips with an icon for what they open: `[[map:Name|label]]` the site's map,
`[[gmaps:Place|label]]` Google Maps (a business), `[[url:https://…|label]]` a site. Kinds joined with `;`
(`[[map:NIGHT 0;gmaps:Le Chalet …|hostel]]`) make one chip that offers each on tap.

The route as walked: `walked.json` next to `trek.json` lists bypasses, out-and-backs and moved nights;
`tools/walked.py` keeps the plan in `research/plan.gpx` and rebuilds the GPX from it through OpenStreetMap
paths (straight lines where the map has none), so days, distances and picture dots follow what happened.

Every map link on both pages becomes `?map=<query>&from=<where you were>` and shows a "Back to …"
bubble; the browser's back button does the same.

## Conventions the app relies on

Waypoint names carry meaning: `NIGHT n · <date> · <place>: <note>` (with `NIGHT 0` the night
before day 1), `FINISH · …`, `PASS · <name> <ele> m - <note>` (type `Summit`), `NIGHT n option B`
and `FALLBACK` are ignored by the day logic. Types (Night, Flag, Lodging, Campsite, Water, Summit,
SideTrip, ViaFerrata, Escape, Transport, Shelter, Info) set colours, icons and map layers. Tracks:
`ROUTE i of N · …`, `BOUNDARY · …`, `SIDE TRIP · …`, `VIA FERRATA · …`.

## Layout

- `src/`: `render.py` (content.yaml → body), `render_log.py` (log.yaml → log page), `build.py`, `head.html` (theme), `scripts.html`, `sw.js`
- `site/`: `map.js` (map, navigation), `trip.js` (weather, simulator, snapshot), `log.js` (pictures, history, upload), `vendor/` (Leaflet 1.9.4, leaflet-rotate 0.2.4), built files
- `uploader/`: the picture upload service for the trip logs
- `tools/`: the commands above; `research/`: what the research tools write, plus `findings.md`
- `container/Caddyfile`, `compose.yml`, `Dockerfile`, `.kitshn.yaml`, `kitshn.md`: the deploy recipe

## Credits

Route data © OpenStreetMap contributors (ODbL). Tiles © OpenTopoMap (CC BY-SA). Heights from
OpenTopoData. Weather, ensembles and reanalysis from Open-Meteo. Leaflet under `site/vendor/`.

## License

MIT
