# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml"]
# ///
"""Migrate a hand-written src/body.html (template skeleton structure) into content.yaml.

Best effort for pages that follow the skeleton: header, day cards, rules note, tables, practical
lists, extra sections, links. Text keeps its inline markup. Review the result; then delete
src/body.html (the build regenerates it from content.yaml).
"""
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
TREK = json.loads((ROOT / "trek.json").read_text())
html = (ROOT / "src" / "body.html").read_text()


def strip_focus(s: str) -> str:
    """Remove build-generated place links (they are re-added at build time) and day links."""
    s = re.sub(r'<a href="#map" class="focus" data-focus="[^"]*">(.*?)</a>', r"\1", s)
    s = re.sub(r'<a href="#map" class="daylink" data-focus="[^"]*">(.*?)</a>', r"\1", s)
    return s.strip()


def inner(tag_re: str, s: str, flags=re.S):
    m = re.search(tag_re, s, flags)
    return strip_focus(m.group(1)) if m else None


def table(t: str) -> dict:
    cap = inner(r"<caption>(.*?)</caption>", t) or ""
    rows = re.findall(r"<tr>(.*?)</tr>", t, re.S)
    cols = [strip_focus(c) for c in re.findall(r"<th>(.*?)</th>", rows[0], re.S)]
    data = [[strip_focus(re.sub(r"^<span>|</span>$", "", c)) for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)] for r in rows[1:]]
    return {"caption": cap, "columns": cols, "rows": data}


def ul(s: str) -> list:
    return [strip_focus(x) for x in re.findall(r"<li>(.*?)</li>", s, re.S)]


