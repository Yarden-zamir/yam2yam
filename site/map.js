/* Trek map app: draws the real GPX, elevation profile, position snapshot, offline tiles. Config in window.TREK. */
(function () {
  'use strict';
  var TREK = window.TREK || {}; var GPX = TREK.gpx || '/route.gpx';
  var TILES = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
  var I18N = {
    en: {
      nights: 'Nights, refuges, finish', water: 'Water', passes: 'Passes and summits', side: 'Side-trip summits',
      ferrata: 'Via ferrata points', escape: 'Escapes, bus, emergency', other: 'Shelters, campsites, lakes',
      locate: 'Where am I (snapshot)', locating: 'Locating…', save: 'Save this view offline', saveRoute: 'Save whole route offline',
      saving: 'Saving tiles', saved: 'Saved for offline: ', tilesTooMany: 'Too many tiles for one save (max 900). Zoom in.',
      noGeo: 'Location is not available in this browser.', offRoute: 'off route', toNext: 'to', ascent: 'ascent',
      descent: 'descent', total: 'Route', km: 'km', m: 'm', offline: 'Offline: page, GPX and saved tiles are available.',
      alt: 'alt', loading: 'Loading GPX…', ready: 'GPX loaded: ', tracks: 'tracks', wpts: 'waypoints'
    },
    he: {
      nights: 'לילות, בקתות, סיום', water: 'מים', passes: 'מעברים ופסגות', side: 'פסגות סטיות צד',
      ferrata: 'נקודות ויה פראטה', escape: 'יציאות, אוטובוס, חירום', other: 'מחסות, קמפינגים, אגמים',
      locate: 'איפה אני (צילום מצב)', locating: 'מאתר…', save: 'שמור תצוגה זו לאופליין', saveRoute: 'שמור את כל המסלול לאופליין',
      saving: 'שומר אריחים', saved: 'נשמר לאופליין: ', tilesTooMany: 'יותר מדי אריחים לשמירה אחת (מקסימום 900). התקרבו.',
      noGeo: 'מיקום לא זמין בדפדפן הזה.', offRoute: 'מחוץ למסלול', toNext: 'עד', ascent: 'עלייה',
      descent: 'ירידה', total: 'המסלול', km: 'ק"מ', m: 'מ\'', offline: 'אופליין: הדף, ה-GPX והאריחים השמורים זמינים.',
      alt: 'גובה', loading: 'טוען GPX…', ready: 'GPX נטען: ', tracks: 'מסלולים', wpts: 'נקודות'
    }
  };
  var CAT = { Night: 'nights', Flag: 'nights', Lodging: 'nights', Restaurant: 'nights', Water: 'water', Summit: 'passes',
    SideTrip: 'side', ViaFerrata: 'ferrata', Escape: 'escape', Transport: 'escape', Info: 'escape', Campsite: 'other', Shelter: 'other' };
  var DEFAULT_ON = { nights: true, water: true };

  function hav(a, b) {
    var R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
    var s = Math.sin(dLat / 2), t = Math.sin(dLon / 2);
    var h = s * s + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * t * t;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function text(el, tag) { var n = el.getElementsByTagName(tag)[0]; return n ? n.textContent : ''; }

  function parseGpx(xmlText) {
    var x = new DOMParser().parseFromString(xmlText, 'application/xml');
    var tracks = Array.prototype.map.call(x.getElementsByTagName('trk'), function (trk) {
      var name = text(trk, 'name');
      return {
        name: name, color: text(trk, 'osmand:color') || '#C8322B',
        kind: name.indexOf('ROUTE') === 0 ? 'route' : name.indexOf('PARK') === 0 ? 'boundary' : name.indexOf('SIDE') === 0 ? 'side' : 'ferrata',
        segs: Array.prototype.map.call(trk.getElementsByTagName('trkseg'), function (s) {
          return Array.prototype.map.call(s.getElementsByTagName('trkpt'), function (p) {
            var e = p.getElementsByTagName('ele')[0];
            return { lat: +p.getAttribute('lat'), lon: +p.getAttribute('lon'), ele: e ? +e.textContent : null };
          });
        })
      };
    });
    var wpts = Array.prototype.map.call(x.getElementsByTagName('wpt'), function (w) {
      return { lat: +w.getAttribute('lat'), lon: +w.getAttribute('lon'), name: text(w, 'name'), type: text(w, 'type'), color: text(w, 'osmand:color') || '#6B7775' };
    });
    return { tracks: tracks, wpts: wpts };
  }

  /* Chain the ROUTE tracks into one walking line. Each track may hold short alternates or loops as
     extra segments; keep only segments that connect to the running end (gap under 500 m). */
  function buildRoute(tracks) {
    var pts = [], d = 0, prev = null;
    function append(seg) { seg.forEach(function (p) { if (prev) d += hav(prev, p); pts.push({ lat: p.lat, lon: p.lon, ele: p.ele, d: d }); prev = p; }); }
    tracks.filter(function (t) { return t.kind === 'route'; }).forEach(function (t) {
      var left = t.segs.slice();
      if (!prev) { left.sort(function (a, b) { return b.length - a.length; }); append(left.shift()); }
      while (left.length) {
        var best = null;
        left.forEach(function (s) {
          var g0 = hav(prev, s[0]), g1 = hav(prev, s[s.length - 1]);
          if (!best || Math.min(g0, g1) < best.gap) best = { seg: s, gap: Math.min(g0, g1), rev: g1 < g0 };
        });
        if (best.gap > 500) break;
        left.splice(left.indexOf(best.seg), 1);
        append(best.rev ? best.seg.slice().reverse() : best.seg);
      }
    });
    var asc = 0, desc = 0, last = null;
    pts.forEach(function (p) {
      if (p.ele == null) return;
      if (last == null) { last = p.ele; return; }
      var dz = p.ele - last;
      if (Math.abs(dz) >= 10) { if (dz > 0) asc += dz; else desc -= dz; last = p.ele; }
    });
    var maxEle = 0; pts.forEach(function (p) { if (p.ele != null && p.ele > maxEle) maxEle = p.ele; });
    return { pts: pts, length: d, ascent: asc, descent: desc, maxEle: maxEle };
  }
  function nearestOnRoute(route, p) {
    var best = null;
    route.pts.forEach(function (q, i) { var dd = hav(p, q); if (!best || dd < best.dist) best = { dist: dd, i: i, pt: q }; });
    return best;
  }

  function shortTrackName(name) {
    var parts = name.split(' · ');
    return parts.length > 2 ? parts[0] + ' · ' + parts[1] : name;
  }

  var data = null, route = null, apps = {}, pending = null;
  function norm(s) { return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

  function build(container) {
    var lang = container.getAttribute('data-map');
    if (apps[lang]) return apps[lang];
    var T = I18N[lang];
    var mapEl = container.querySelector('.livemap');
    var status = container.querySelector('.mapstatus');
    var map = L.map(mapEl, { scrollWheelZoom: false, zoomSnap: 0.5 });
    L.tileLayer(TILES, { maxZoom: 17, crossOrigin: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM &middot; &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' }).addTo(map);

    var overlays = {}, routeGroup = L.featureGroup();
    data.tracks.forEach(function (t) {
      var g = L.layerGroup();
      t.segs.forEach(function (seg) {
        L.polyline(seg.map(function (p) { return [p.lat, p.lon]; }), {
          color: t.color, weight: t.kind === 'route' ? 4 : 3, opacity: t.kind === 'boundary' ? .75 : .95, dashArray: t.kind === 'boundary' ? '6 6' : null
        }).bindPopup(t.name).addTo(g);
      });
      overlays[shortTrackName(t.name)] = g;
      if (t.kind === 'route') { g.addTo(map); g.eachLayer(function (l) { routeGroup.addLayer(l); }); }
    });
    var cats = {};
    data.wpts.forEach(function (w) {
      var c = CAT[w.type] || 'other';
      cats[c] = cats[c] || L.layerGroup();
      L.circleMarker([w.lat, w.lon], { radius: c === 'nights' ? 7 : 5, color: '#fff', weight: 1.5, fillColor: w.color, fillOpacity: 1 }).bindPopup(w.name).addTo(cats[c]);
    });
    ['nights', 'water', 'passes', 'side', 'ferrata', 'escape', 'other'].forEach(function (c) {
      if (!cats[c]) return; overlays[T[c]] = cats[c]; if (DEFAULT_ON[c]) cats[c].addTo(map);
    });
    L.control.layers(null, overlays, { collapsed: true }).addTo(map);
    map.fitBounds(routeGroup.getBounds(), { padding: [12, 12] });

    /* elevation profile */
    var canvas = container.querySelector('canvas.profile'), hoverMarker = null;
    var nights = data.wpts.filter(function (w) { return (w.type === 'Night' || w.type === 'Flag') && !/FALLBACK|option/.test(w.name); })
      .map(function (w) { var n = nearestOnRoute(route, w); return { w: w, d: n.pt.d, ele: n.pt.ele }; }).sort(function (a, b) { return a.d - b.d; });
    function drawProfile(hoverX) {
      var dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      var ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
      var cs = getComputedStyle(document.documentElement);
      var ink = cs.getPropertyValue('--ink').trim(), muted = cs.getPropertyValue('--muted').trim(), line = cs.getPropertyValue('--line').trim(),
        mark = cs.getPropertyValue('--mark').trim(), lake = cs.getPropertyValue('--lake').trim(), soft = cs.getPropertyValue('--lake-soft').trim();
      var L0 = 44, R0 = 10, T0 = 12, B0 = 24, maxD = route.length, maxE = Math.max(500, Math.ceil(route.maxEle / 500) * 500), eStep = maxE > 1500 ? 1000 : 500, kStep = maxD > 60000 ? 20 : maxD > 25000 ? 10 : 5;
      var x = function (d) { return L0 + d / maxD * (W - L0 - R0); }, y = function (e) { return T0 + (1 - e / maxE) * (H - T0 - B0); };
      ctx.clearRect(0, 0, W, H);
      ctx.font = '11px IBM Plex Mono, monospace'; ctx.fillStyle = muted; ctx.strokeStyle = line; ctx.lineWidth = 1;
      for (var e = 0; e <= maxE; e += eStep) (function (e) { ctx.beginPath(); ctx.moveTo(L0, y(e)); ctx.lineTo(W - R0, y(e)); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(e + ' ' + T.m, L0 - 6, y(e) + 4); })(e);
      for (var k = 0; k <= maxD / 1000; k += kStep) { ctx.textAlign = 'center'; ctx.fillText(k + ' ' + T.km, x(k * 1000), H - 8); }
      ctx.beginPath(); var started = false;
      route.pts.forEach(function (p) { if (p.ele == null) return; var px = x(p.d), py = y(p.ele); if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py); });
      var pathEnd = ctx; ctx.lineTo(x(maxD), y(0)); ctx.lineTo(x(0), y(0)); ctx.closePath(); ctx.fillStyle = soft; ctx.fill();
      ctx.beginPath(); started = false;
      route.pts.forEach(function (p) { if (p.ele == null) return; var px = x(p.d), py = y(p.ele); if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py); });
      ctx.strokeStyle = lake; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = '500 11px IBM Plex Sans, sans-serif';
      nights.forEach(function (n, i) {
        var px = x(n.d), py = y(n.ele || 0);
        ctx.beginPath(); ctx.arc(px, py, 4.5, 0, 7); ctx.fillStyle = mark; ctx.fill();
        ctx.fillStyle = ink; ctx.textAlign = i === nights.length - 1 ? 'right' : 'center';
        ctx.fillText(n.w.name.split(' · ')[0].replace('NIGHT ', 'N'), px, py - 9);
      });
      if (hoverX != null) {
        var d = Math.max(0, Math.min(maxD, (hoverX - L0) / (W - L0 - R0) * maxD)), lo = 0, hi = route.pts.length - 1;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (route.pts[mid].d < d) lo = mid + 1; else hi = mid; }
        var p = route.pts[lo];
        ctx.strokeStyle = mark; ctx.beginPath(); ctx.moveTo(x(d), T0); ctx.lineTo(x(d), H - B0); ctx.stroke();
        ctx.fillStyle = ink; ctx.textAlign = x(d) > W / 2 ? 'right' : 'left';
        ctx.fillText((d / 1000).toFixed(1) + ' ' + T.km + ' · ' + (p.ele == null ? '' : p.ele + ' ' + T.m), x(d) + (x(d) > W / 2 ? -6 : 6), T0 + 12);
        if (!hoverMarker) hoverMarker = L.circleMarker([p.lat, p.lon], { radius: 7, color: mark, weight: 3, fillColor: '#fff', fillOpacity: 1 }).addTo(map);
        else hoverMarker.setLatLng([p.lat, p.lon]);
      }
    }
    function hover(ev) { var r = canvas.getBoundingClientRect(); var cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left; drawProfile(cx); if (ev.touches) ev.preventDefault(); }
    canvas.addEventListener('mousemove', hover); canvas.addEventListener('touchstart', hover, { passive: false }); canvas.addEventListener('touchmove', hover, { passive: false });
    canvas.addEventListener('mouseleave', function () { drawProfile(null); if (hoverMarker) { map.removeLayer(hoverMarker); hoverMarker = null; } });
    var stats = container.querySelector('.profstats');
    stats.textContent = T.total + ' ' + (route.length / 1000).toFixed(1) + ' ' + T.km + ' · ' + T.ascent + ' ' + Math.round(route.ascent) + ' ' + T.m + ' · ' + T.descent + ' ' + Math.round(route.descent) + ' ' + T.m + (TREK.elevation ? ' · ' + TREK.elevation : '');
    drawProfile(null);
    window.addEventListener('resize', function () { drawProfile(null); });

    /* one-shot position: a snapshot, no GPS watch, to save battery */
    var locBtn = container.querySelector('[data-act="locate"]'), meMarker = null, meCircle = null;
    locBtn.textContent = T.locate;
    function showPosition(lat, lon, acc) {
      var ll = [lat, lon];
      if (!meMarker) { meMarker = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 2, fillColor: '#1E6FD9', fillOpacity: 1 }).addTo(map); meCircle = L.circle(ll, { radius: acc || 30, weight: 1, color: '#1E6FD9', fillOpacity: .08 }).addTo(map); }
      else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(acc || 30); }
    }
    locBtn.addEventListener('click', function () { if (window.gr52Snapshot) window.gr52Snapshot(); });
    map.on('locationerror', function (e) { status.textContent = e.message; });

    /* offline tiles: current view, or a corridor along the whole route */
    function tileXY(lat, lon, z) {
      var n = Math.pow(2, z), r = lat * Math.PI / 180;
      return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)];
    }
    function tileUrl(z, x, y) { return TILES.replace('{s}', 'abc'[(x + y) % 3]).replace('{z}', z).replace('{x}', x).replace('{y}', y); }
    function saveTiles(urls, btn) {
      if (urls.length > 900) { status.textContent = T.tilesTooMany + ' (' + urls.length + ')'; return; }
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      var done = 0, failed = 0; btn.disabled = true;
      (function next() {
        if (done >= urls.length) { status.textContent = T.saved + (urls.length - failed) + (failed ? ' (' + failed + ' failed)' : ''); btn.disabled = false; return; }
        fetch(urls[done], { mode: 'cors' }).then(function (r) { if (!r.ok) failed++; }).catch(function () { failed++; })
          .then(function () { done++; if (done % 10 === 0) status.textContent = T.saving + ' ' + done + '/' + urls.length; setTimeout(next, 40); });
      })();
    }
    var routeBtn = container.querySelector('[data-act="saveroute"]');
    routeBtn.textContent = T.saveRoute;
    routeBtn.addEventListener('click', function () {
      var seen = {}, urls = [];
      [12, 13, 14].forEach(function (z) {
        var pad = z === 14 ? 1 : 1;
        data.tracks.forEach(function (t) {
          if (t.kind === 'boundary') return;
          t.segs.forEach(function (seg) {
            seg.forEach(function (p, k) {
              if (k % 3) return;
              var xy = tileXY(p.lat, p.lon, z);
              for (var dx = -pad; dx <= pad; dx++) for (var dy = -pad; dy <= pad; dy++) {
                var key = z + '/' + (xy[0] + dx) + '/' + (xy[1] + dy);
                if (!seen[key]) { seen[key] = 1; urls.push(tileUrl(z, xy[0] + dx, xy[1] + dy)); }
              }
            });
          });
        });
      });
      saveTiles(urls, routeBtn);
    });

    var highlight = null;
    function clearHighlight() { if (highlight) { map.removeLayer(highlight); highlight = null; } }
    function focus(q) {
      clearHighlight();
      var mLL = /^ll:(-?[\d.]+),(-?[\d.]+)(?::(.*))?$/.exec(q);
      if (mLL) {
        var ll0 = [+mLL[1], +mLL[2]];
        map.setView(ll0, Math.max(map.getZoom(), 14));
        highlight = L.circleMarker(ll0, { radius: 16, color: '#1E6FD9', weight: 3, fill: false }).addTo(map);
        if (mLL[3]) highlight.bindPopup(mLL[3]).openPopup();
        return true;
      }
      var mDay = /^day:(\d+)$/.exec(q);
      if (mDay) {
        var n = +mDay[1], from = n === 1 ? 0 : null, to = null;
        nights.forEach(function (x) { var k = x.w.name.split(' ')[1]; if (x.w.name.indexOf('NIGHT ' + (n - 1) + ' ') === 0 && from == null) from = x.d; if (x.w.name.indexOf('NIGHT ' + n + ' ') === 0 || x.w.name.indexOf('FINISH') === 0 && !nights.some(function (y) { return y.w.name.indexOf('NIGHT ' + n + ' ') === 0; })) to = x.d; });
        if (from == null) from = 0; if (to == null) to = route.length;
        var slice = route.pts.filter(function (p) { return p.d >= from && p.d <= to; }).map(function (p) { return [p.lat, p.lon]; });
        if (slice.length < 2) return false;
        highlight = L.polyline(slice, { color: '#1E6FD9', weight: 9, opacity: .45 }).addTo(map);
        map.fitBounds(highlight.getBounds(), { padding: [20, 20] });
        return true;
      }
      var nq = norm(q), w = null;
      data.wpts.forEach(function (x) { if (!w && norm(x.name).indexOf(nq) >= 0) w = x; });
      if (w) {
        var c = CAT[w.type] || 'other'; if (cats[c] && !map.hasLayer(cats[c])) cats[c].addTo(map);
        map.setView([w.lat, w.lon], Math.max(map.getZoom(), 14));
        cats[c].eachLayer(function (l) { if (l.getLatLng && l.getLatLng().lat === w.lat && l.getLatLng().lng === w.lon) l.openPopup(); });
        highlight = L.circleMarker([w.lat, w.lon], { radius: 16, color: '#1E6FD9', weight: 3, fill: false }).addTo(map);
        return true;
      }
      var t = null; data.tracks.forEach(function (x) { if (!t && norm(x.name).indexOf(nq) >= 0) t = x; });
      if (t) {
        var g = overlays[shortTrackName(t.name)]; if (g && !map.hasLayer(g)) g.addTo(map);
        var fg = L.featureGroup(); g.eachLayer(function (l) { fg.addLayer(l); });
        map.fitBounds(fg.getBounds(), { padding: [20, 20] });
        highlight = L.polyline(t.segs.map(function (s) { return s.map(function (p) { return [p.lat, p.lon]; }); }), { color: '#1E6FD9', weight: 9, opacity: .35 }).addTo(map);
        return true;
      }
      return false;
    }
    map.on('click', clearHighlight);
    function pick(cb) { mapEl.style.cursor = 'crosshair'; map.once('click', function (e) { mapEl.style.cursor = ''; cb(e.latlng.lat, e.latlng.lng); }); }
    apps[lang] = { map: map, focus: focus, showPosition: showPosition, pick: pick, box: container, status: status, redraw: function () { map.invalidateSize(); drawProfile(null); } };
    return apps[lang];
  }

  function visible() {
    document.querySelectorAll('.mapbox').forEach(function (c) { if (c.offsetParent !== null) build(c).redraw(); });
  }
  document.querySelectorAll('.mapstatus').forEach(function (s) { s.textContent = I18N[s.closest('.mapbox').getAttribute('data-map')].loading; });
  fetch(GPX).then(function (r) { return r.text(); }).then(function (t) {
    data = parseGpx(t); route = buildRoute(data.tracks); window.gr52Data = { data: data, route: route };
    document.querySelectorAll('.mapstatus').forEach(function (s) { var T = I18N[s.closest('.mapbox').getAttribute('data-map')]; s.textContent = T.ready + data.tracks.length + ' ' + T.tracks + ', ' + data.wpts.length + ' ' + T.wpts + (navigator.onLine ? '' : ' · ' + T.offline); });
    visible();
    if (pending) { var q = pending; pending = null; focusVisible(q); } else fromHash();
  });
  var btn = document.getElementById('langbtn'); if (btn) btn.addEventListener('click', function () { setTimeout(visible, 30); });
  function focusVisible(q) {
    var box = null; document.querySelectorAll('.mapbox').forEach(function (c) { if (c.offsetParent !== null) box = c; });
    if (!box) return;
    if (!data) { pending = q; return; }
    var app = build(box);
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function () { app.redraw(); app.focus(q); }, 250);
  }
  window.gr52Focus = focusVisible;
  window.gr52Map = { visibleApp: function () { var box = null; document.querySelectorAll('.mapbox').forEach(function (c) { if (c.offsetParent !== null) box = c; }); return box && data ? build(box) : null; }, nearest: function (p) { return route ? nearestOnRoute(route, p) : null; } };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-focus]'); if (!a) return;
    e.preventDefault(); focusVisible(a.getAttribute('data-focus'));
  });
  function fromHash() { var h = decodeURIComponent(location.hash || ''); if (h.indexOf('#map=') === 0) focusVisible(h.slice(5)); }
  window.addEventListener('hashchange', fromHash);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
})();


