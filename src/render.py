"""Render src/body.html from content.yaml. Imported by build.py; also runnable on its own.

content.yaml holds the page text per language with no markup structure to get wrong. The renderer
emits the exact HTML the app depends on (day cards with data-day/data-date, the map block, tables with
captions, the language toggle). Inline <b>, <i>, <a> and <br> in text fields are passed through.
"""
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
LANG_META = {
    "en": {"dir": "ltr", "button": "עברית", "toc": ["Plan", "Maps", "Rules & water", "Technical", "Practical", "Links"], "gpx": "GPX for OsmAnd ↓",
           "snapshot": "Where am I", "snapshot_hint": "One position fix, no tracking: marks finished days done and fills in today's distance, ascent left and arrival estimate. Long-press to pick your position on the map instead. Tap a day title to see it on the map.",
           "maps_h": "Maps and profile", "static_maps": "Annotated section maps, for printing or offline", "profile_cap": "Elevation profile from the GPX; the nights are marked.",
           "rules_h": "Rules and water", "tech_h": "Technical options", "practical_h": "Practical", "links_h": "Links", "reports_h": "Trip reports", "official_h": "Official",
           "map_intro": "This map is drawn live from the same GPX you download for OsmAnd. Tap any line or dot for its note. The layers button toggles each track and kind of waypoint. \"Where am I\" shows your position and distance to the next night. \"Save whole route offline\" stores the map tiles; the page and GPX are stored automatically, so the site keeps working without signal."},
    "he": {"dir": "rtl", "button": "English", "toc": ["התוכנית", "מפות", "חוקים ומים", "טכני", "פרקטי", "קישורים"], "gpx": "GPX ל-OsmAnd ↓",
           "snapshot": "איפה אני", "snapshot_hint": "קריאת מיקום אחת, בלי מעקב: מסמנת ימים שהסתיימו כהושלמו וממלאת את המרחק, העלייה שנותרה והערכת ההגעה להיום. לחיצה ארוכה בוחרת את המיקום במפה במקום GPS. לחצו על כותרת יום כדי לראות אותו במפה.",
           "maps_h": "מפות ופרופיל", "static_maps": "מפות מקטעים עם סימונים, להדפסה או לאופליין", "profile_cap": "פרופיל גבהים מה-GPX; הלילות מסומנים.",
           "rules_h": "חוקים ומים", "tech_h": "אופציות טכניות", "practical_h": "פרקטי", "links_h": "קישורים", "reports_h": "דוחות טיולים", "official_h": "רשמי",
           "map_intro": "המפה הזו מצוירת ישירות מאותו קובץ GPX שמורידים ל-OsmAnd. לחצו על כל קו או נקודה כדי לראות את ההערה. כפתור השכבות מדליק ומכבה כל מסלול וכל סוג נקודה. \"איפה אני\" מציג את המיקום שלכם ואת המרחק ללילה הבא. \"שמור את כל המסלול לאופליין\" שומר את אריחי המפה; הדף וה-GPX נשמרים אוטומטית, כך שהאתר ממשיך לעבוד בלי קליטה."},
}


def esc(s) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;") if s is not None else ""


