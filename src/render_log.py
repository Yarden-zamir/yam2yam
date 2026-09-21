"""Render a trip log page (site/log/<user>/index.html) from log/<user>/log.yaml. Imported by build.py.

The log is the trek as it happened: an intro, then one card per day with Pictures, Log, Map and
Weather tabs. Pictures come from the user's upload folder at runtime (log.js); the text may carry
[[map:QUERY|label]] links to the map and [[photo:ID]] pictures placed inline.
"""
import json
import re
from pathlib import Path

import yaml

from render import LANG_META, esc, txt

LOG_META = {
    "en": {"tabs": ["Pictures", "Log", "Map", "Weather"], "days_h": "Days", "map_h": "Whole route", "upload_h": "Upload pictures",
           "upload_hint": "Pictures go straight into this log. The date and place come from the picture itself; captions and the day can be set afterwards in the log file.",
           "pick": "Choose pictures", "undated": "Undated pictures", "eyebrow": "Trip log", "show_all": "Show the whole route here", "show_map": "Show the map here"},
    "he": {"tabs": ["תמונות", "יומן", "מפה", "מזג אוויר"], "days_h": "הימים", "map_h": "כל המסלול", "upload_h": "העלאת תמונות",
           "upload_hint": "התמונות נכנסות ישירות ליומן הזה. התאריך והמקום נלקחים מהתמונה עצמה; כיתוב ויום אפשר לקבוע אחר כך בקובץ היומן.",
           "pick": "בחרו תמונות", "undated": "תמונות בלי תאריך", "eyebrow": "יומן מסע", "show_all": "הצג את כל המסלול כאן", "show_map": "הצג את המפה כאן"},
}
_TOKEN = re.compile(r"\[\[(map|photo|photos):([^\]|]+)(?:\|([^\]]*))?\]\]")


def logtxt(s) -> str:
    """Text with the log tokens: [[map:QUERY|label]] → map link, [[photo:ID]] → picture placed here."""
    out, pos = [], 0
    s = "" if s is None else str(s)
    for m in _TOKEN.finditer(s):
        out.append(txt(s[pos:m.start()]))
        kind, arg, label = m.group(1), m.group(2).strip(), (m.group(3) or "").strip()
        if kind == "map":
            out.append(f'<a href="?map={esc(arg)}" class="focus" data-focus="{esc(arg)}">{txt(label or arg)}</a>')
        else:
            out.append("".join(f'<span class="photoref" data-photo="{esc(i.strip())}"></span>' for i in arg.split(",")))
        pos = m.end()
    out.append(txt(s[pos:]))
    html = "".join(out)
    return re.sub(r'((?:<span class="photoref"[^>]*></span>\s*){2,})', r'<span class="photos">\1</span>', html)


_PHOTO_BLOCK = re.compile(r'(<span class="photos">.*?</span>|<span class="photoref"[^>]*></span>)', re.S)


def blocks(paragraph) -> str:
    """A paragraph with pictures becomes text paragraphs and picture blocks side by side, so a
    picture is never trapped inside the paragraph's measure and can span the whole card."""
    out = []
    for piece in _PHOTO_BLOCK.split(logtxt(paragraph)):
        if not piece.strip():
            continue
        if piece.startswith('<span class="photos">'):
            out.append('      <div class="photos">' + piece[len('<span class="photos">'):-len("</span>")] + "</div>")
        elif piece.startswith('<span class="photoref"'):
            out.append("      " + piece.replace("<span", "<div", 1).replace("</span>", "</div>", 1))
        else:
            out.append(f"      <p>{piece.strip()}</p>")
    return "\n".join(out)


def _lang(v, lang):
    return v.get(lang) if isinstance(v, dict) else v


