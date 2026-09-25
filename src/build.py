# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml"]
# ///
"""Assemble the trek site from trek.json and src/.

Inputs: trek.json (see README), src/head.html, src/body.html, src/scripts.html, src/sw.js,
site/maps/index.json (written by tools/maps.py, optional).
Outputs: site/index.html, site/sw.js, site/manifest.webmanifest, Caddyfile.j2.
"""
import hashlib
import json
import re
import sys
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
{og}<meta name="color-scheme" content="light dark">
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
_SKIP_OPEN = ("<a ", "<a>", "<h1", "<button", "<title", "<summary", "<caption", "<h2", "<h3", '<span class="st"', '<div class="facts"', '<nav')
_SKIP_CLOSE = ("</a>", "</h1>", "</button>", "</title>", "</summary>", "</caption>", "</h2>", "</h3>", "</span>")


def link_places(html: str, anchor: str = "map") -> str:
    """Wrap place names (trek.json "places") in map chips, in text only, never inside anchors, headings or the stats chips.
    The chip's plain href (for a page without scripts) is the map section of the language it sits in: #map or #he-map."""
    if not _TERM_RE:
        return html
    out, pos, stack, prefix = [], 0, [], ""  # stack: [tag name, nesting depth] of the skipped elements we are inside
    for m in _TAG_RE.finditer(html):
        text = html[pos : m.start()]
        if not stack:
            text = _TERM_RE.sub(lambda t: f'<a href="#{prefix}{anchor}" class="lk k-map focus" data-focus="{PLACES[t.group(0)]}"><i class="ic-map"></i>{t.group(0)}</a>', text)
        out.append(text)
        tag = m.group(0)
        low = tag.lower()
        lm = re.search(r'\slang="([a-z]+)"', low)
        if lm and low.startswith("<div"):
            prefix = "" if lm.group(1) == TREK["languages"][0] else lm.group(1) + "-"
        name = re.match(r"</?\s*([a-z0-9]+)", low)
        name = name.group(1) if name else ""
        if low.startswith("</"):
            if stack and stack[-1][0] == name:
                stack[-1][1] -= 1
                if stack[-1][1] == 0:
                    stack.pop()
        elif not low.endswith("/>") and name not in ("br", "img", "input", "i", "span") or low.startswith(_SKIP_OPEN):
            if stack and stack[-1][0] == name:
                stack[-1][1] += 1
            elif low.startswith(_SKIP_OPEN):
                stack.append([name, 1])
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
        "short": TREK.get("shortName", TREK["slug"].upper()),
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


sys.path.insert(0, str(SRC))
import render as render_mod  # noqa: E402
import yaml  # noqa: E402


def log_covers() -> dict:
    """{user: cover} for every log with a `cover:`; the trip page borrows the first when trek.json sets none."""
    out = {}
    for p in sorted((ROOT / "log").glob("*/log.yaml")) if (ROOT / "log").exists() else []:
        d = yaml.safe_load(p.read_text())
        c = render_mod.cover_of(d.get("cover"), d["user"])
        if c:
            out[d["user"]] = c
    return out


COVERS = log_covers()
STORY = TREK.get("story")  # the user whose log is the front page; the plan then moves to /plan/ with an archive note
TREK["_cover"] = render_mod.cover_of(TREK.get("cover")) or next(iter(COVERS.values()), None)

if (ROOT / "content.yaml").exists():
    (SRC / "body.html").write_text(render_mod.render(ROOT / "content.yaml", TREK))


def bust(html: str) -> str:
    """Append ?v=<content hash> to local script and stylesheet URLs, so a changed file is a new URL."""
    def one(m: re.Match) -> str:
        f = SITE / m.group(2).lstrip("/")
        return f'{m.group(1)}="{m.group(2)}?v={_vhash(f)}"' if f.exists() else m.group(0)
    return re.sub(r'(src|href)="(/[^"?]+\.(?:js|css))"', one, html)


def _vhash(f: Path) -> str:
    return hashlib.sha256(f.read_bytes()).hexdigest()[:10]


def og_meta(title: str, description: str, cover: dict | None, path: str = "/") -> str:
    """Open Graph tags, so a shared link shows the title, the blurb and the cover picture. The picture is the
    uploader's 1200 x 630 crop of the cover (under 300 KB, which WhatsApp insists on), centred where the cover is."""
    q = lambda s: str(s).replace('"', "&quot;")
    o = [f'<meta property="og:title" content="{q(title)}">', f'<meta property="og:description" content="{q(description)}">', '<meta property="og:type" content="website">',
         f'<meta property="og:url" content="https://{TREK["hostname"]}{path}">']
    if cover and cover.get("src"):
        src = cover["src"]
        if cover.get("photo"):
            y = re.sub(r"[^\d]", "", str(cover.get("y", "50"))) or "50"
            src = src[: -len(".jpg")] + ".og.jpg?y=" + y if src.endswith(".jpg") else src
        url = f"https://{TREK['hostname']}{q(src)}"
        o += [f'<meta property="og:image" content="{url}">', f'<meta property="og:image:secure_url" content="{url}">',
              '<meta property="og:image:type" content="image/jpeg">', '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
              '<meta name="twitter:card" content="summary_large_image">', f'<meta name="twitter:image" content="{url}">']
    return "\n".join(o) + "\n"