def txt(s) -> str:
    """Text fields: keep inline <b>, <i>, <a>, <br>, <span>; escape everything else."""
    s = "" if s is None else str(s)
    keep = re.compile(r"</?(b|i|a|br|span|em|strong)(\s[^>]*)?>")
    out, pos = [], 0
    for m in keep.finditer(s):
        out.append(esc(s[pos:m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(esc(s[pos:]))
    return "".join(out)


def table(t: dict) -> str:
    rows = [f"  <tr>{''.join(f'<th>{txt(c)}</th>' for c in t['columns'])}</tr>"]
    for r in t.get("rows", []):
        cells = "".join(f'<td class="n">{txt(c)}</td>' if isinstance(c, str) and re.match(r"^[\d,.\s]+(m|km|h|€|₪|%)?", c or "") and len(c) < 14 else f"<td>{txt(c)}</td>" for c in r)
        rows.append(f"  <tr>{cells}</tr>")
    return f'<div class="scroll"><table>\n  <caption>{txt(t["caption"])}</caption>\n' + "\n".join(rows) + "\n</table></div>"


def ul(items) -> str:
    return "<ul>" + "".join(f"<li>{txt(i)}</li>" for i in (items or [])) + "</ul>"


def render_lang(lang: str, c: dict, trek: dict, prefix: str) -> str:
    L = LANG_META[lang]
    h2 = lambda i, id_, title: f'<h2 id="{prefix}{id_}"><span class="k">§{i}</span>{txt(title)}</h2>'
    gpx = "/" + Path(trek["gpx"]).name
    o = [f'<div id="{lang}" lang="{lang}" dir="{L["dir"]}" class="wrap"{"" if lang == trek["languages"][0] else " hidden"}>', "<header>",
         '  <div class="topo" aria-hidden="true"></div>',
         f'  <div class="eyebrow"><span class="balise"></span>{txt(c["eyebrow"])}</div>',
         f'  <h1>{txt(c["title"])}</h1>', f'  <p class="lede">{txt(c["lede"])}</p>', '  <div class="facts">']
    for f in c.get("facts", [])[:6]:
        o.append(f'    <div><b>{txt(f["value"])}</b><span>{txt(f["label"])}</span></div>')
    ids = ["plan", "maps", "rules", "tech", "practical", "links"]
    o += ["  </div>", '  <nav class="toc" aria-label="Sections">' + "".join(f'<a href="#{prefix}{i}">{txt(t)}</a>' for i, t in zip(ids, L["toc"])) + f'<a href="{gpx}" download>{L["gpx"]}</a></nav>', "</header>", ""]
    # plan
    o += [h2(1, "plan", c.get("plan_title") or ("The plan" if lang == "en" else "התוכנית")), f"<p>{txt(c.get('plan_intro', ''))}</p>",
          f'<p class="planbar"><button type="button" data-act="snapshot">{L["snapshot"]}</button> <span class="snapstatus">{txt(c.get("snapshot_hint") or L["snapshot_hint"])}</span></p>']
    for d in c["days"]:
        n = int(d["n"])
        hours = f' data-hours="{d["hours"]}"' if d.get("hours") else ""
        o += [f'<div class="stage" data-day="{n}" data-date="{d["date"]}"{hours}>',
              f'  <div class="d"><a href="#map" data-focus="day:{n}">D{n}<small>{txt(d["label"])}</small></a></div>', "  <div>",
              f'    <h3><a href="#map" class="daylink" data-focus="day:{n}">{txt(d["title"])}</a></h3>',
              '    <div class="stats">' + "".join(f"<span>{txt(s)}</span>" for s in d.get("stats", [])) + "</div>",
              '    <div class="wx" aria-live="polite"></div>']
        for p in (d.get("text") if isinstance(d.get("text"), list) else [d.get("text", "")]):
            o.append(f"    <p>{txt(p)}</p>")
        o += ["  </div>", "</div>"]
    if c.get("plan_note"):
        o.append(f'<div class="note"><p>{txt(c["plan_note"])}</p></div>')
    # maps
    o += ["", h2(2, "maps", L["maps_h"]), f"<p>{txt(c.get('maps_intro') or L['map_intro'])}</p>",
          f'<div class="mapbox" data-map="{lang}">', '  <div class="livemap" role="application" aria-label="Map"></div>',
          '  <div class="maptools"><button type="button" data-act="locate"></button><button type="button" data-act="saveroute"></button><span class="mapstatus"></span></div>',
          '  <canvas class="profile" aria-label="Elevation profile"></canvas>', '  <p class="profstats"></p>', "</div>"]
    sm = c.get("section_maps") or [{"key": s["key"], "caption": s.get("title", s["key"])} for s in trek.get("sectionMaps", [])]
    if sm:
        o += ['<details class="staticmaps">', f'  <summary>{L["static_maps"]}</summary>']
        o += [f'  <figure>{{{{MAP:{s["key"]}|{esc(s.get("caption", s["key"]))}}}}}<figcaption>{txt(s.get("caption", ""))}</figcaption></figure>' for s in sm]
        o.append("</details>")
    # rules
    o += ["", h2(3, "rules", c.get("rules_title") or L["rules_h"])]
    if c.get("rules"):
        o.append('<div class="note rule">' + "".join(f"<p><b>{txt(r['title'])}</b> {txt(r['text'])}</p>" for r in c["rules"]) + "</div>")
    if c.get("refuges"):
        o.append(table(c["refuges"]))
    if c.get("water_note"):
        o.append(f'<div class="note warn"><p>{txt(c["water_note"])}</p></div>')
    # technical
    o += ["", h2(4, "tech", c.get("tech_title") or L["tech_h"])]
    if c.get("tech_intro"):
        o.append(f"<p>{txt(c['tech_intro'])}</p>")
    if c.get("tech_list"):
        o.append(ul(c["tech_list"]))
    if c.get("tech"):
        o.append(table(c["tech"]))
    # practical
    o += ["", h2(5, "practical", L["practical_h"]), '<div class="two">', "  <div>"]
    for blk in c.get("practical", []):
        o.append(f"    <h3>{txt(blk['title'])}</h3>{ul(blk.get('items'))}")
    o += ["  </div>", "  <div>"]
    for blk in c.get("practical_right", []):
        o.append(f"    <h3>{txt(blk['title'])}</h3>{ul(blk.get('items'))}")
    o += ["  </div>", "</div>"]
    for ex in c.get("extra", []):
        o.append(f'<h3 style="margin-top:36px">{txt(ex["title"])}</h3>')
        if ex.get("intro"):
            o.append(f"<p>{txt(ex['intro'])}</p>")
        if ex.get("table"):
            o.append(table(ex["table"]))
        for p in ex.get("notes", []):
            o.append(f"<p>{txt(p)}</p>")
    # links
    o += ["", h2(6, "links", L["links_h"])]
    lk = c.get("links") or {}
    for key, title in (("reports", lk.get("reports_title") or L["reports_h"]), ("official", lk.get("official_title") or L["official_h"])):
        items = lk.get(key) or []
        if items:
            o.append(f"<h3>{title}</h3>" + ul(items))
    o.append("</div>")
    return "\n".join(o)


def render(content_path: Path, trek: dict) -> str:
    c = yaml.safe_load(content_path.read_text())
    first = trek["languages"][0]
    parts = [f'<div class="langbar"><button id="langbtn" type="button">{LANG_META[first]["button"]}</button></div>', ""]
    for lang in trek["languages"]:
        if lang not in c:
            raise SystemExit(f"content.yaml has no '{lang}' block")
        parts.append(render_lang(lang, c[lang], trek, "" if lang == first else lang + "-"))
        parts.append("")
    return "\n".join(parts)


if __name__ == "__main__":
    trek = json.loads((ROOT / "trek.json").read_text())
    html = render(ROOT / "content.yaml", trek)
    (ROOT / "src" / "body.html").write_text(html)
    print(f"rendered src/body.html from content.yaml ({len(html) // 1024} KB)", file=sys.stderr)
