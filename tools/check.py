# /// script
# requires-python = ">=3.11"
# ///
"""Headless-Chrome checks of the built site: map tiles and route drawn, weather filled, place links,
day links, a simulated position snapshot, and the hourly chart. Exit 1 on any failure.

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

# Instrumented copy: log errors, simulate a snapshot at NIGHT 2, open one hourly chart, report in <title>.
tmp = Path(tempfile.mkdtemp(prefix="trek-check-"))
html = subprocess.run(["curl", "-s", url], capture_output=True, text=True).stdout
if "<head>" not in html:
    sys.exit("check: could not fetch " + url)
probe = """<script>window.__log=[];window.addEventListener('error',function(e){window.__log.push('ERR '+e.message+' @'+e.filename+':'+e.lineno)});
window.addEventListener('unhandledrejection',function(e){window.__log.push('REJ '+(e.reason&&e.reason.message))});
var __t0=Date.now(); (function waitWx(){ if(Date.now()-__t0<30000 && !document.querySelector('.wx .wxrow') && !document.querySelector('.wx .wxmeta')) return setTimeout(waitWx,500); setTimeout(function(){try{
  var tiles=document.querySelectorAll('.leaflet-tile').length, paths=document.querySelectorAll('path.leaflet-interactive').length;
  var wx=document.querySelectorAll('.wx .wxrow').length, wxlinks=document.querySelectorAll('.wx a.focus').length, daylinks=document.querySelectorAll('a.daylink').length;
  var wxcards=document.querySelectorAll('.wx').length, wxrange=[].filter.call(document.querySelectorAll('.wx'),function(e){return e.textContent.indexOf('16')>=0&&e.children.length===1&&e.firstElementChild.className==='wxmeta'}).length;
  if(!window.gr52Data){document.title=JSON.stringify({exc:'GPX not loaded',log:window.__log});return;}
  var n2=null; (window.gr52Data.data.wpts).forEach(function(w){ if(!n2 && /^NIGHT 2 /.test(w.name)) n2=w; });
  if(n2) window.gr52Snapshot({coords:{latitude:n2.lat,longitude:n2.lon,accuracy:20}});
  var vis=document.querySelector('.wrap[lang]:not([hidden])'); var cur=vis.querySelector('.stage:not(.done) [data-wx="hourly"]'); if(cur) cur.click();
  setTimeout(function(){
    var done=[].map.call(vis.querySelectorAll('.stage.done'),function(c){return c.getAttribute('data-day')}).join(',');
    var snap=(vis.querySelector('.snapbox')||{}).textContent||'';
    var cv=vis.querySelector('.stage:not(.done) .wxhour canvas'); var sl=vis.querySelector('.stage:not(.done) .wxhour input[type=range]'); var slider='';
    if(sl){ sl.value=6.5; sl.dispatchEvent(new Event('input')); slider=(vis.querySelector('.stage:not(.done) .wxhour output')||{}).textContent+' | events: '+((vis.querySelector('.stage:not(.done) .wxevents')||{}).textContent||'').slice(0,160)+' | rec: '+((vis.querySelector('.stage:not(.done) .wxrec')||{}).textContent||''); }
    var stats=(document.querySelector('.profstats')||{}).textContent||'';
    document.title=JSON.stringify({tiles:tiles,paths:paths,wx:wx,wxlinks:wxlinks,wxcards:wxcards,wxrange:wxrange,daylinks:daylinks,done:done,snap:snap.slice(0,160),canvas:cv?cv.width:0,slider:slider,stats:stats,log:window.__log});
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
if server:
    server.shutdown()
if not m:
    sys.exit("check: no result title in the rendered DOM (page did not finish); DOM at " + str(tmp / "dom.html"))
res = json.loads(m.group(1).replace("&quot;", '"').replace("&amp;", "&"))
fails = []
if res.get("exc"):
    fails.append("probe exception: " + res["exc"])
log = [x for x in res.get("log", []) if "ServiceWorker" not in x]  # the probe runs from a file URL, where SW registration is refused
if log:
    fails.append("console errors: " + " | ".join(log))
if res.get("tiles", 0) < 4:
    fails.append(f"map tiles drawn: {res.get('tiles')}")
if res.get("paths", 0) < 5:
    fails.append(f"route/marker paths drawn: {res.get('paths')}")
# Open-Meteo forecasts 16 days ahead: before that window every card shows the "not yet available" note,
# so the weather rows, place links and hourly chart cannot be checked until the trek is within 16 days.
beyond_horizon = res.get("wx", 0) == 0 and res.get("wxcards", 0) > 0 and res.get("wxrange", 0) == res.get("wxcards", 0)
if beyond_horizon:
    print("weather: trek dates are beyond the 16-day forecast horizon; every card shows the 'not yet available' note")
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
print(json.dumps({k: v for k, v in res.items() if k != "log"}, ensure_ascii=False, indent=1))
if fails:
    print("\nFAILED:\n- " + "\n- ".join(fails))
    sys.exit(1)
print("\nall checks passed")
