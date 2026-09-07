# /// script
# requires-python = ">=3.11"
# ///
"""Assemble the trek site from trek.json and src/.

Inputs: trek.json (see README), src/head.html, src/body.html, src/scripts.html, src/sw.js,
site/maps/index.json (written by tools/maps.py, optional).
Outputs: site/index.html, site/sw.js, site/manifest.webmanifest, Caddyfile.j2.
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
SITE = ROOT / "site"
TREK = json.loads((ROOT / "trek.json").read_text())

SHELL_HEAD = """<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="{description}">
<meta name="color-scheme" content="light dark">
<style>body{{margin:0;font-size:14px;font-family:system-ui,sans-serif}}img{{max-width:100%;height:auto}}[hidden]{{display:none!important}}</style>
"""


def label_tables(html: str) -> str:
    """Add data-label to every td and wrap its content, so tables stack as cards on phones."""

    def one(table: re.Match) -> str:
        t = table.group(0)
        rows = re.findall(r"<tr>.*?</tr>", t, flags=re.S)
        heads = [re.sub(r"<[^>]+>", "", h).strip() for h in re.findall(r"<th>(.*?)</th>", rows[0], flags=re.S)]
        out = t
        for row in rows[1:]:
            i = [0]

            def td(_m: re.Match) -> str:
                lab = heads[i[0]] if i[0] < len(heads) else ""
                i[0] += 1
                return f'<td data-label="{lab}"{_m.group(1)}>'

            out = out.replace(row, re.sub(r"<td([^>]*)>", td, row), 1)
        return out

    html = re.sub(r"<table>.*?</table>", one, html, flags=re.S)

    def mark_long(_m: re.Match) -> str:
        text = re.sub(r"<[^>]+>", "", _m.group(2))
        long_attr = " data-long" if len(text) > 48 else ""
        return f"<td{_m.group(1)}{long_attr}><span>{_m.group(2)}</span></td>"

    return re.sub(r"<td([^>]*)>(.*?)</td>", mark_long, html, flags=re.S)


PLACES: dict[str, str] = TREK.get("places", {})
_TERM_RE = re.compile("|".join(re.escape(t) for t in sorted(PLACES, key=len, reverse=True))) if PLACES else None
_TAG_RE = re.compile(r"<[^>]+>")
_SKIP_OPEN = ("<a ", "<a>", "<h1", "<button", "<title", "<summary", "<caption", "<h2", "<h3")
_SKIP_CLOSE = ("</a>", "</h1>", "</button>", "</title>", "</summary>", "</caption>", "</h2>", "</h3>")


def link_places(html: str) -> str:
    """Wrap place names (trek.json "places") in map links, in text only, never inside anchors or headings."""
    if not _TERM_RE:
        return html
    out, pos, skip = [], 0, 0
    for m in _TAG_RE.finditer(html):
        text = html[pos : m.start()]
        if skip == 0:
            text = _TERM_RE.sub(lambda t: f'<a href="#map" class="focus" data-focus="{PLACES[t.group(0)]}">{t.group(0)}</a>', text)
        out.append(text)
        tag = m.group(0)
        low = tag.lower()
        if low.startswith(_SKIP_OPEN):
            skip += 1
        elif low.startswith(_SKIP_CLOSE):
            skip = max(0, skip - 1)
        out.append(tag)
        pos = m.end()
    out.append(html[pos:])
    return "".join(out)


def section_maps(html: str) -> str:
    """Replace {{MAP:key}} with an <img> for site/maps/<key>.webp using sizes from site/maps/index.json."""
    index_path = SITE / "maps" / "index.json"
    sizes = json.loads(index_path.read_text()) if index_path.exists() else {}

    def img(m: re.Match) -> str:
        key, alt = m.group(1), m.group(2) or key
        s = sizes.get(key)
        if not s:
            raise SystemExit(f"section map '{key}' not rendered: run tools/maps.py")
        return f'<img class="map" src="/maps/{key}.webp" width="{s["w"]}" height="{s["h"]}" loading="lazy" decoding="async" alt="{alt}">'

    return re.sub(r"\{\{MAP:([a-z0-9_-]+)(?:\|([^}]*))?\}\}", img, html)


def _hex(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def _mix(c: str, towards: tuple[int, int, int], k: float) -> str:
    r, g, bl = _hex(c)
    return "#%02X%02X%02X" % tuple(round(v + (t - v) * k) for v, t in zip((r, g, bl), towards))


def theme_style() -> str:
    """trek.json "accent" (the trail's marking colour) recolours the blaze, day markers, warnings and route."""
    accent = TREK.get("accent")
    if not accent:
        return ""
    light_soft, dark_soft, dark_accent = _mix(accent, (255, 255, 255), .84), _mix(accent, (22, 27, 27), .72), _mix(accent, (255, 255, 255), .22)
    return (f"<style>:root{{--mark:{accent};--mark-soft:{light_soft}}}"
            f"@media (prefers-color-scheme: dark){{:root:not([data-theme=\"light\"]){{--mark:{dark_accent};--mark-soft:{dark_soft}}}}}"
            f":root[data-theme=\"dark\"]{{--mark:{dark_accent};--mark-soft:{dark_soft}}}</style>\n")


def config_script() -> str:
    cfg = {
        "slug": TREK["slug"],
        "gpx": "/" + Path(TREK["gpx"]).name,
        "timezone": TREK.get("timezone", "auto"),
        "plannedStart": TREK.get("plannedStart", 8),
        "tentWindow": TREK.get("tentWindow"),
        "strings": TREK.get("strings", {}),
        "weatherModel": TREK.get("weatherModel"),
        "weatherModelLabel": TREK.get("weatherModelLabel"),
        "treeline": TREK.get("treeline"),
        "heatLimit": TREK.get("heatLimit"),
        "exposed": TREK.get("exposed", []),
        "accent": TREK.get("accent"),
        "elevation": {"eudem25m": "EU-DEM 25 m", "srtm30m": "SRTM 30 m", "aster30m": "ASTER 30 m"}.get(TREK.get("elevationDataset", "srtm30m"), TREK.get("elevationDataset")),
    }
    return "<script>window.TREK=" + json.dumps(cfg, ensure_ascii=False) + ";</script>\n"


body = section_maps(link_places(label_tables((SRC / "body.html").read_text())))
head = (SRC / "head.html").read_text().replace("{{NAME}}", TREK["name"])
page = (
    SHELL_HEAD.format(lang=TREK.get("languages", ["en"])[0], description=TREK["description"].replace('"', "&quot;"))
    + head
    + theme_style()
    + config_script()
    + "</head>\n<body>\n"
    + body
    + "\n"
    + (SRC / "scripts.html").read_text()
    + "</body>\n</html>\n"
)
(SITE / "index.html").write_text(page)

# favicon: the trail's blaze in the accent colour (a two-band mark, as on the trail signs)
_accent = TREK.get("accent", "#C8322B")
(SITE / "icon.svg").write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#F0F1EE"/>'
    f'<rect x="12" y="20" width="40" height="12" fill="{_accent}"/><rect x="12" y="32" width="40" height="12" fill="#FFFFFF" stroke="#CCD3D0"/></svg>\n'
)