out = {}
for m in re.finditer(r'<div id="(\w+)" lang="(\w+)"[^>]*>(.*?)(?=<div id="\w+" lang=|\Z)', html, re.S):
    lang, body = m.group(2), m.group(3)
    pfx = "" if lang == TREK["languages"][0] else lang + "-"
    c = {}
    c["eyebrow"] = inner(r'<div class="eyebrow"><span class="balise"></span>(.*?)</div>', body)
    c["title"] = inner(r"<h1>(.*?)</h1>", body)
    c["lede"] = inner(r'<p class="lede">(.*?)</p>', body)
    c["facts"] = [{"value": strip_focus(v), "label": strip_focus(l)} for v, l in re.findall(r"<div><b>(.*?)</b><span>(.*?)</span></div>", body, re.S)]

    def section(id_):
        mm = re.search(rf'<h2 id="{pfx}{id_}">.*?</h2>(.*?)(?=<h2 id=|\Z)', body, re.S)
        return mm.group(1) if mm else ""

    plan = section("plan")
    c["plan_title"] = inner(rf'<h2 id="{pfx}plan"><span class="k">§1</span>(.*?)</h2>', body)
    c["plan_intro"] = inner(r"^\s*<p>(.*?)</p>", plan)
    hint = inner(r'<span class="snapstatus">(.*?)</span>', plan)
    if hint:
        c["snapshot_hint"] = hint
    days = []
    for d in re.finditer(r'<div class="stage" data-day="(\d+)" data-date="([^"]+)">(.*?)\n</div>', plan, re.S):
        blk = d.group(3)
        days.append({"n": int(d.group(1)), "date": d.group(2), "label": inner(r"<small>(.*?)</small>", blk),
                     "title": inner(r"<h3>(.*?)</h3>", blk), "stats": [strip_focus(x) for x in re.findall(r"<span>(.*?)</span>", inner(r'<div class="stats">(.*?)</div>', blk) or "", re.S)],
                     "text": [strip_focus(p) for p in re.findall(r"<p>(.*?)</p>", blk, re.S)]})
    for d in days:  # planned hours from any stats chip: "7–8 h", "4.5 h official, plan 5–6", "8–9 שעות"
        got = None
        for s in d["stats"]:
            p = re.search(r"plan\s*(\d+(?:\.\d+)?)(?:[–-](\d+(?:\.\d+)?))?", s)
            h = re.search(r"(\d+(?:\.\d+)?)(?:[–-](\d+(?:\.\d+)?))?\s*(?:h\b|שעות|שע')", s)
            if p:
                got = float(p.group(2) or p.group(1))
            elif h and got is None:
                got = float(h.group(2) or h.group(1))
        if got:
            d["hours"] = int(got) if got == int(got) else got
    c["days"] = days
    note = inner(r'<div class="note"><p>(.*?)</p></div>', plan)
    if note:
        c["plan_note"] = note
    maps = section("maps")
    mi = inner(r"^\s*<p>(.*?)</p>", maps)
    if mi:
        c["maps_intro"] = mi
    c["section_maps"] = [{"key": k, "caption": strip_focus(cap)} for k, cap in re.findall(r"<figure>\{\{MAP:([a-z0-9_-]+)\|[^}]*\}\}<figcaption>(.*?)</figcaption>", maps, re.S)]
    rules = section("rules")
    c["rules_title"] = inner(rf'<h2 id="{pfx}rules"><span class="k">§3</span>(.*?)</h2>', body)
    rn = inner(r'<div class="note rule">(.*?)</div>', rules)
    if rn:
        c["rules"] = [{"title": strip_focus(t), "text": strip_focus(x)} for t, x in re.findall(r"<p><b>(.*?)</b>\s*(.*?)</p>", rn, re.S)]
    tabs = re.findall(r"<table>.*?</table>", rules, re.S)
    if tabs:
        c["refuges"] = table(tabs[0])
    wn = inner(r'<div class="note warn"><p>(.*?)</p></div>', rules)
    if wn:
        c["water_note"] = wn
    tech = section("tech")
    c["tech_title"] = inner(rf'<h2 id="{pfx}tech"><span class="k">§4</span>(.*?)</h2>', body)
    ti = inner(r"^\s*<p>(.*?)</p>", tech)
    if ti:
        c["tech_intro"] = ti
    tl = re.search(r"<ul>(.*?)</ul>", tech, re.S)
    if tl:
        c["tech_list"] = ul(tl.group(1))
    tabs = re.findall(r"<table>.*?</table>", tech, re.S)
    if tabs:
        c["tech"] = table(tabs[0])
    prac = section("practical")
    cols = re.findall(r"<div>\s*((?:<h3>.*?</h3>\s*<ul>.*?</ul>\s*)+)</div>", prac, re.S)
    for key, col in zip(("practical", "practical_right"), cols):
        c[key] = [{"title": strip_focus(h), "items": ul(u)} for h, u in re.findall(r"<h3>(.*?)</h3>\s*<ul>(.*?)</ul>", col, re.S)]
    extras = []
    for ex in re.finditer(r'<h3 style="margin-top:36px">(.*?)</h3>(.*?)(?=<h3 style="margin-top:36px">|\Z)', prac, re.S):
        blk = ex.group(2)
        e = {"title": strip_focus(ex.group(1))}
        ps = re.findall(r"<p>(.*?)</p>", blk, re.S)
        tabm = re.search(r"<table>.*?</table>", blk, re.S)
        if ps:
            e["intro"] = strip_focus(ps[0])
        if tabm:
            e["table"] = table(tabm.group(0))
        if len(ps) > 1:
            e["notes"] = [strip_focus(p) for p in ps[1:]]
        extras.append(e)
    if extras:
        c["extra"] = extras
    links = section("links")
    uls = re.findall(r"<h3>(.*?)</h3>\s*<ul>(.*?)</ul>", links, re.S)
    c["links"] = {}
    for i, (h, u) in enumerate(uls[:2]):
        key = "reports" if i == 0 else "official"
        c["links"][key] = ul(u)
        c["links"][key + "_title"] = strip_focus(h)
    out[lang] = c

(ROOT / "content.yaml").write_text(yaml.safe_dump(out, allow_unicode=True, sort_keys=False, width=1000))
print(f"wrote content.yaml: " + ", ".join(f"{k}: {len(v['days'])} days" for k, v in out.items()), file=sys.stderr)