body = section_maps(link_places(label_tables((SRC / "body.html").read_text()), "maps"))
head = bust((SRC / "head.html").read_text().replace("{{NAME}}", TREK["name"]))
page = (
    SHELL_HEAD.format(lang=TREK.get("languages", ["en"])[0], description=TREK["description"].replace('"', "&quot;"),
                      og=og_meta(TREK["name"], TREK["description"], TREK["_cover"], "/plan/" if STORY else "/"))
    + head
    + theme_style()
    + config_script()
    + "</head>\n<body>\n"
    + body
    + "\n"
    + bust((SRC / "scripts.html").read_text().replace("{{APP}}", '<script src="/trip.js" defer></script>'))
    + "</body>\n</html>\n"
)
if STORY:
    _NOTE = {"en": 'This is the plan as it was before we left, kept for reference. The trek as walked, with pictures and tips, is on the <a href="/">front page</a>.',
             "he": 'זו התוכנית כפי שהייתה לפני היציאה, שמורה לעיון. המסלול כפי שהלכנו, עם תמונות וטיפים, נמצא ב<a href="/">עמוד הראשי</a>.'}
    page = re.sub(r'(<div id="(en|he)"[^>]*class="wrap"[^>]*>)', lambda m: m.group(1) + f'\n<div class="archive">{_NOTE.get(m.group(2), _NOTE["en"])}</div>', page)
    page = page.replace("<head>\n", '<head>\n<meta name="robots" content="noindex, nofollow">\n', 1)
    (SITE / "plan").mkdir(exist_ok=True)
    (SITE / "plan" / "index.html").write_text(page)
    print("wrote site/plan/index.html (the plan, archived)")
else:
    (SITE / "index.html").write_text(page)

# trip logs, unlisted: site/log/<user>/ from log/<user>/log.yaml (pictures come from the upload volume at runtime)
if (ROOT / "log").exists():
    from render_log import render as render_log  # noqa: E402

    for log_yaml in sorted((ROOT / "log").glob("*/log.yaml")):
        log_body, log_cfg = render_log(log_yaml, TREK, ROOT / "content.yaml")
        log_cover = log_cfg.get("cover")
        log_page = (
            SHELL_HEAD.format(lang=TREK.get("languages", ["en"])[0], description=TREK["description"].replace('"', "&quot;"),
                              og=og_meta(TREK["name"], TREK["description"], log_cover, "/" if STORY == log_cfg["user"] else f"/log/{log_cfg['user']}/"))
            + '<meta name="robots" content="noindex, nofollow">\n'
            + head
            + theme_style()
            + config_script()
            + "<script>window.LOG=" + json.dumps(log_cfg, ensure_ascii=False) + ";</script>\n"
            + "</head>\n<body class=\"logpage\">\n"
            + link_places(log_body)
            + "\n"
            + bust((SRC / "scripts.html").read_text().replace("{{APP}}", '<script src="/vendor/zip.min.js" defer></script>\n<script src="/log.js" defer></script>'))
            + "</body>\n</html>\n"
        )
        out = SITE / "log" / log_cfg["user"]
        out.mkdir(parents=True, exist_ok=True)
        (out / "index.html").write_text(log_page)
        print(f"wrote site/log/{log_cfg['user']}/index.html ({len(log_page) // 1024} KB, unlisted)")
        if STORY == log_cfg["user"]:
            (SITE / "index.html").write_text(log_page.replace('<meta name="robots" content="noindex, nofollow">\n', "", 1))
            print("wrote site/index.html (the story is the front page)")

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
# .env for docker compose: the site host for the sign-in redirect, the editors, and the "auth" profile that runs oauth2-proxy
editors = [str(x) for x in TREK.get("editors") or []]
# the "auth" profile (oauth2-proxy) runs once trek.json says "auth": true, which needs the OAuth app params in the repo
(ROOT / ".env").write_text("# written by src/build.py from trek.json; docker compose reads it\n" + f"SITE_HOST={host}\n" + f"LOG_EDITORS={','.join(editors)}\n" + ("COMPOSE_PROFILES=auth\n" if TREK.get("auth") else ""))
(ROOT / "Caddyfile.j2").write_text(
    '{% if environment == "prod" -%}\n' + host + "\n{%- else -%}\npr.{{ environment.removeprefix(\"pr-\") }}." + host
    + "\n{%- endif %} {\n    reverse_proxy unix//{{ paths.default_socket }}\n}\n"
)

precache = ["/", "/" + Path(TREK["gpx"]).name] + [f"{u}?v={_vhash(SITE / u.lstrip('/'))}" for u in (("/log.js", "/vendor/zip.min.js") if STORY else ()) + ("/map.js", "/trip.js", "/vendor/leaflet.min.js", "/vendor/leaflet.min.css", "/vendor/leaflet-rotate.umd.min.js", "/vendor/leaflet-rotate.css")] + [
            "/vendor/images/layers.png", "/vendor/images/layers-2x.png", "/manifest.webmanifest", "/icon.svg"]
precache += sorted("/maps/" + p.name for p in (SITE / "maps").glob("*.webp")) if (SITE / "maps").exists() else []
files = sorted(p for p in SITE.rglob("*") if p.is_file() and p.name != "sw.js" and "/photos/" not in p.as_posix() and "/orig/" not in p.as_posix())
digest = hashlib.sha256()
for p in files:
    digest.update(p.relative_to(ROOT).as_posix().encode())
    digest.update(p.read_bytes())
build_id = digest.hexdigest()[:12]
sw = (SRC / "sw.js").read_text().replace("{{PRECACHE}}", json.dumps(precache)).replace("{{SLUG}}", TREK["slug"]).replace("__BUILD__", build_id)
(SITE / "sw.js").write_text(sw)
print(f"wrote site/index.html ({len(page) // 1024} KB), site/sw.js (build {build_id}), site/manifest.webmanifest, Caddyfile.j2")
