# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Check every link and reference in the built site: anchors point at an id on the page, local files exist,
external pages answer, map queries ([[map:…]] links, ?map=… addresses) find a waypoint or a track in the GPX,
and picture references ([[photo:ID]], the cover) exist in the log's picture index. Exit 1 when anything is broken.

Usage: uv run tools/links.py [--photos https://host/log/<user>/photos/index.json] [--no-net]
The picture index lives with the uploader, not in git: pass its address (the default is built from
trek.json "hostname" and "story"); --no-net skips it and the external pages.
"""
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlparse

import requests

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
TREK = json.loads((ROOT / "trek.json").read_text())
NS = "{http://www.topografix.com/GPX/1/1}"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 trek-site-template/1.0 link check"}
NO_NET = "--no-net" in sys.argv
photos_url = next((sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == "--photos" and i + 1 < len(sys.argv)), None)
if not photos_url and TREK.get("story") and TREK.get("hostname"):
    photos_url = f"https://{TREK['hostname']}/log/{TREK['story']}/photos/index.json"
DYNAMIC = re.compile(r"^/(auth/|log/[^/]+/(photos|orig|upload|edit|reindex|whoami)|sw\.js)")  # served by the containers, not files in site/


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.links, self.assets, self.queries, self.photos, self.specs = set(), [], [], [], [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get("id"):
            self.ids.add(a["id"])
        if tag == "a" and a.get("href"):
            self.links.append(a["href"])
        if tag in ("img", "script", "source") and a.get("src"):
            self.assets.append(a["src"])
        if tag == "link" and a.get("href") and "preconnect" not in (a.get("rel") or ""):
            self.assets.append(a["href"])
        if tag == "meta" and a.get("property") in ("og:image", "og:url") and a.get("content"):
            self.assets.append(a["content"])
        if a.get("data-focus"):
            self.queries.append(a["data-focus"])
        if a.get("data-photo"):
            self.photos.append(a["data-photo"])
        if a.get("data-go"):
            self.queries.append(a["data-go"])
        if a.get("data-links"):
            self.specs.append(a["data-links"])


def norm(s):
    return unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()


gpx = ET.parse(ROOT / TREK["gpx"]).getroot()
WPTS = [norm(w.findtext(NS + "name")) for w in gpx.findall(NS + "wpt")]
TRACKS = [norm(t.findtext(NS + "name")) for t in gpx.findall(NS + "trk")]
NIGHTS = {int(m.group(1)) for n in WPTS for m in [re.match(r"night (\d+) ", n)] if m}


def map_query_ok(q):
    """The same resolution as map.js focus(): a coordinate, a day, a waypoint by name, then a track by name."""
    if q.startswith("ll:"):
        return bool(re.match(r"^ll:-?[\d.]+,-?[\d.]+(:.*)?$", q))
    m = re.match(r"^day:(\d+)$", q)
    if m:
        return int(m.group(1)) in NIGHTS | {max(NIGHTS) + 1}
    nq = norm(q)
    return any(nq in w for w in WPTS) or any(nq in t for t in TRACKS)


def local_ok(path):
    p = unquote(urlparse(path).path)
    if not p or DYNAMIC.match(p):
        return True
    f = SITE / p.lstrip("/")
    return f.is_file() or (f / "index.html").is_file()


DEAD_SIGNS = ("page not found", "page introuvable", "n'existe pas", "n’existe pas", "not be found", "no longer available",
              "n'est plus disponible", "this domain is for sale", "buy this domain", "domain has expired", "sedoparking", "parked domain",
              "הדף לא נמצא", "העמוד לא נמצא", "404 not found", "error 404", "erreur 404", "cet article n'existe", "nothing found",
              "this page doesn't exist", "the page you requested", "sorry, we couldn't find", "aucun résultat", "site is not available")
TREK_WORDS = tuple(w.lower() for w in ["gr52", "gr 52", "gr-52", "mercantour", "merveilles"] + [TREK.get("shortName", ""), TREK.get("name", "")] if w)


def fetch(url):
    """Status, plus a look at the page: a soft 404, a parked domain, a redirect home, or a report that never mentions the trek."""
    if "google.com/maps/" in url:
        return url, "gmaps", ""
    try:
        r = requests.get(url, headers=UA, timeout=30, allow_redirects=True)
    except requests.RequestException as e:
        return url, type(e).__name__, ""
    if r.status_code in (403, 429, 503) and ("just a moment" in r.text[:3000].lower() or "cloudflare" in r.text[:5000].lower() or "captcha" in r.text[:5000].lower() or urlparse(url).netloc.endswith(("alltrails.com", "wikiloc.com"))):
        return url, "wall", f"a bot check answers {r.status_code}; open it by hand"
    if r.status_code >= 400:
        return url, r.status_code, ""
    ctype = r.headers.get("content-type", "")
    if "html" not in ctype:
        return url, r.status_code, ""  # fonts, feeds, files: the status is the answer
    body = r.text[:400000]
    low = body.lower()
    title = re.search(r"<title[^>]*>(.*?)</title>", body, re.S | re.I)
    title = re.sub(r"\s+", " ", unescape_html(title.group(1))).strip() if title else ""
    head = low[:20000]
    for sign in DEAD_SIGNS:
        if sign in title.lower() or sign in head:
            return url, "dead", f"the page says {sign!r} (title {title!r})"
    o, f = urlparse(url), urlparse(r.url)
    if len(o.path.strip("/")) > 0 and f.path.strip("/") == "" and o.query == "" and not o.path.rstrip("/").endswith("index.html"):
        return url, "dead", f"redirects to the home page {r.url}"
    if f.netloc != o.netloc and f.netloc.replace("www.", "") != o.netloc.replace("www.", ""):
        return url, "moved", f"now at {r.url} (title {title!r})"
    text = re.sub(r"<script.*?</script>|<style.*?</style>|<[^>]+>", " ", body, flags=re.S | re.I).lower()
    if len(text.split()) < 80:
        return url, "thin", f"almost no text without scripts (title {title!r})"  # an app that draws itself, or an empty shell
    if not any(w in text for w in TREK_WORDS) and o.netloc not in ("open-meteo.com", "fonts.googleapis.com", "fonts.gstatic.com"):
        return url, "off", f"never mentions the trek (title {title!r})"
    return url, r.status_code, title


def unescape_html(s):
    import html
    return html.unescape(s)


pages = sorted(p for p in SITE.rglob("*.html") if "vendor" not in p.parts)
broken, suspicious, external, seen_photo_ids, notes = [], [], {}, set(), []
for page in pages:
    P = Page()
    P.feed(page.read_text())
    rel = page.relative_to(SITE)
    for href in P.links:
        if href.startswith("#"):
            if href != "#" and href[1:] not in P.ids:
                broken.append(f"{rel}: anchor {href} has no target")
        elif href.startswith(("http://", "https://")):
            external.setdefault(href, set()).add(str(rel))
        elif href.startswith(("mailto:", "tel:", "javascript:")):
            pass
        else:
            u = urlparse(href)
            if u.path and not local_ok(href):
                broken.append(f"{rel}: link {href} is not a file in site/")
            for k, v in re.findall(r"[?&](map|focus)=([^&#]*)", href):
                if not map_query_ok(unquote(v.replace("+", " "))):
                    broken.append(f"{rel}: map link {href} matches nothing in the GPX")
    for src in P.assets:
        if src.startswith(("http://", "https://")):
            if TREK.get("hostname") and urlparse(src).netloc == TREK["hostname"]:
                if not local_ok(src):
                    broken.append(f"{rel}: {src} is not a file in site/")
            else:
                external.setdefault(src, set()).add(str(rel))
        elif src.startswith("data:"):
            pass
        elif not local_ok(src):
            broken.append(f"{rel}: asset {src} is not a file in site/")
    for q in P.queries:  # data-focus and data-go: a plain map query
        if not map_query_ok(q):
            broken.append(f"{rel}: map query {q!r} matches nothing in the GPX")
    for spec in P.specs:  # data-links: a chip that offers several targets, [{"k": kind, "q": target}, …]
        try:
            items = json.loads(unescape_html(spec))
        except ValueError:
            broken.append(f"{rel}: unreadable link chip {spec!r}")
            continue
        for it in items:
            k, v = it.get("k"), it.get("q", "")
            if k == "map":
                if not map_query_ok(v):
                    broken.append(f"{rel}: map query {v!r} matches nothing in the GPX")
            elif k == "url":
                external.setdefault(v, set()).add(str(rel))
            elif k != "gmaps":
                broken.append(f"{rel}: unknown link kind {k!r} in {spec!r}")
    seen_photo_ids |= set(P.photos)

photo_ids = None
if not NO_NET and photos_url and seen_photo_ids:
    try:
        idx = requests.get(photos_url, headers=UA, timeout=25).json()
        photo_ids = {p["id"] for p in idx}
    except Exception as e:  # noqa: BLE001
        notes.append(f"picture index {photos_url} not read ({e}); picture references not checked")
if photo_ids is not None:
    for pid in sorted(seen_photo_ids - photo_ids):
        broken.append(f"picture {pid} is referenced but not in the log's index")
    notes.append(f"{len(seen_photo_ids)} picture references, all in the index" if seen_photo_ids <= photo_ids else "")

if not NO_NET:
    with ThreadPoolExecutor(8) as ex:
        for url, status, why in ex.map(fetch, sorted(external)):
            where = ", ".join(sorted(external[url]))
            if status == "gmaps":
                continue
            if status in ("moved", "off", "wall", "thin"):
                suspicious.append(f"{where}: {url} · {why}")
            elif isinstance(status, str) or status >= 400:
                broken.append(f"{where}: {url} → {status} {why}".rstrip())
    notes.append(f"{len(external)} external addresses checked")

for n in notes:
    if n:
        print(n)
if suspicious:
    print(f"{len(suspicious)} worth a look:")
    for b in suspicious:
        print("  " + b)
print(f"{len(pages)} pages, {len(broken)} broken")
for b in broken:
    print("  " + b)
sys.exit(1 if broken else 0)
