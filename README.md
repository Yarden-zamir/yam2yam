# Sea to Sea (Yam el Yam)

The plan for a walk across the Upper Galilee, from Achziv on the Mediterranean to Ginosar on the Sea of Galilee, 10 to 13 September 2026: four days with a tent, about 72 km, 1,550 m up and 1,750 m down, with the high point on Har Meron (1,204 m).

**[yam2yam.yarden-zamir.com](https://yam2yam.yarden-zamir.com)**

The site is in English and Hebrew. It has:

- a card for each day, with the plan, the day's stretch on the map, and the weather at the night spot and the high point
- the heat and storm warnings, worked out from the forecast
- a day simulator that suggests a start time
- a position snapshot for use on the trail
- an offline mode
- the GPX for any map app

![The plan: day cards with the stats, the Plan, Map and Weather tabs, and place chips that open the map](https://raw.githubusercontent.com/Yarden-zamir/trek-site-template/main/docs/screenshots/plan-desktop.jpg)

The site is built from [trek-site-template](https://github.com/Yarden-zamir/trek-site-template). Its README explains the features, the build and the configuration.

## This repo

- `trek.json`: the trek's config: the route, the waypoints (nights, water, escapes, notes) and the places.
- `content.yaml`: the page text, in English and Hebrew.
- `research/`: the findings from OpenStreetMap, the climate on the dates, and the holiday calendar (Rosh Hashana falls on this weekend).
- `site/`: the built site. The GPX is in `site/`.
- `src/`, `site/*.js`, `tools/`, `uploader/`, `container/`, `compose.yml`: these come from the template. Change them there, then copy them here.

## Update the site

```sh
uv run src/build.py        # rebuild site/ from trek.json and content.yaml
uv run tools/links.py      # check the links and references
git push                   # main deploys with KitSHn
```

`kitshn.md` has the deploy notes.

## License

MIT for the code. The text is ours.
