# Sea to Sea (Yam el Yam) dossier

Trek dossier for the Sea to Sea trail, Achziv to the Kinneret, 16 to 19 October 2026, live at
https://yam2yam.yarden-zamir.com. Built from `Yarden-zamir/trek-site-template`; the notes below
describe that template, which this repo carries unchanged apart from `trek.json`, `src/body.html`
and small tool fixes.


Built from the GR52 dossier at https://gr52.yarden-zamir.com. Use it through the `trek-dossier`
agent skill, which lists the inputs and the steps.

## How it fits together

- `trek.json`: the one config. Name, slug, hostname, dates, timezone, route source
  (OpenStreetMap relation ids or a GPX), waypoints, place-name links, section maps, enrichment.
- `src/body.html`: the content, written per trek, both languages. `src/head.html` (theme),
  `src/scripts.html` (language toggle, profile), `src/sw.js` (service worker template).
- `site/map.js`: the generic app. Reads `window.TREK` (injected by the build) and the GPX.
- `src/build.py`: assembles `site/index.html`, `site/sw.js`, `site/manifest.webmanifest`,
  `Caddyfile.j2`. Adds table captions and card labels, links place names, inserts section maps.
- `tools/`: `build_gpx.py` (route + waypoints + OpenStreetMap enrichment), `elevation.py`
  (OpenTopoData heights), `maps.py` (section maps from OpenTopoMap tiles), `side_trips.py`
  (optional routed side tracks), `check.py` (headless Chrome verification of the built site).

## Conventions the app relies on

Waypoint names carry meaning. The app reads them to find days, nights and the finish:

- `NIGHT n · <date> · <place>: <note>` for each sleeping spot, `NIGHT 0` for the night before day 1.
- `FINISH · <date> · <place>` for the end.
- `PASS · <name> <ele> m - <note>` for cols and summits on the line (type `Summit`).
- `FALLBACK night n · …` and `NIGHT n option B · …` are ignored by the day logic.
- Types: Night, Flag, Lodging, Campsite, Water, Summit, SideTrip, ViaFerrata, Escape, Transport,
  Shelter, Info. Type sets the colour and icon in OsmAnd and the map layer group.
- Tracks: `ROUTE i of N · …` (the walking line, in order), `BOUNDARY · …`, `SIDE TRIP · …`,
  `VIA FERRATA · …`.

Day cards in `src/body.html` carry `data-day="n"` and `data-date="YYYY-MM-DD"`. The planned
hours chip (`8–9 h`) in a card feeds the arrival estimate and the hourly walking window.

## Build and check

```sh
uv run tools/build_gpx.py      # route + waypoints from trek.json
uv run tools/elevation.py      # heights
uv run tools/maps.py           # section maps
uv run src/build.py            # the page
uv run tools/check.py          # headless Chrome: map, weather, links, snapshot, hourly chart
uv run tools/check.py --url https://your.host/   # same checks against the deployed site
```

## Credits

Route data © OpenStreetMap contributors (ODbL). Map tiles © OpenTopoMap (CC BY-SA). Heights from
OpenTopoData. Weather from Open-Meteo. Leaflet 1.9.4 vendored under `site/vendor/`.

## License

MIT
