# /// script
# requires-python = ">=3.11"
# ///
"""Headless-Chrome checks of the built site: map tiles and route drawn, waypoint icons, rotation, a day's
Map tab, weather filled, place links, day links, a simulated position snapshot, and the hourly chart.
Exit 1 on any failure.

Usage: uv run tools/check.py [--url https://host/]   (default: serves ./site on 127.0.0.1:8765)
Chrome headless cannot lay out narrower than 500 px, so phone layouts are checked at 500 px.
"""
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TREK = json.loads((ROOT / "trek.json").read_text()) if (ROOT / "trek.json").exists() else {}  # not needed for --url runs
CHROME = next((c for c in ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", shutil.which("google-chrome"), shutil.which("chromium"), shutil.which("chrome")] if c and os.path.exists(c)), None)
if not CHROME:
    sys.exit("no Chrome found for headless checks")

url = None
for i, a in enumerate(sys.argv):
    if a == "--url":
        url = sys.argv[i + 1]
server = None
if not url:
    os.chdir(ROOT / "site")
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):  # keep the check output readable
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 8765), Quiet)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = "http://127.0.0.1:8765/"

# with a story on the front page, the plan (and its map, weather and snapshot probe) lives at /plan/
probe_url = url.rstrip("/") + "/plan/" if TREK.get("story") else url

# Instrumented copy: log errors, open day 1's Map tab, rotate, simulate a snapshot at NIGHT 2, open one
# hourly chart in its Weather tab, report in <title>.
tmp = Path(tempfile.mkdtemp(prefix="trek-check-"))
html = subprocess.run(["curl", "-s", probe_url], capture_output=True, text=True).stdout
if "<head>" not in html:
    sys.exit("check: could not fetch " + probe_url)
probe = """<script>window.__log=[];window.addEventListener('error',function(e){window.__log.push('ERR '+e.message+' @'+e.filename+':'+e.lineno)});
window.addEventListener('unhandledrejection',function(e){window.__log.push('REJ '+(e.reason&&e.reason.message))});
var __t0=Date.now(); (function waitWx(){ if(Date.now()-__t0<30000 && !document.querySelector('.wx .wxrow') && !document.querySelector('.wx .wxmeta')) return setTimeout(waitWx,500); setTimeout(function(){try{
  var tiles=document.querySelectorAll('.leaflet-tile').length, paths=document.querySelectorAll('path.leaflet-interactive').length, icons=document.querySelectorAll('.wpico').length;
  var wx=document.querySelectorAll('.wx .wxrow').length, wxlinks=document.querySelectorAll('.wx a.focus').length, daylinks=document.querySelectorAll('a.daylink').length;
  var wxcards=document.querySelectorAll('.wx').length, wxrange=document.querySelectorAll('.wx [data-wx="range"],.wx [data-wx="past"]').length;
  if(!window.gr52Data){document.title=JSON.stringify({exc:'GPX not loaded',log:window.__log});return;}
  var vis=document.querySelector('.wrap[lang]:not([hidden])'), stats=(vis.querySelector('.profstats')||{}).textContent||'';
  var app=window.gr52Map.visibleApp(), rot=!!(app&&app.map.setBearing); if(rot){app.map.setBearing(45); rot=app.map.getBearing()===45;}
  var t1=vis.querySelector('.stage[data-day="1"] [data-tab="map"]'); if(t1) t1.click();
  setTimeout(function(){
    var daymap=!!vis.querySelector('.stage[data-day="1"] .maphost .livemap'), daystats=(vis.querySelector('.profstats')||{}).textContent||'';
    var dayfab=!!document.getElementById('locfab');
    var n2=null; (window.gr52Data.data.wpts).forEach(function(w){ if(!n2 && /^NIGHT 2 /.test(w.name)) n2=w; });
    if(n2) window.gr52Snapshot({coords:{latitude:n2.lat,longitude:n2.lon,accuracy:20}});
    var st=vis.querySelector('.stage:not(.done) [data-wx="hourly"]'); st=st?st.closest('.stage'):vis.querySelector('.stage:not(.done)'); var tw=st&&st.querySelector('[data-tab="wx"]'); if(tw) tw.click();
    var cur=st&&st.querySelector('[data-wx="hourly"]'); if(cur) cur.click();
    setTimeout(function(){
      var done=[].map.call(vis.querySelectorAll('.stage.done'),function(c){return c.getAttribute('data-day')}).join(',');
      var snap=(vis.querySelector('.snapbox')||{}).textContent||'';
      var cv=st&&st.querySelector('.wxhour canvas'); var sl=st&&st.querySelector('.wxhour input[type=range]'); var slider='', badge=st?((st.querySelector('[data-tab="wx"] .badge')||{}).textContent||''):'';
      if(sl){ sl.value=6.5; sl.dispatchEvent(new Event('input')); slider=(st.querySelector('.wxhour output')||{}).textContent+' | events: '+((st.querySelector('.wxevents')||{}).textContent||'').slice(0,160)+' | rec: '+((st.querySelector('.wxrec')||{}).textContent||''); }
      var mehost=(app&&app.hostEl().getAttribute('data-host'))||'', toast=(document.getElementById('loctoast')||{}).textContent||'';
      document.title=JSON.stringify({tiles:tiles,paths:paths,icons:icons,rot:rot,daymap:daymap,daystats:daystats,fab:dayfab,mehost:mehost,badge:badge,toast:toast.slice(0,120),wx:wx,wxlinks:wxlinks,wxcards:wxcards,wxrange:wxrange,daylinks:daylinks,done:done,snap:snap.slice(0,160),canvas:cv?cv.width:0,slider:slider,stats:stats,log:window.__log});
    },900);
  },900);
}catch(e){document.title=JSON.stringify({exc:e.message,log:window.__log})}},6000); })();</script>"""
page = html.replace("<head>", "<head>" + probe, 1)
base = url.rstrip("/")
# absolute-path assets must resolve against the checked site, not the temp file
page = re.sub(r'(src|href)="/(?!/)', lambda m: f'{m.group(1)}="{base}/', page)
page = re.sub(r'"gpx":\s*"/', f'"gpx": "{base}/', page)
page = page.replace("register('/sw.js')", "register('" + base + "/sw.js')")
(tmp / "index.html").write_text(page)
profile = tmp / "profile"
proc = subprocess.Popen([CHROME, "--headless", "--disable-gpu", "--no-sandbox", f"--user-data-dir={profile}", "--virtual-time-budget=70000",
                         "--disable-web-security", "--allow-file-access-from-files",  # the probe page is a temp file fetching the checked site
                         "--window-size=500,1400", "--dump-dom", f"file://{tmp}/index.html"], stdout=open(tmp / "dom.html", "w"), stderr=subprocess.DEVNULL)