/* Trip module: live weather per day (Open-Meteo), hourly view, and the position snapshot that
   marks finished days and enriches today's card. Locations come from the GPX at runtime. */
(function () {
  'use strict';
  var API = 'https://api.open-meteo.com/v1/forecast';
  var T = {
    en: { night: 'night spot', finish: 'finish', high: 'high point', rain: 'rain', prob: 'chance', gusts: 'gusts', fl: 'freezing level', uv: 'UV', sun: 'sun',
      feels: 'feels', fetched: 'Open-Meteo · fetched', ago: 'ago', stale: 'stale', offline: 'offline copy', refresh: 'Refresh', range: 'Forecast not yet available for this date (16-day horizon). Reload closer to the day.',
      err: 'Weather unavailable right now.', hourly: 'Hour by hour', hide: 'Hide hours', walk: 'planned walking', leave: 'Leave the pass by', stormHours: 'storm risk', early: 'start at first light and clear the high point before', wait: 'storms from the start of the day: consider waiting it out or a low route', legend: 'top: your altitude through the day, thick where exposed above the treeline or at a pass · red: storm risk where you are · blue: rain where you are · orange: heat · strip: share of ECMWF ensemble members with storm conditions at the high point · bottom: temperature at your position, bars rain mm per hour · dotted: sunrise, sunset', lead: 'days out', lowconf: 'low confidence beyond 4 days', stormHere: 'Thunderstorm risk where you are', source: 'source', rule: 'Storm = thunderstorm code, or CAPE ≥ 400 J/kg with lifted index ≤ −2 and rain chance ≥ 20 %. Source links open the same numbers on Open-Meteo.', start: 'Start', arrive: 'arrive', exposed: 'exposed hours in risk', recommend: 'Recommended start', events: 'What you meet on the way', noevents: 'No storm, heavy rain or strong wind on your line for this start.', members: 'of ensemble members', reach: 'you reach', at: 'at', ensLoading: 'ensemble…', afterSunset: 'after sunset', afterTent: 'inside the tent window', temp: 'temp', highT: 'high point', nightT: 'night spot',
      w: { storm: 'Thunderstorm risk at the high point', rain: 'Rain likely', snow: 'Snow or freezing on the high point',
        wind: 'Strong gusts on the ridge', frost: 'Frost at the bivouac', heat: 'Heat on the low ground: start early, 3 L water', fog: 'Fog: navigation care on boulder fields', uv: 'Very high UV', cold: 'Cold night', late: 'Planned arrival after sunset' },
      codes: { 0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'showers', 81: 'showers', 82: 'heavy showers', 85: 'snow showers', 86: 'snow showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail' },
      snap: { far: 'You are {km} km from the route. Snapshot not applied.', at: 'You are at km {km} of the route', walked: 'walked today', left: 'left to', ascent: 'ascent left', pace: 'pace', measured: 'measured', planned: 'planned', eta: 'ETA', sunset: 'sunset', tent: 'tent window opens 19:00', done: 'done', show: 'show', undo: 'not done', noGeo: 'Location is not available in this browser.', taken: 'Snapshot', manual: 'picked on map', pick: 'Tap the map where you are.', off: 'off route by', before: 'Trek not started: you are near the start.', after: 'Past the finish: well done.' }
    },
    he: { night: 'לינה', finish: 'סיום', high: 'נקודה גבוהה', rain: 'גשם', prob: 'סיכוי', gusts: 'משבים', fl: 'גובה קיפאון', uv: 'UV', sun: 'שמש',
      feels: 'מורגש', fetched: 'Open-Meteo · נמשך', ago: 'לפני', stale: 'לא עדכני', offline: 'עותק אופליין', refresh: 'רענן', range: 'עדיין אין תחזית לתאריך הזה (טווח של 16 יום). טענו שוב קרוב ליום.',
      err: 'מזג האוויר לא זמין כרגע.', hourly: 'שעה אחר שעה', hide: 'הסתר שעות', walk: 'הליכה מתוכננת', leave: 'לרדת מהמעבר עד', stormHours: 'סיכון לסופות', early: 'לצאת עם אור ראשון ולעבור את הנקודה הגבוהה לפני', wait: 'סופות מתחילת היום: לשקול להמתין או מסלול נמוך', legend: 'למעלה: הגובה שלכם לאורך היום, עבה איפה שחשופים מעל קו העצים או במעבר · אדום: סיכון סופה איפה שאתם · כחול: גשם איפה שאתם · כתום: חום · הפס: חלק חברי האנסמבל של ECMWF עם תנאי סופה בנקודה הגבוהה · למטה: טמפרטורה במיקום שלכם, עמודות גשם מ\"מ לשעה · מקווקו: זריחה, שקיעה', lead: 'ימים קדימה', lowconf: 'ודאות נמוכה מעבר ל-4 ימים', stormHere: 'סיכון לסופת רעמים איפה שאתם', source: 'מקור', rule: 'סופה = קוד סופת רעמים, או CAPE ≥ 400 J/kg עם lifted index ≤ −2 וסיכוי גשם ≥ 20%. קישורי המקור פותחים את אותם מספרים ב-Open-Meteo.', start: 'יציאה', arrive: 'הגעה', exposed: 'שעות חשופות בסיכון', recommend: 'יציאה מומלצת', events: 'מה תפגשו בדרך', noevents: 'אין סופה, גשם כבד או רוח חזקה על הקו שלכם ליציאה הזו.', members: 'מחברי האנסמבל', reach: 'מגיעים ל', at: 'ב', ensLoading: 'אנסמבל…', afterSunset: 'אחרי השקיעה', afterTent: 'בתוך חלון האוהל', temp: 'טמפ\'', highT: 'נקודה גבוהה', nightT: 'לינה',
      w: { storm: 'סיכון לסופות רעמים בנקודה הגבוהה', rain: 'גשם צפוי', snow: 'שלג או קיפאון בנקודה הגבוהה',
        wind: 'משבי רוח חזקים על הרכס', frost: 'כפור בלינה', heat: 'חום בגובה הנמוך: לצאת מוקדם, 3 ליטר מים', fog: 'ערפל: זהירות בניווט בשדות הבולדרים', uv: 'קרינה גבוהה מאוד', cold: 'לילה קר', late: 'הגעה מתוכננת אחרי השקיעה' },
      codes: { 0: 'בהיר', 1: 'בהיר ברובו', 2: 'מעונן חלקית', 3: 'מעונן', 45: 'ערפל', 48: 'ערפל קפוא', 51: 'טפטוף קל', 53: 'טפטוף', 55: 'טפטוף כבד', 56: 'טפטוף קפוא', 57: 'טפטוף קפוא', 61: 'גשם קל', 63: 'גשם', 65: 'גשם כבד', 66: 'גשם קפוא', 67: 'גשם קפוא', 71: 'שלג קל', 73: 'שלג', 75: 'שלג כבד', 77: 'גרגרי שלג', 80: 'ממטרים', 81: 'ממטרים', 82: 'ממטרים כבדים', 85: 'ממטרי שלג', 86: 'ממטרי שלג', 95: 'סופת רעמים', 96: 'סופת רעמים עם ברד', 99: 'סופת רעמים עם ברד' },
      snap: { far: 'אתם במרחק {km} ק"מ מהמסלול. צילום המצב לא הוחל.', at: 'אתם בק"מ {km} של המסלול', walked: 'הלכתם היום', left: 'נשאר עד', ascent: 'עלייה שנותרה', pace: 'קצב', measured: 'נמדד', planned: 'מתוכנן', eta: 'הגעה משוערת', sunset: 'שקיעה', tent: 'מותר להקים מ-19:00', done: 'הושלם', show: 'הצג', undo: 'לא הושלם', noGeo: 'מיקום לא זמין בדפדפן הזה.', taken: 'צילום מצב', manual: 'נבחר במפה', pick: 'לחצו על המפה איפה שאתם.', off: 'מחוץ למסלול ב', before: 'הטרק עוד לא התחיל: אתם ליד ההתחלה.', after: 'אחרי הסיום: כל הכבוד.' }
    }
  };
  /* per-trek wording: trek.json "strings": {"en": {"w": {"heat": "..."}, "snap": {...}}, "he": {...}} overrides any key */
  (function () { var o = (window.TREK && window.TREK.strings) || {}; Object.keys(o).forEach(function (lang) { if (!T[lang]) return; Object.keys(o[lang]).forEach(function (grp) { if (typeof o[lang][grp] === 'object' && T[lang][grp]) Object.assign(T[lang][grp], o[lang][grp]); else T[lang][grp] = o[lang][grp]; }); }); })();
  var HOURLY = 'temperature_2m,precipitation,precipitation_probability,weather_code,wind_gusts_10m,cape,lifted_index,freezing_level_height,cloud_cover';
  /* Storm rule: a thunderstorm weather code, or convective energy that can actually be released: CAPE ≥ 400 J/kg
     with lifted index ≤ −2 (unstable) and rain chance ≥ 20 %. CAPE alone is normal under a summer cap and means nothing. */
  function stormAt(loc, i) { var code = hv(loc, 'weather_code', i) || 0, cape = hv(loc, 'cape', i) || 0, li = hv(loc, 'lifted_index', i), prob = hv(loc, 'precipitation_probability', i) || 0; return code >= 95 || (cape >= 400 && li != null && li <= -2 && prob >= 20); }
  function sourceUrl(p, date) { return 'https://open-meteo.com/en/docs#latitude=' + p.lat.toFixed(4) + '&longitude=' + p.lon.toFixed(4) + '&elevation=' + Math.round(p.ele) + '&hourly=temperature_2m,precipitation,precipitation_probability,weather_code,wind_gusts_10m,cape,lifted_index&timezone=' + encodeURIComponent((window.TREK && window.TREK.timezone) || 'auto') + '&start_date=' + date + '&end_date=' + date + (window.TREK && window.TREK.weatherModel ? '&models=' + window.TREK.weatherModel : ''); }
  var DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_min,precipitation_sum,precipitation_probability_max,snowfall_sum,wind_gusts_10m_max,uv_index_max,sunrise,sunset';
  function hav(a, b) { var R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180, s = Math.sin(dLat / 2), t = Math.sin(dLon / 2); return 2 * R * Math.asin(Math.sqrt(s * s + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * t * t)); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function shortName(w) { return w.name.replace(/^(NIGHT \d( option B)?|FINISH|FALLBACK night \d) · [^·]+· /, '').replace(/^(NIGHT \d|FINISH) · /, '').split(/[:,(]/)[0].trim(); }
  function nightKey(w) { return /^FINISH/.test(w.name) ? 'FINISH' : w.name.split(' · ')[0]; }
  function fmtHM(d) { return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }
  function lsGet(k, dflt) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }

  /* ---- day geometry from the GPX ---- */
  function dayPoints(data, route) {
    var nights = data.wpts.filter(function (w) { return (w.type === 'Night' || w.type === 'Flag') && !/FALLBACK|option/.test(w.name); });
    function at(prefix) { var w = null; nights.forEach(function (x) { if (!w && x.name.indexOf(prefix) === 0) w = x; }); return w; }
    function onRoute(w) { var best = null; route.pts.forEach(function (q) { var dd = hav(w, q); if (!best || dd < best.dist) best = { dist: dd, pt: q }; }); return best.pt; }
    var passes = data.wpts.filter(function (w) { return w.type === 'Summit' && /^PASS/.test(w.name); });
    var days = {}, n0 = at('NIGHT 0'), last = 0;
    nights.forEach(function (x) { var mm = /^NIGHT (\d+) /.exec(x.name); if (mm && +mm[1] > last) last = +mm[1]; });
    var LAST = last + 1;
    days[0] = { n: 0, night: { lat: n0.lat, lon: n0.lon, ele: n0.ele != null ? n0.ele : (route.pts[0].ele || 0), name: shortName(n0), key: nightKey(n0) }, high: null, from: 0, to: 0 };
    for (var n = 1; n <= LAST; n++) {
      var a = n === 1 ? n0 : at('NIGHT ' + (n - 1) + ' '), b = n === LAST ? at('FINISH') : at('NIGHT ' + n + ' ');
      if (!a || !b) continue;
      var da = onRoute(a).d, db = onRoute(b).d, hi = null, endPt = onRoute(b);
      route.pts.forEach(function (p) { if (p.d >= da && p.d <= db && p.ele != null && (!hi || p.ele > hi.ele)) hi = p; });
      var hiName = null; passes.forEach(function (w) { if (hav(w, hi) < 800) hiName = w.name.replace(/^PASS · /, '').split(' - ')[0].replace(/\s*\d{3,4} m$/, ''); });
      days[n] = { n: n, night: { lat: b.lat, lon: b.lon, ele: b.ele != null ? b.ele : endPt.ele, name: shortName(b), key: nightKey(b), finish: n === LAST }, high: { lat: hi.lat, lon: hi.lon, ele: hi.ele, name: hiName }, from: da, to: db };
    }
    return days;
  }
  function ascentBetween(route, d0, d1) { var asc = 0, last = null; route.pts.forEach(function (p) { if (p.d < d0 || p.d > d1 || p.ele == null) return; if (last == null) { last = p.ele; return; } var dz = p.ele - last; if (Math.abs(dz) >= 10) { if (dz > 0) asc += dz; last = p.ele; } }); return asc; }

  /* ---- sample points along a day (every ~2.5 km plus the high point) for position-based weather ---- */
  function daySamples(route, day) {
    var out = [], step = 2500, next = day.from, passes = ctx.data.wpts.filter(function (w) { return w.type === 'Summit' && /^PASS/.test(w.name); });
    route.pts.forEach(function (p) {
      if (p.d < day.from || p.d > day.to || p.ele == null) return;
      if (p.d >= next) { out.push({ lat: p.lat, lon: p.lon, ele: p.ele, d: p.d }); next = p.d + step; }
    });
    if (day.high && day.high.d != null) out.push({ lat: day.high.lat, lon: day.high.lon, ele: day.high.ele, d: day.high.d });
    out.forEach(function (s) { passes.forEach(function (w) { if (hav(w, s) < 600) s.name = w.name.replace(/^PASS · /, '').split(' - ')[0].replace(/\s*\d{3,4} m$/, ''); }); });
    return out.sort(function (a, b) { return a.d - b.d; }).slice(0, 12);
  }
  /* Naismith timing along the day's route, scaled so the total equals the card's planned hours. */
  function dayTimeline(route, day, hoursPlanned) {
    var pts = route.pts.filter(function (p) { return p.d >= day.from && p.d <= day.to; }), t = [0], last = pts[0];
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i], dz = (p.ele != null && last.ele != null) ? p.ele - last.ele : 0;
      t.push(t[i - 1] + (p.d - last.d) / 4000 + (dz > 0 ? dz / 600 : -dz / 1200)); last = p;
    }
    var k = hoursPlanned / (t[t.length - 1] || 1);
    return { pts: pts, t: t.map(function (x) { return x * k; }), total: t[t.length - 1] * k };
  }
  function posAt(tl, startH, h) {
    var el = h - startH; if (el <= 0) return { pt: tl.pts[0], done: false, before: true };
    if (el >= tl.total) return { pt: tl.pts[tl.pts.length - 1], done: true };
    var lo = 0, hi = tl.t.length - 1; while (lo < hi) { var mid = (lo + hi) >> 1; if (tl.t[mid] < el) lo = mid + 1; else hi = mid; }
    return { pt: tl.pts[lo], done: false };
  }
  /* Exposed = above the treeline, or at a pass, or inside a stretch listed in trek.json "exposed"
     ([{"fromKm", "toKm", "name"}], for open ridges below the treeline such as the Authion). */
  function exposed(day, ele, near, d) {
    var tree = (window.TREK && window.TREK.treeline) || null, zones = (window.TREK && window.TREK.exposed) || [];
    if (near && near.name) return true;
    for (var i = 0; i < zones.length; i++) if (d != null && d >= zones[i].fromKm * 1000 && d <= zones[i].toKm * 1000) return true;
    if (tree) return ele >= tree;
    return ele >= day.eleMin + 0.75 * (day.eleMax - day.eleMin);
  }
  function exposedName(d) { var zones = (window.TREK && window.TREK.exposed) || []; for (var i = 0; i < zones.length; i++) if (d >= zones[i].fromKm * 1000 && d <= zones[i].toKm * 1000) return zones[i].name; return null; }

  /* ---- planned times from the card: "8–9 h" chip; start 08:00 (day 1: 08:00 after breakfast) ---- */
  /* Planned hours from the .stats chips only ("7–8 h" → 8; "4.5 h official, plan 5–6" → 6). Never from the prose. */
  function plannedHours(card) {
    var spans = card.querySelectorAll('.stats span'), got = null;
    Array.prototype.forEach.call(spans, function (sp) {
      var t = sp.textContent, p = /plan\s*(\d+(?:\.\d+)?)(?:[–-](\d+(?:\.\d+)?))?/.exec(t), h = /(\d+(?:\.\d+)?)(?:[–-](\d+(?:\.\d+)?))?\s*h\b/.exec(t);
      if (p) got = +(p[2] || p[1]); else if (h && got == null) got = +(h[2] || h[1]);
    });
    return got || 7;
  }
  function plannedStart(n) { return n === 0 ? null : ((window.TREK && window.TREK.plannedStart) || 8); }

  /* ---- forecast ---- */
  /* Forecast. trek.json "weatherModel" picks an Open-Meteo model (for example meteofrance_seamless for
     the Alps, whose AROME/ARPEGE runs only reach about 4 days); values it leaves null are filled from
     the default best_match blend, so the whole trek always has numbers. */
  function omUrl(points, startDate, endDate, model) {
    return API + '?latitude=' + points.map(function (p) { return p.lat.toFixed(4); }).join(',') + '&longitude=' + points.map(function (p) { return p.lon.toFixed(4); }).join(',')
      + '&elevation=' + points.map(function (p) { return Math.round(p.ele); }).join(',') + '&daily=' + DAILY + '&hourly=' + HOURLY
      + '&timezone=' + encodeURIComponent((window.TREK && window.TREK.timezone) || 'auto') + '&wind_speed_unit=kmh&start_date=' + startDate + '&end_date=' + endDate + (model ? '&models=' + model : '');
  }
  function getJson(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) { return Array.isArray(j) ? j : [j]; }); }
  function fillNulls(primary, fallback) {
    primary.forEach(function (loc, k) {
      var fb = fallback[k]; if (!fb) return;
      ['daily', 'hourly'].forEach(function (grp) {
        Object.keys(loc[grp]).forEach(function (key) {
          if (key === 'time' || !fb[grp][key]) return;
          loc[grp][key] = loc[grp][key].map(function (v, i) { return v == null ? fb[grp][key][i] : v; });
        });
      });
    });
    return primary;
  }
  function fetchForecast(points, startDate, endDate) {
    var model = window.TREK && window.TREK.weatherModel;
    if (!model || model === 'best_match') return getJson(omUrl(points, startDate, endDate, null));
    return Promise.all([getJson(omUrl(points, startDate, endDate, model)), getJson(omUrl(points, startDate, endDate, null))])
      .then(function (r) { return fillNulls(r[0], r[1]); });
  }
  var ENS = 'https://ensemble-api.open-meteo.com/v1/ensemble';
  function fetchEnsemble(points, startDate, endDate) {
    var u = ENS + '?latitude=' + points.map(function (p) { return p.lat.toFixed(4); }).join(',') + '&longitude=' + points.map(function (p) { return p.lon.toFixed(4); }).join(',')
      + '&elevation=' + points.map(function (p) { return Math.round(p.ele); }).join(',') + '&hourly=cape,precipitation,weather_code&models=ecmwf_ifs025&timezone=' + encodeURIComponent((window.TREK && window.TREK.timezone) || 'auto') + '&start_date=' + startDate + '&end_date=' + endDate;
    return getJson(u).then(function (locs) {
      /* keep only the share of members with storm conditions per hour: small enough to cache */
      return locs.map(function (loc) {
        var keys = Object.keys(loc.hourly).filter(function (k) { return k.indexOf('cape') === 0; }), n = keys.length, frac = [];
        loc.hourly.time.forEach(function (t, i) {
          var hit = 0; keys.forEach(function (k) { var suf = k.slice(4), c = loc.hourly[k][i], p = (loc.hourly['precipitation' + suf] || [])[i], w = (loc.hourly['weather_code' + suf] || [])[i]; if ((w != null && w >= 95) || (c != null && c >= 400 && p != null && p >= 1)) hit++; });
          frac.push(n ? hit / n : 0);
        });
        return { time: loc.hourly.time, frac: frac, members: n };
      });
    });
  }
  function hours(loc, date) { var out = []; loc.hourly.time.forEach(function (t, i) { if (t.indexOf(date) === 0) out.push({ h: +t.slice(11, 13), i: i }); }); return out; }
  function hv(loc, key, i) { var v = loc.hourly[key]; return v ? v[i] : null; }
  function hourStats(loc, date) {
    var fl = null, cape = 0, storm = [];
    hours(loc, date).forEach(function (x) {
      if (x.h >= 6 && x.h <= 18) { var v = hv(loc, 'freezing_level_height', x.i); if (v != null && (fl == null || v < fl)) fl = v; }
      var c = hv(loc, 'cape', x.i) || 0;
      if (x.h >= 9 && x.h <= 21 && c > cape) cape = c;
      if (stormAt(loc, x.i) && x.h >= 8 && x.h <= 21) storm.push(x.h);
    });
    return { fl: fl, cape: cape, storm: storm };
  }
  function warnings(L, day, N, Hh, iN, iH, card) {
    var w = [], dN = N.daily, dH = Hh && Hh.daily, hs = hourStats(Hh || N, dN.time[iN]);
    var codes = [dN.weather_code[iN], dH ? dH.weather_code[iH] : 0];
    if (codes.some(function (c) { return c >= 95; }) || hs.storm.length) {
      var ps0 = plannedStart(day.n) || 8, first = hs.storm.length ? hs.storm[0] : null, lastH = hs.storm.length ? hs.storm[hs.storm.length - 1] : null;
      var extra = first != null ? ' ' + first + ':00–' + (lastH + 1) + ':00' : '';
      var advice = first == null ? '' : first - 1 >= ps0 + 2 ? ' · ' + L.leave + ' ' + (first - 1) + ':00' : first - 1 >= 6 ? ' · ' + L.early + ' ' + (first - 1) + ':00' : ' · ' + L.wait;
      w.push(['storm', 'bad', extra + advice]);
    }
    var rain = Math.max(dN.precipitation_sum[iN], dH ? dH.precipitation_sum[iH] : 0), prob = Math.max(dN.precipitation_probability_max[iN] || 0, dH ? dH.precipitation_probability_max[iH] || 0 : 0);
    if (rain >= 8 || prob >= 60) w.push(['rain', rain >= 15 ? 'bad' : '', '']);
    if (dH && (dH.snowfall_sum[iH] > 0 || (hs.fl != null && hs.fl < day.high.ele + 300))) w.push(['snow', 'bad', '']);
    var gust = Math.max(dN.wind_gusts_10m_max[iN], dH ? dH.wind_gusts_10m_max[iH] : 0);
    if (gust >= 60) w.push(['wind', gust >= 80 ? 'bad' : '', ' ' + Math.round(gust) + ' km/h']);
    if (dN.apparent_temperature_min[iN] <= 0) w.push(['frost', '', '']); else if (dN.apparent_temperature_min[iN] <= 3) w.push(['cold', '', '']);
    if (dN.temperature_2m_max[iN] >= 28) w.push(['heat', '', '']);
    if (codes.some(function (c) { return c === 45 || c === 48; })) w.push(['fog', '', '']);
    if (Math.max(dN.uv_index_max[iN], dH ? dH.uv_index_max[iH] : 0) >= 8) w.push(['uv', '', '']);
    var ps = plannedStart(day.n); if (ps != null) { var arrive = ps + plannedHours(card), ss = +dN.sunset[iN].slice(11, 13) + (+dN.sunset[iN].slice(14, 16)) / 60; if (arrive > ss) w.push(['late', 'bad', ' (' + arrive + ':00)']); }
    return w;
  }

  /* ---- day simulator: altitude + exposure, weather at your position, ensemble strip, start-time slider ---- */
  function hourIndex(loc, date, h) { var t = date + 'T' + (h < 10 ? '0' : '') + h + ':00'; return loc.hourly.time.indexOf(t); }
  function nearestSample(samples, locs, idx, d) { var best = null; samples.forEach(function (s, k) { var dd = Math.abs(s.d - d); if (!best || dd < best.dd) best = { dd: dd, s: s, loc: locs[idx[k]] }; }); return best; }
  function simulate(day, card, N, samples, sIdx, locs, date, startH) {
    var tl = dayTimeline(ctx.route, day, plannedHours(card)), rows = [], iN0 = N.daily.time.indexOf(date);
    var sunset = iN0 >= 0 ? +N.daily.sunset[iN0].slice(11, 13) + (+N.daily.sunset[iN0].slice(14, 16)) / 60 : 20;
    for (var h = 5; h <= 21; h++) {
      var pos = posAt(tl, startH, h), ns = nearestSample(samples, locs, sIdx, pos.pt.d), loc = ns.loc, hi = hourIndex(loc, date, h);
      var row = { h: h, ele: pos.pt.ele, d: pos.pt.d, done: pos.done, before: pos.before, name: ns.dd < 700 ? ns.s.name : null, exposed: exposed(day, pos.pt.ele, ns.dd < 700 ? ns.s : null, pos.pt.d) };
      if (!row.name && row.exposed) row.name = exposedName(pos.pt.d);
      if (hi >= 0) { row.temp = hv(loc, 'temperature_2m', hi); row.rain = hv(loc, 'precipitation', hi) || 0; row.prob = hv(loc, 'precipitation_probability', hi) || 0; row.gust = hv(loc, 'wind_gusts_10m', hi) || 0; row.cape = hv(loc, 'cape', hi) || 0; row.code = hv(loc, 'weather_code', hi) || 0; }
      row.storm = hi >= 0 && stormAt(loc, hi); row.li = hi >= 0 ? hv(loc, 'lifted_index', hi) : null; row.src = ns.s; row.walking = !pos.before && !pos.done;
      rows.push(row);
    }
    var arrive = startH + tl.total, risk = 0, events = [];
    rows.forEach(function (r) {
      if (!r.walking) return;
      var heatLimit = (window.TREK && window.TREK.heatLimit) || 32;
      var bad = (r.storm ? 'storm' : r.rain >= 3 ? 'rain' : r.gust >= 60 ? 'wind' : (r.temp != null && r.temp >= heatLimit) ? 'heat' : null);
      if (bad && (r.exposed || bad === 'heat')) risk++;
      if (bad) events.push({ h: r.h, kind: bad, where: r.name, ele: r.ele, exposed: r.exposed, gust: r.gust, rain: r.rain, temp: r.temp, cape: r.cape, li: r.li, prob: r.prob, code: r.code, src: r.src });
    });
    return { rows: rows, arrive: arrive, risk: risk, events: events, sunset: sunset, tl: tl };
  }
  function recommendStart(day, card, N, samples, sIdx, locs, date) {
    var best = null, tent = window.TREK && window.TREK.tentWindow ? parseInt(window.TREK.tentWindow, 10) : null;
    for (var s = 5.5; s <= 10; s += 0.5) {
      var sim = simulate(day, card, N, samples, sIdx, locs, date, s), score = sim.risk * 10 + (sim.arrive > sim.sunset ? 100 : 0) + (s < 6.5 ? 1 : 0) + (tent && sim.arrive < tent - 3 ? 2 : 0);
      if (!best || score < best.score) best = { start: s, score: score, sim: sim };
    }
    return best;
  }
  function fmtH(h) { var hh = Math.floor(h), mm = Math.round((h - hh) * 60); if (mm === 60) { hh++; mm = 0; } return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm; }
  function drawDay(canvas, L, day, sim, ens, date, N) {
    var dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr; var c2 = canvas.getContext('2d'); c2.scale(dpr, dpr);
    var cs = getComputedStyle(document.documentElement), ink = cs.getPropertyValue('--ink').trim(), muted = cs.getPropertyValue('--muted').trim(), line = cs.getPropertyValue('--line').trim(), mark = cs.getPropertyValue('--mark').trim(), lake = cs.getPropertyValue('--lake').trim(), sign = cs.getPropertyValue('--sign').trim(), soft = cs.getPropertyValue('--lake-soft').trim();
    var h0 = 5, h1 = 21, L0 = 40, R0 = 34, topT = 12, topB = H * 0.5, stripT = topB + 6, stripB = stripT + 8, botT = stripB + 8, botB = H - 20;
    var x = function (h) { return L0 + (h - h0) / (h1 - h0) * (W - L0 - R0); };
    var eMin = Math.floor(day.eleMin / 100) * 100 - 100, eMax = Math.ceil(day.eleMax / 100) * 100 + 100;
    var yE = function (e) { return topT + (1 - (e - eMin) / (eMax - eMin)) * (topB - topT); };
    var temps = sim.rows.map(function (r) { return r.temp; }).filter(function (v) { return v != null; });
    var tMin = temps.length ? Math.floor(Math.min.apply(null, temps) / 5) * 5 - 5 : 0, tMax = temps.length ? Math.ceil(Math.max.apply(null, temps) / 5) * 5 + 5 : 30;
    var yT = function (t) { return botT + (1 - (t - tMin) / (tMax - tMin)) * (botB - botT); };
    var pMax = Math.max(2, Math.max.apply(null, sim.rows.map(function (r) { return r.rain || 0; }))), yP = function (p) { return botB - p / pMax * (botB - botT) * 0.5; };
    c2.clearRect(0, 0, W, H);
    /* risk shading on both panels, at your position; faint outside walking hours */
    sim.rows.forEach(function (r) {
      var heatLimit = (window.TREK && window.TREK.heatLimit) || 32;
      var xa = x(r.h - .5), xb = x(r.h + .5), col = r.storm ? mark : (r.rain >= 3 ? lake : (r.gust >= 60 ? sign : (r.temp != null && r.temp >= heatLimit ? '#E07A2F' : null)));
      if (!col) return; c2.fillStyle = col; c2.globalAlpha = r.walking ? .22 : .07; c2.fillRect(xa, topT, xb - xa, topB - topT); c2.fillRect(xa, botT, xb - xa, botB - botT); c2.globalAlpha = 1;
    });
    /* walking window bar */
    var st = null, en = null; sim.rows.forEach(function (r) { if (r.walking) { if (st == null) st = r.h - .5; en = r.h + .5; } });
    if (st != null) { c2.strokeStyle = sign; c2.lineWidth = 3; c2.beginPath(); c2.moveTo(x(st), topB + 2); c2.lineTo(x(en), topB + 2); c2.stroke(); c2.lineWidth = 1; }
    /* grid + axes */
    c2.strokeStyle = line; c2.fillStyle = muted; c2.font = '10px IBM Plex Mono, monospace';
    for (var h = h0 + 1; h <= h1; h += 2) { c2.beginPath(); c2.moveTo(x(h), topT); c2.lineTo(x(h), botB); c2.stroke(); c2.textAlign = 'center'; c2.fillText(h + ':00', x(h), H - 6); }
    c2.textAlign = 'right'; c2.fillText(eMax + ' m', L0 - 4, yE(eMax) + 4); c2.fillText(eMin + ' m', L0 - 4, yE(eMin) + 4);
    c2.fillText(tMax + '°', L0 - 4, yT(tMax) + 4); c2.fillText(tMin + '°', L0 - 4, yT(tMin) + 4);
    c2.textAlign = 'left'; c2.fillText(pMax.toFixed(0) + ' mm', W - R0 + 4, yP(pMax) + 4);
    /* sunrise / sunset */
    var iN = N.daily.time.indexOf(date);
    if (iN >= 0) [N.daily.sunrise[iN], N.daily.sunset[iN]].forEach(function (s) { var hh = +s.slice(11, 13) + (+s.slice(14, 16)) / 60; c2.strokeStyle = sign; c2.setLineDash([3, 3]); c2.beginPath(); c2.moveTo(x(hh), topT); c2.lineTo(x(hh), botB); c2.stroke(); c2.setLineDash([]); });
    /* altitude: fill, then line thin outside walking, thick where exposed */
    c2.beginPath(); sim.rows.forEach(function (r, i) { if (i) c2.lineTo(x(r.h), yE(r.ele)); else c2.moveTo(x(r.h), yE(r.ele)); }); c2.lineTo(x(h1), topB); c2.lineTo(x(h0), topB); c2.closePath(); c2.fillStyle = soft; c2.fill();
    for (var i = 1; i < sim.rows.length; i++) { var a = sim.rows[i - 1], b = sim.rows[i]; c2.beginPath(); c2.moveTo(x(a.h), yE(a.ele)); c2.lineTo(x(b.h), yE(b.ele)); c2.strokeStyle = (b.walking || a.walking) ? ink : muted; c2.lineWidth = (b.exposed && b.walking) ? 4 : 1.5; c2.stroke(); }
    c2.lineWidth = 1;
    /* named points you pass */
    c2.font = '500 10px IBM Plex Sans, sans-serif'; c2.fillStyle = ink; var lastX = -99;
    sim.rows.forEach(function (r) { if (r.name && r.walking && x(r.h) - lastX > 46) { c2.beginPath(); c2.arc(x(r.h), yE(r.ele), 3.5, 0, 7); c2.fill(); c2.textAlign = 'center'; c2.fillText(r.name, x(r.h), yE(r.ele) - 8); lastX = x(r.h); } });
    /* ensemble strip */
    if (ens) { for (var h2 = h0; h2 <= h1; h2++) { var k = hourIndex({ hourly: { time: ens.time } }, date, h2), f = k >= 0 ? ens.frac[k] : 0; c2.fillStyle = mark; c2.globalAlpha = Math.min(.9, f); c2.fillRect(x(h2 - .5), stripT, x(h2 + .5) - x(h2 - .5), stripB - stripT); c2.globalAlpha = 1; } c2.strokeStyle = line; c2.strokeRect(x(h0 - .5), stripT, x(h1 + .5) - x(h0 - .5), stripB - stripT); }
    /* weather panel: rain bars and temperature at your position */
    sim.rows.forEach(function (r) { if (r.rain > 0) { c2.fillStyle = lake; c2.globalAlpha = .55; c2.fillRect(x(r.h) - 4, yP(r.rain), 8, botB - yP(r.rain)); c2.globalAlpha = 1; } });
    c2.beginPath(); var started = false; sim.rows.forEach(function (r) { if (r.temp == null) return; if (!started) { c2.moveTo(x(r.h), yT(r.temp)); started = true; } else c2.lineTo(x(r.h), yT(r.temp)); }); c2.strokeStyle = ink; c2.lineWidth = 1.6; c2.stroke(); c2.lineWidth = 1;
  }
  function eventText(L, e) {
    var what = e.kind === 'storm' ? L.stormHere : e.kind === 'rain' ? L.rain + ' ' + e.rain.toFixed(0) + ' mm/h' : e.kind === 'heat' ? L.w.heat.split(':')[0] + ' ' + Math.round(e.temp) + ' °C' : L.gusts + ' ' + Math.round(e.gust) + ' km/h';
    var vals = e.kind === 'storm' ? ' (CAPE ' + Math.round(e.cape) + ', LI ' + (e.li == null ? '?' : e.li.toFixed(1)) + ', ' + L.rain + ' ' + e.prob + ' %, code ' + e.code + ')' : '';
    var src = e.src && e.date ? ' <a class="wxsrc" target="_blank" rel="noopener" href="' + sourceUrl(e.src, e.date) + '">' + L.source + '</a>' : '';
    return fmtH(e.h) + ' · ' + (e.where ? L.reach + ' ' + e.where + ' ' : '') + Math.round(e.ele) + ' m · ' + what + vals + (e.exposed ? ' ⚠' : '') + src;
  }
  /* ---- card render ---- */
  function render(el, lang, day, N, Hh, meta, card) {
    var L = T[lang], date = card.getAttribute('data-date'), iN = N.daily.time.indexOf(date), iH = Hh ? Hh.daily.time.indexOf(date) : -1;
    if (iN < 0 || (Hh && iH < 0)) { el.innerHTML = '<span class="wxmeta">' + L.range + '</span>'; return; }
    var dN = N.daily, dH = Hh && Hh.daily, hs = hourStats(Hh || N, date), rows = [];
    var nightLink = '<a href="#map" class="focus" data-focus="' + esc(day.night.key) + '">' + esc(day.night.name) + '</a>';
    rows.push('<span><span class="wxk">' + (day.night.finish ? L.finish : L.night) + '</span> ' + nightLink + ' ' + Math.round(day.night.ele) + ' m: <b>' + Math.round(dN.temperature_2m_min[iN]) + '–' + Math.round(dN.temperature_2m_max[iN]) + ' °C</b>, ' + (L.codes[dN.weather_code[iN]] || dN.weather_code[iN]) + ' (' + L.feels + ' ' + Math.round(dN.apparent_temperature_min[iN]) + ' °C)</span>');
    if (dH) { var hiLink = '<a href="#map" class="focus" data-focus="' + (day.high.name ? esc('PASS · ' + day.high.name) : 'll:' + day.high.lat.toFixed(5) + ',' + day.high.lon.toFixed(5) + ':' + esc(L.high + ' ' + Math.round(day.high.ele) + ' m')) + '">' + (day.high.name ? esc(day.high.name) : L.high) + '</a>';
      rows.push('<span><span class="wxk">' + L.high + '</span> ' + hiLink + ' ' + Math.round(day.high.ele) + ' m: <b>' + Math.round(dH.temperature_2m_min[iH]) + '–' + Math.round(dH.temperature_2m_max[iH]) + ' °C</b>, ' + (L.codes[dH.weather_code[iH]] || dH.weather_code[iH]) + '</span>'); }
    var rain = Math.max(dN.precipitation_sum[iN], dH ? dH.precipitation_sum[iH] : 0), prob = Math.max(dN.precipitation_probability_max[iN] || 0, dH ? dH.precipitation_probability_max[iH] || 0 : 0);
    var gust = Math.max(dN.wind_gusts_10m_max[iN], dH ? dH.wind_gusts_10m_max[iH] : 0), uv = Math.max(dN.uv_index_max[iN], dH ? dH.uv_index_max[iH] : 0);
    rows.push('<span><span class="wxk">' + L.rain + '</span> ' + rain.toFixed(rain < 1 ? 1 : 0) + ' mm (' + prob + ' % ' + L.prob + ')</span>');
    rows.push('<span><span class="wxk">' + L.gusts + '</span> ' + Math.round(gust) + ' km/h</span>');
    rows.push('<span><span class="wxk">' + L.uv + '</span> ' + Math.round(uv) + '</span>');
    rows.push('<span><span class="wxk">' + L.sun + '</span> ' + dN.sunrise[iN].slice(11) + '–' + dN.sunset[iN].slice(11) + '</span>');
    var html = '<div class="wxrow">' + rows.join('') + '</div>';
    var ws = warnings(L, day, N, Hh, iN, iH, card);
    if (ws.length) html += '<div>' + ws.map(function (x) { return '<span class="wxwarn ' + x[1] + '">' + L.w[x[0]] + x[2] + ' <a class="wxsrc" target="_blank" rel="noopener" href="' + sourceUrl(day.high || day.night, date) + '">' + L.source + '</a></span>'; }).join('') + '</div>';
    var age = Math.round((Date.now() - meta.t) / 60000), ageTxt = age < 60 ? age + ' min' : Math.round(age / 60) + ' h';
    var leadDays = Math.round((new Date(date + 'T12:00:00').getTime() - Date.now()) / 864e5), leadTxt = leadDays > 4 ? ' · ' + leadDays + ' ' + L.lead + ', ' + L.lowconf : '';
    html += '<div class="wxmeta"><span class="wxfresh' + (age >= 360 ? ' old' : '') + '">' + L.fetched + (window.TREK && window.TREK.weatherModelLabel ? ' · ' + window.TREK.weatherModelLabel : '') + ' ' + meta.when + ' (' + ageTxt + ' ' + L.ago + (age >= 360 ? ', ' + L.stale : '') + (meta.stale ? ', ' + L.offline : '') + ')' + leadTxt + '</span> <button type="button" class="wxbtn" data-wx="refresh">' + L.refresh + '</button>' + (Hh ? ' <button type="button" class="wxbtn" data-wx="hourly">' + L.hourly + ' ▾</button>' : '') + '</div>';
    html += '<div class="wxhour" hidden><div class="wxslider"><label><span class="wxk">' + L.start + '</span> <output></output></label><input type="range" min="5.5" max="10" step="0.5"><span class="wxrec"></span></div><canvas></canvas><div class="wxread"></div><div class="wxevents"></div><div class="wxlegend">' + L.legend + ' · ' + L.rule + '</div></div>';
    el.innerHTML = html;
    var hourBox = el.querySelector('.wxhour'), canvas = hourBox.querySelector('canvas'), btn = el.querySelector('[data-wx="hourly"]');
    if (!btn) { hourBox.remove(); return; }
    var slider = hourBox.querySelector('input[type=range]'), out = hourBox.querySelector('output'), rec = hourBox.querySelector('.wxrec'), evBox = hourBox.querySelector('.wxevents'), read = hourBox.querySelector('.wxread');
    var samples = ctx.samples[day.n] || [], sIdx = ctx.index[day.n].samples || [], ens = ctx.ens && ctx.ens[day.n] || null, startH = plannedStart(day.n) || 8, best = null;
    function show(s) {
      if (!samples.length || !Hh) { canvas.hidden = true; return; }
      var sim = simulate(day, card, N, samples, sIdx, ctx.locs, date, s);
      out.textContent = fmtH(s) + ' → ' + L.arrive + ' ' + fmtH(sim.arrive) + (sim.arrive > sim.sunset ? ' (' + L.afterSunset + ')' : '') + ' · ' + sim.risk + ' ' + L.exposed;
      drawDay(canvas, L, day, sim, ens, date, N);
      evBox.innerHTML = sim.events.length ? '<div class="wxk">' + L.events + '</div>' + sim.events.slice(0, 6).map(function (e) { e.date = date; return '<div class="wxev ' + e.kind + (e.exposed ? ' exp' : '') + '">' + eventText(L, e) + '</div>'; }).join('') : '<div class="wxev ok">' + L.noevents + '</div>';
      read.textContent = (ens ? ens.members + ' ' + L.members + ' · ' : '') + ((window.TREK && window.TREK.weatherModelLabel) || 'Open-Meteo');
    }
    slider.value = startH; slider.addEventListener('input', function () { show(+slider.value); });
    btn.addEventListener('click', function () {
      hourBox.hidden = !hourBox.hidden; btn.textContent = hourBox.hidden ? L.hourly + ' ▾' : L.hide + ' ▴';
      if (!hourBox.hidden) { if (!best && samples.length && Hh) { best = recommendStart(day, card, N, samples, sIdx, ctx.locs, date); rec.textContent = L.recommend + ' ' + fmtH(best.start) + ' (' + best.sim.risk + ' ' + L.exposed + ')'; } show(+slider.value); }
    });
    window.addEventListener('resize', function () { if (!hourBox.hidden) show(+slider.value); });
  }

  /* ---- snapshot: one position fix, applied to the plan ---- */
  var ctx = { data: null, route: null, days: null, locs: null, index: null, meta: null, cards: [] };
  function cardsFor(n) { return ctx.cards.filter(function (c) { return +c.getAttribute('data-day') === n; }); }
  function setDone(n, done) { var d = lsGet(((window.TREK && window.TREK.slug) || 'trek') + '-done', {}); if (done) d[n] = 1; else delete d[n]; lsSet(((window.TREK && window.TREK.slug) || 'trek') + '-done', d); applyDone(); }
  function applyDone() {
    var d = lsGet(((window.TREK && window.TREK.slug) || 'trek') + '-done', {});
    ctx.cards.forEach(function (c) {
      var n = +c.getAttribute('data-day'), lang = c.closest('[lang]').getAttribute('lang'), L = T[lang].snap, isDone = !!d[n];
      c.classList.toggle('done', isDone);
      var bar = c.querySelector('.donebar');
      if (isDone && !bar) { bar = document.createElement('div'); bar.className = 'donebar'; bar.innerHTML = '<span class="donechip">✓ ' + L.done + '</span> <button type="button" data-done="show">' + L.show + '</button> <button type="button" data-done="undo">' + L.undo + '</button>'; c.querySelector('h3').insertAdjacentElement('afterend', bar);
        bar.querySelector('[data-done="show"]').addEventListener('click', function () { c.classList.toggle('open'); });
        bar.querySelector('[data-done="undo"]').addEventListener('click', function () { setDone(n, false); }); }
      if (!isDone && bar) { bar.remove(); c.classList.remove('open'); }
    });
  }
  function applySnapshot(pos) {
    var me = { lat: pos.coords.latitude, lon: pos.coords.longitude }, near = window.gr52Map.nearest(me), now = Date.now();
    var app = window.gr52Map.visibleApp(); if (app) { app.showPosition(me.lat, me.lon, pos.coords.accuracy); }
    var snaps = lsGet(((window.TREK && window.TREK.slug) || 'trek') + '-snaps', []); snaps.push({ t: now, lat: me.lat, lon: me.lon, d: near.pt.d, off: near.dist }); if (snaps.length > 50) snaps = snaps.slice(-50); lsSet(((window.TREK && window.TREK.slug) || 'trek') + '-snaps', snaps);
    document.querySelectorAll('.snapstatus').forEach(function (s) {
      var lang = s.closest('[lang]').getAttribute('lang'), L = T[lang].snap, day = null, text;
      if (near.dist > 20000) { s.textContent = L.far.replace('{km}', Math.round(near.dist / 1000)); return; }
      Object.keys(ctx.days).forEach(function (k) { var dd = ctx.days[k]; if (day == null && +k > 0 && near.pt.d <= dd.to + 50) day = dd; });
      if (!day) { s.textContent = L.after; return; }
      for (var k = 1; k < day.n; k++) setDone(k, true);
      var walked = Math.max(0, near.pt.d - day.from), left = Math.max(0, day.to - near.pt.d), asc = ascentBetween(ctx.route, near.pt.d, day.to);
      var card = cardsFor(day.n).filter(function (c) { return c.closest('[lang]').getAttribute('lang') === lang; })[0];
      var todaySnaps = snaps.filter(function (x) { return now - x.t < 12 * 3600e3 && x.off < 1500; }), pace = null, measured = false;
      if (todaySnaps.length >= 2) { var a = todaySnaps[0], b = todaySnaps[todaySnaps.length - 1]; if (b.t - a.t >= 20 * 60e3 && b.d > a.d) { pace = (b.d - a.d) / ((b.t - a.t) / 3600e3); measured = true; } }
      if (!pace && card) pace = Math.max(1000, (day.to - day.from) / plannedHours(card));
      var hrsLeft = left / pace + (measured ? asc / 600 : 0), eta = new Date(now + hrsLeft * 3600e3);
      var N = ctx.locs && ctx.index[day.n] ? ctx.locs[ctx.index[day.n].night] : null, dateStr = card ? card.getAttribute('data-date') : null, iN = N && dateStr ? N.daily.time.indexOf(dateStr) : -1;
      var ss = iN >= 0 ? N.daily.sunset[iN].slice(11) : null;
      text = L.taken + (pos.manual ? ' (' + L.manual + ')' : '') + ' ' + fmtHM(new Date(now)) + ' · ' + L.at.replace('{km}', (near.pt.d / 1000).toFixed(1)) + (near.dist > 150 ? ' (' + L.off + ' ' + Math.round(near.dist) + ' m)' : '') + ' · D' + day.n + ': ' + (walked / 1000).toFixed(1) + ' km ' + L.walked + ' · ' + (left / 1000).toFixed(1) + ' km ' + L.left + ' ' + day.night.name + ' · ' + L.ascent + ' +' + Math.round(asc) + ' m · ' + (measured ? L.pace + ' ' + (pace / 1000).toFixed(1) + ' km/h (' + L.measured + ') · ' : '') + L.eta + ' ' + fmtHM(eta) + (measured ? '' : ' (' + L.planned + ')') + (ss ? ' · ' + L.sunset + ' ' + ss : '') + (window.TREK && window.TREK.tentWindow && eta.getHours() < parseInt(window.TREK.tentWindow, 10) ? ' · ' + L.tent.replace('19:00', window.TREK.tentWindow) : '');
      s.textContent = text;
      if (card) { var box = card.querySelector('.snapbox') || document.createElement('div'); box.className = 'snapbox'; box.textContent = text; if (!box.parentNode) card.querySelector('.wx').insertAdjacentElement('beforebegin', box); }
    });
  }
  window.gr52PickOnMap = function () {
    var app = window.gr52Map.visibleApp(); if (!app) return;
    var lang = document.getElementById('he').hidden ? 'en' : 'he', L = T[lang].snap;
    app.box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelectorAll('.snapstatus').forEach(function (s) { s.textContent = L.pick; }); app.status.textContent = L.pick;
    app.pick(function (lat, lon) { app.status.textContent = ''; applySnapshot({ coords: { latitude: lat, longitude: lon, accuracy: 50 }, manual: true }); });
  };
  /* long-press on either "Where am I" button picks the position on the map instead of GPS.
     Cancel only on lift or drag: iOS fires pointercancel during a hold, which must not stop the timer. */
  (function () {
    var timer = null, fired = false, sx = 0, sy = 0, SEL = '[data-act="snapshot"],[data-act="locate"]';
    function down(x, y, target) { var b = target.closest && target.closest(SEL); if (!b) return; fired = false; sx = x; sy = y; clearTimeout(timer); timer = setTimeout(function () { fired = true; if (navigator.vibrate) navigator.vibrate(30); window.gr52PickOnMap(); }, 550); }
    function move(x, y) { if (timer && (Math.abs(x - sx) > 12 || Math.abs(y - sy) > 12)) { clearTimeout(timer); timer = null; } }
    function up() { clearTimeout(timer); timer = null; }
    if (window.PointerEvent) {
      document.addEventListener('pointerdown', function (e) { if (e.pointerType === 'mouse' && e.button !== 0) return; down(e.clientX, e.clientY, e.target); }, { passive: true });
      document.addEventListener('pointermove', function (e) { move(e.clientX, e.clientY); }, { passive: true });
      document.addEventListener('pointerup', up, { passive: true });
    } else {
      document.addEventListener('touchstart', function (e) { var t = e.touches[0]; down(t.clientX, t.clientY, e.target); }, { passive: true });
      document.addEventListener('touchmove', function (e) { var t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: true });
      document.addEventListener('touchend', up, { passive: true });
    }
    document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest(SEL); if (b && fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
    document.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest(SEL)) e.preventDefault(); });
  })();
  window.gr52Snapshot = function (fake) {
    if (!ctx.route) return;
    if (fake && fake.coords) return applySnapshot(fake);
    var L = T[document.getElementById('he').hidden ? 'en' : 'he'].snap;
    if (!navigator.geolocation) { document.querySelectorAll('.snapstatus').forEach(function (s) { s.textContent = L.noGeo; }); return; }
    navigator.geolocation.getCurrentPosition(applySnapshot, function (e) { document.querySelectorAll('.snapstatus').forEach(function (s) { s.textContent = e.message; }); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
  };

  /* ---- boot ---- */
  var tries = 0;
  function start() {
    var app = window.gr52Data; if (!app) { if (tries++ < 150) return setTimeout(start, 200); return; }
    ctx.data = app.data; ctx.route = app.route; ctx.days = dayPoints(app.data, app.route); window.gr52Days = ctx.days;
    ctx.cards = Array.prototype.slice.call(document.querySelectorAll('.stage[data-day]'));
    var points = [], index = {}; ctx.samples = {};
    Object.keys(ctx.days).forEach(function (n) {
      var d = ctx.days[n]; index[n] = { night: points.length }; points.push(d.night);
      if (d.high) {
        index[n].high = points.length; points.push(d.high);
        var el = ctx.route.pts.filter(function (p) { return p.d >= d.from && p.d <= d.to && p.ele != null; }).map(function (p) { return p.ele; });
        d.eleMin = Math.min.apply(null, el); d.eleMax = Math.max.apply(null, el);
        var hp = null; ctx.route.pts.forEach(function (p) { if (hp == null && p.d >= d.from && p.d <= d.to && p.ele === d.high.ele) hp = p.d; }); d.high.d = hp;
        ctx.samples[n] = daySamples(ctx.route, d); index[n].samples = ctx.samples[n].map(function (s) { points.push(s); return points.length - 1; });
      }
    });
    ctx.index = index;

    document.querySelectorAll('[data-act="snapshot"]').forEach(function (b) { b.addEventListener('click', function () { window.gr52Snapshot(); }); });
    applyDone();
    var els = Array.prototype.slice.call(document.querySelectorAll('.wx'));
    var dates = ctx.cards.map(function (c) { return c.getAttribute('data-date'); }).sort();
    var today = new Date().toISOString().slice(0, 10), horizon = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
    var startDate = dates[0] < today ? today : dates[0], endDate = dates[dates.length - 1] > horizon ? horizon : dates[dates.length - 1];
    function paint(locs, meta) {
      ctx.locs = locs; ctx.meta = meta;
      els.forEach(function (el) {
        var card = el.closest('.stage'), n = +card.getAttribute('data-day'), lang = card.closest('[lang]').getAttribute('lang');
        if (!ctx.days[n]) return;
        render(el, lang, ctx.days[n], locs[index[n].night], index[n].high != null ? locs[index[n].high] : null, meta, card);
        el.querySelector('[data-wx="refresh"]').addEventListener('click', load);
      });
    }
    function load() {
      var cached = lsGet(((window.TREK && window.TREK.slug) || 'trek') + '-wx', null);
      if (startDate > endDate) { els.forEach(function (el) { el.innerHTML = '<span class="wxmeta">' + T[el.closest('[lang]').getAttribute('lang')].range + '</span>'; }); return; }
      var highs = Object.keys(ctx.days).filter(function (n) { return ctx.days[n].high; }), ensPts = highs.map(function (n) { return ctx.days[n].high; });
      Promise.all([fetchForecast(points, startDate, endDate), fetchEnsemble(ensPts, startDate, endDate).catch(function () { return null; })]).then(function (r) {
        var locs = r[0], ens = {}; if (r[1]) highs.forEach(function (n, k) { ens[n] = r[1][k]; });
        var t = Date.now(), when = fmtHM(new Date(t)) + ' ' + new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        ctx.ens = ens; lsSet(((window.TREK && window.TREK.slug) || 'trek') + '-wx', { t: t, when: when, locs: locs, ens: ens }); paint(locs, { t: t, when: when });
      }).catch(function () {
        if (cached) { ctx.ens = cached.ens || {}; paint(cached.locs, { t: cached.t, when: cached.when, stale: true }); }

        else els.forEach(function (el) { el.innerHTML = '<span class="wxmeta">' + T[el.closest('[lang]').getAttribute('lang')].err + '</span>'; });
      });
    }
    load();
    setInterval(function () { if (ctx.locs && ctx.meta) paint(ctx.locs, ctx.meta); }, 10 * 60e3);
  }
  start();
})();