manifest = {
    "name": TREK["name"],
    "short_name": TREK.get("shortName", TREK["slug"].upper()),
    "start_url": "/",
    "display": "standalone",
    "background_color": "#F0F1EE",
    "theme_color": TREK.get("accent", "#C8322B"),
    "icons": [{"src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable"}],
}
(SITE / "manifest.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")

host = TREK["hostname"]
(ROOT / "Caddyfile.j2").write_text(
    '{% if environment == "prod" -%}\n' + host + "\n{%- else -%}\npr.{{ environment.removeprefix(\"pr-\") }}." + host
    + "\n{%- endif %} {\n    reverse_proxy unix//{{ paths.default_socket }}\n}\n"
)

precache = ["/", "/" + Path(TREK["gpx"]).name, "/map.js", "/vendor/leaflet.min.js", "/vendor/leaflet.min.css",
            "/vendor/images/layers.png", "/vendor/images/layers-2x.png", "/manifest.webmanifest", "/icon.svg"]
precache += sorted("/maps/" + p.name for p in (SITE / "maps").glob("*.webp")) if (SITE / "maps").exists() else []
files = sorted(p for p in SITE.rglob("*") if p.is_file() and p.name != "sw.js")
digest = hashlib.sha256()
for p in files:
    digest.update(p.relative_to(ROOT).as_posix().encode())
    digest.update(p.read_bytes())
build_id = digest.hexdigest()[:12]
sw = (SRC / "sw.js").read_text().replace("{{PRECACHE}}", json.dumps(precache)).replace("{{SLUG}}", TREK["slug"]).replace("__BUILD__", build_id)
(SITE / "sw.js").write_text(sw)
print(f"wrote site/index.html ({len(page) // 1024} KB), site/sw.js (build {build_id}), site/manifest.webmanifest, Caddyfile.j2")