for _ in range(90):
    if proc.poll() is not None:
        break
    time.sleep(1)
if proc.poll() is None:
    proc.kill()
dom = (tmp / "dom.html").read_text(errors="replace")
m = re.search(r"<title>(\{.*?\})</title>", dom, re.S)
if not m:
    sys.exit("check: no result title in the rendered DOM (page did not finish); DOM at " + str(tmp / "dom.html"))
fails = []
if TREK.get("story"):  # the story page: the days with their tabs, the sections and the page config
    story = subprocess.run(["curl", "-s", url], capture_output=True, text=True).stdout
    days = story.count('<div class="stage"'), story.count('<div class="pane" data-pane="tips"'), story.count('<div class="secblock" data-section="')
    if "window.LOG=" not in story or days[0] < 2 or days[1] != days[0] or days[2] < 4:
        fails.append(f"story page: LOG config {'present' if 'window.LOG=' in story else 'missing'}, stages {days[0]}, tips panes {days[1]}, sections {days[2]}")
    if '<meta name="robots" content="noindex' in story:
        fails.append("story page is marked noindex")
res = json.loads(m.group(1).replace("&quot;", '"').replace("&amp;", "&"))
# content completeness: skeleton placeholders that were never replaced
placeholders = [p for p in ("START → END", "NNN", "N–N h", "…", "YYYY-MM-DD", "TRAIL · REGION", "Who, when, where") if p in html]
if placeholders:
    fails.append("skeleton placeholders still in the page: " + ", ".join(placeholders))
if res.get("exc"):
    fails.append("probe exception: " + res["exc"])
log = [x for x in res.get("log", []) if "ServiceWorker" not in x]  # the probe runs from a file URL, where SW registration is refused
if log:
    fails.append("console errors: " + " | ".join(log))
if res.get("tiles", 0) < 4:
    fails.append(f"map tiles drawn: {res.get('tiles')}")
if res.get("paths", 0) < 1 or res.get("paths", 0) + res.get("icons", 0) < 5:
    fails.append(f"route/marker paths drawn: {res.get('paths')}, icons: {res.get('icons')}")