def render_lang(lang: str, log: dict, trek: dict, plan: dict | None, prefix: str) -> str:
    L, M = LANG_META[lang], LOG_META[lang]
    h2 = lambda i, id_, title: f'<h2 id="{prefix}{id_}"><span class="k">§{i}</span>{txt(title)}</h2>'
    plan_days = {int(d["n"]): d for d in (plan or {}).get("days", [])}
    intro = _lang(log.get("intro"), lang) or []
    intro = intro if isinstance(intro, list) else [intro]
    o = [f'<div id="{lang}" lang="{lang}" dir="{L["dir"]}" class="wrap"{"" if lang == trek["languages"][0] else " hidden"}>', "<header>",
         '  <div class="topo" aria-hidden="true"></div>',
         f'  <div class="eyebrow"><span class="balise"></span>{txt(_lang(log.get("eyebrow"), lang) or M["eyebrow"])} · {esc(log["user"])}</div>',
         f'  <h1>{txt(_lang(log.get("title"), lang) or trek["name"])}</h1>']
    if intro:
        o.append(f'  <p class="lede">{logtxt(intro[0])}</p>')
        o += [f"  <p>{logtxt(p)}</p>" for p in intro[1:]]
    o += ['  <nav class="toc" aria-label="Days">' + "".join(f'<a href="#{prefix}d{int(d["n"])}">D{int(d["n"])}</a>' for d in log["days"]) + f'<a href="#{prefix}map">{M["map_h"]}</a><a href="#{prefix}upload">{M["upload_h"]}</a></nav>', "</header>", ""]
    o.append(h2(1, "days", M["days_h"]))
    for d in log["days"]:
        n = int(d["n"])
        pd = plan_days.get(n, {})
        label = _lang(d.get("label"), lang) or pd.get("label", "")
        title = _lang(d.get("title"), lang) or pd.get("title", "")
        stats = _lang(d.get("stats"), lang) or []
        text = _lang(d.get("text"), lang) or []
        text = text if isinstance(text, list) else [text]
        o += [f'<div class="stage" id="{prefix}d{n}" data-day="{n}" data-date="{d["date"]}">',
              f'  <div class="d"><a href="?map=day:{n}" data-focus="day:{n}">D{n}<small>{txt(label)}</small></a></div>', "  <div>",
              f'    <h3><a href="?map=day:{n}" class="daylink" data-focus="day:{n}">{txt(title)}</a></h3>',
              '    <div class="stats">' + "".join(f"<span>{txt(s)}</span>" for s in stats) + "</div>",
              '    <div class="tabs" role="tablist">' + "".join(
                  f'<button type="button" role="tab" data-tab="{key}" class="{"on" if key == "pics" else ""}" aria-selected="{"true" if key == "pics" else "false"}">{txt(name)}'
                  + ('<span class="badge" hidden></span>' if key == "pics" else "") + "</button>" for key, name in zip(("pics", "log", "map", "wx"), M["tabs"])) + "</div>",
              f'    <div class="pane" data-pane="pics" role="tabpanel"><div class="gallery" data-day="{n}"></div></div>',
              '    <div class="pane" data-pane="log" role="tabpanel" hidden>']
        o += [blocks(p) for p in text]
        o += ["    </div>",
              f'    <div class="pane" data-pane="map" role="tabpanel" hidden><div class="maphost empty" data-host="{n}"><button type="button" class="mapclaim">{M["show_map"]}</button></div></div>',
              f'    <div class="pane" data-pane="wx" role="tabpanel" hidden><div class="wxh" data-day="{n}"></div></div>',
              "  </div>", "</div>"]
    o += [f'<div class="undated" hidden><h3>{M["undated"]}</h3><div class="gallery" data-day="none"></div></div>']
    gpx = "/" + Path(trek["gpx"]).name
    o += ["", h2(2, "map", M["map_h"]),
          f'<div class="maphost" data-host="all"><button type="button" class="mapclaim">{M["show_all"]}</button>',
          f'<div class="mapbox" data-map="{lang}">', '  <div class="livemap" role="application" aria-label="Map"></div>',
          '  <div class="maptools"><button type="button" data-act="saveroute"></button><span class="mapstatus"></span></div>',
          '  <canvas class="profile" aria-label="Elevation profile"></canvas>', '  <p class="profstats"></p>', "</div></div>",
          f'<p><a href="{gpx}" download>{L["gpx"]}</a></p>']
    o += ["", h2(3, "upload", M["upload_h"]), f'<p>{M["upload_hint"]}</p>',
          f'<div class="upload"><label class="upbtn">{M["pick"]}<input type="file" accept="image/*,.heic,.heif" multiple hidden></label><div class="uplist"></div></div>']
    o.append("</div>")
    return "\n".join(o)


def render(log_path: Path, trek: dict, plan_path: Path | None) -> tuple[str, dict]:
    """The page body and the runtime config (window.LOG) for one user's log."""
    log = yaml.safe_load(log_path.read_text())
    plan = yaml.safe_load(plan_path.read_text()) if plan_path and plan_path.exists() else {}
    first = trek["languages"][0]
    parts = [f'<div class="langbar"><button id="langbtn" type="button">{LANG_META[first]["button"]}</button></div>',
             '<button id="backbubble" type="button" hidden></button>',
             '<div id="lightbox" hidden><button type="button" class="lbx" data-lb="close" aria-label="Close">×</button><button type="button" class="lbp" data-lb="prev" aria-label="Previous">‹</button><img alt=""><button type="button" class="lbp" data-lb="next" aria-label="Next">›</button><a class="lbdl" download aria-label="Download">⤓</a><div class="lbcap"></div><div class="lbn"></div></div>', ""]
    for lang in trek["languages"]:
        parts.append(render_lang(lang, log, trek, plan.get(lang), "" if lang == first else lang + "-"))
        parts.append("")
    cfg = {"user": log["user"], "days": {int(d["n"]): {"date": d["date"], "anchors": d.get("anchors") or []} for d in log["days"]}, "photos": log.get("photos") or {}}
    return "\n".join(parts), cfg


if __name__ == "__main__":
    import sys

    root = Path(__file__).resolve().parent.parent
    trek = json.loads((root / "trek.json").read_text())
    for p in sorted((root / "log").glob("*/log.yaml")):
        body, cfg = render(p, trek, root / "content.yaml")
        print(p, len(body) // 1024, "KB", json.dumps(cfg)[:80], file=sys.stderr)