if res.get("icons", 0) < 1:
    fails.append("no waypoint icons drawn (osmand:icon in the GPX, ICONS in map.js)")
if not res.get("rot"):
    fails.append("map rotation not working (vendor/leaflet-rotate.umd.min.js loaded after Leaflet?)")
if not res.get("daymap"):
    fails.append("day 1 Map tab did not take the map")
elif res.get("daystats") == res.get("stats"):
    fails.append("day map shows the whole-route profile stats, not the day's")
if not res.get("fab"):
    fails.append("no position button (#locfab)")
if res.get("mehost") != "2":
    fails.append(f"snapshot at NIGHT 2 did not open day 2's map (map is in host {res.get('mehost')!r})")
# Open-Meteo forecasts 16 days ahead: before that window every card shows the "not yet available" note,
# so the weather rows, place links and hourly chart cannot be checked until the trek is within 16 days.
beyond_horizon = res.get("wx", 0) == 0 and res.get("wxcards", 0) > 0 and res.get("wxrange", 0) == res.get("wxcards", 0)
if beyond_horizon:
    print("weather: every day is past or beyond the 16-day forecast horizon; the cards say so")
elif res.get("wx", 0) < 1:
    fails.append("no weather rows rendered (check network, dates within 16 days, trek.json timezone)")
elif res.get("wxlinks", 0) < 1:
    fails.append("weather cards have no place links")
if res.get("daylinks", 0) < 1:
    fails.append("no day-title links")
if "1" not in res.get("done", ""):
    fails.append(f"snapshot did not mark day 1 done (done={res.get('done')!r}, snap={res.get('snap')!r})")
if res.get("canvas", 0) >= 100 and not res.get("slider"):
    fails.append("start-time slider did not update the day simulation")
if res.get("canvas", 0) < 100 and not beyond_horizon:
    fails.append("hourly chart canvas not drawn")
shots = ROOT / "checks"
shots.mkdir(exist_ok=True)
# one day card on a phone: its Map tab (the map moves into the card), then its Weather tab with the hourly chart
shot_probe = """<script>var __s0=Date.now();(function w(){ if(!window.gr52Data || (!document.querySelector('.stage[data-day="1"] [data-wx="hourly"]') && Date.now()-__s0<12000)) return setTimeout(w,300);
  var vis=document.querySelector('.wrap[lang]:not([hidden])'), hb=vis.querySelector('.stage [data-wx="hourly"]');
  var c=('TAB'==='wx'&&hb)?hb.closest('.stage'):(vis.querySelector('.stage[data-day="2"]')||vis.querySelector('.stage[data-day="1"]'));
  vis.querySelectorAll('header,h2,h3,ul,.note,.planbar,.scroll,.two,details,.langbar,.stage,.maphost[data-host="all"],p').forEach(function(e){ if(e!==c && !c.contains(e)) e.style.display='none'; });
  document.querySelectorAll('.wrap[lang][hidden]').forEach(function(e){e.style.display='none'});
  c.querySelector('[data-tab="TAB"]').click(); var h=c.querySelector('[data-wx="hourly"]'); if('TAB'==='wx'&&h) h.click();
})();</script>"""
if server:  # local mode only: serve the shot page from the site folder so it loads like the real page
    shot_file = ROOT / "site" / "__shot.html"
    try:
        for name, size, tab in (("phone-day-map", "500,1400", "map"), ("phone-day-weather", "500,1600", "wx")):
            shot_file.write_text(html.replace("<head>", "<head>" + shot_probe.replace("TAB", tab), 1))
            p2 = subprocess.Popen([CHROME, "--headless", "--disable-gpu", "--no-sandbox", f"--user-data-dir={profile}-shot-{tab}", "--virtual-time-budget=45000",
                                   f"--window-size={size}", "--hide-scrollbars", f"--screenshot={shots / (name + '.png')}", url.rstrip("/") + "/__shot.html"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for _ in range(75):
                if p2.poll() is not None:
                    break
                time.sleep(1)
            if p2.poll() is None:
                p2.kill()
            if (shots / (name + ".png")).exists():
                print(f"screenshot: checks/{name}.png (look at it once before deploying)")
    finally:
        shot_file.unlink(missing_ok=True)
print(json.dumps({k: v for k, v in res.items() if k != "log"}, ensure_ascii=False, indent=1))
if server:
    server.shutdown()
if fails:
    print("\nFAILED:\n- " + "\n- ".join(fails))
    sys.exit(1)
print("\nall checks passed")
