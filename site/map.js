/* Trek map app: draws the real GPX, elevation profile, position, offline tiles. Config in window.TREK.
   trip.js (the plan page) and log.js (the log pages) build on it through window.gr52Map and the
   trek:gpx and trek:scope events.
   One map per language. It lives in whichever host claims it: a day's Map tab (scoped to that day's
   stretch) or the whole-route host in the Maps section. The position fix is one state drawn twice,
   as a dot on the map and a dot on the profile, so the two can never disagree. */
(function () {
  'use strict';
  var TREK = window.TREK || {}; var GPX = TREK.gpx || '/route.gpx';
  var TILES = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
  var ME = '#1E6FD9';
  var I18N = {
    en: {
      nights: 'Nights, refuges, finish', water: 'Water', passes: 'Passes and summits', side: 'Side-trip summits',
      ferrata: 'Via ferrata points', escape: 'Escapes, bus, emergency', other: 'Shelters, campsites, lakes',
      save: 'Save this view offline', saveRoute: 'Save whole route offline',
      saving: 'Saving tiles', saved: 'Saved for offline: ', tilesTooMany: 'Too many tiles for one save (max 1500).',
      offRoute: 'off route', toNext: 'to', ascent: 'ascent',
      descent: 'descent', total: 'Route', day: 'Day', km: 'km', m: 'm', offline: 'Offline: page, GPX and saved tiles are available.',
      alt: 'alt', loading: 'Loading GPX…', retry: 'retry in', ready: 'GPX loaded: ', tracks: 'tracks', wpts: 'waypoints',
      me: 'Your position', back: '← Back to', top: 'the top'
    },
    he: {
      nights: 'לילות, בקתות, סיום', water: 'מים', passes: 'מעברים ופסגות', side: 'פסגות סטיות צד',
      ferrata: 'נקודות ויה פראטה', escape: 'יציאות, אוטובוס, חירום', other: 'מחסות, קמפינגים, אגמים',
      save: 'שמור תצוגה זו לאופליין', saveRoute: 'שמור את כל המסלול לאופליין',
      saving: 'שומר אריחים', saved: 'נשמר לאופליין: ', tilesTooMany: 'יותר מדי אריחים לשמירה אחת (מקסימום 1500).',
      offRoute: 'מחוץ למסלול', toNext: 'עד', ascent: 'עלייה',
      descent: 'ירידה', total: 'המסלול', day: 'יום', km: 'ק"מ', m: 'מ\'', offline: 'אופליין: הדף, ה-GPX והאריחים השמורים זמינים.',
      alt: 'גובה', loading: 'טוען GPX…', retry: 'ניסיון נוסף בעוד', ready: 'GPX נטען: ', tracks: 'מסלולים', wpts: 'נקודות',
      me: 'המיקום שלכם', back: '→ חזרה אל', top: 'ראש הדף'
    }
  };
  var CAT = { Night: 'nights', Flag: 'nights', Lodging: 'nights', Restaurant: 'nights', Water: 'water', Summit: 'passes',
    SideTrip: 'side', ViaFerrata: 'ferrata', Escape: 'escape', Transport: 'escape', Info: 'escape', Campsite: 'other', Shelter: 'other' };
  var DEFAULT_ON = { nights: true, water: true };
  /* Glyphs for the OsmAnd icon names the GPX carries (24 × 24, drawn white on the waypoint colour). */
  var ICONS = {
    amenity_drinking_water: '<path d="M12 2.5C9 7 5.5 10.6 5.5 14.5a6.5 6.5 0 0 0 13 0c0-3.9-3.5-7.5-6.5-12z"/>',
    tourism_camp_site: '<path fill-rule="evenodd" d="M12 3 1.5 21h21L12 3zm0 6.2L17.6 19H6.4L12 9.2z"/>',
    tourism_alpine_hut: '<path d="M12 3 2.5 11h2.5v10h5v-6h4v6h5V11h2.5L12 3z"/>',
    natural_peak: '<path d="M13.5 5.5 10 12 8 9.5 1.5 20h21L13.5 5.5z"/>',
    special_flag_finish: '<path d="M5 2h2.2v20H5V2zm3.2 2H19l-2.6 4.2L19 12.5H8.2V4z"/>',
    special_information: '<path d="M10.4 6h3.2v3h-3.2V6zm0 4.5h3.2V18h-3.2v-7.5z"/>',
    highway_bus_stop: '<path fill-rule="evenodd" d="M4 5.5A3.5 3.5 0 0 1 7.5 2h9A3.5 3.5 0 0 1 20 5.5V16a2 2 0 0 1-1 1.7V20a1.2 1.2 0 0 1-2.4 0v-1.5H7.4V20A1.2 1.2 0 0 1 5 20v-2.3A2 2 0 0 1 4 16V5.5zM6.5 6v6h11V6h-11zm1.3 8.2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm8.4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>',
    amenity_shelter: '<path d="M12 3 1 12.5h3.5V21h2.2v-8.5h10.6V21h2.2v-8.5H23L12 3z"/>',
    sport_climbing: '<path fill-rule="evenodd" d="M9 3a5 5 0 0 0-5 5v8a5 5 0 0 0 5 5h6a5 5 0 0 0 5-5V8a5 5 0 0 0-5-5H9zm0 2.6h6A2.4 2.4 0 0 1 17.4 8v8a2.4 2.4 0 0 1-2.4 2.4H9A2.4 2.4 0 0 1 6.6 16V8A2.4 2.4 0 0 1 9 5.6z"/><path d="M13.6 5h3.2v9h-3.2z"/>'
  };

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
      var color = text(w, 'osmand:color');
      return { lat: +w.getAttribute('lat'), lon: +w.getAttribute('lon'), name: text(w, 'name'), type: text(w, 'type'),
        color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6B7775', icon: text(w, 'osmand:icon'), bg: text(w, 'osmand:background') };
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
  function climb(route, d0, d1) {
    var asc = 0, desc = 0, last = null;
    route.pts.forEach(function (p) {
      if (p.d < d0 || p.d > d1 || p.ele == null) return;
      if (last == null) { last = p.ele; return; }
      var dz = p.ele - last;
      if (Math.abs(dz) >= 10) { if (dz > 0) asc += dz; else desc -= dz; last = p.ele; }
    });
    return { ascent: asc, descent: desc };
  }

  function shortTrackName(name) {
    var parts = name.split(' · ');
    return parts.length > 2 ? parts[0] + ' · ' + parts[1] : name;
  }
  function markerFor(w, c) {
    var glyph = ICONS[w.icon];
    if (!glyph) return L.circleMarker([w.lat, w.lon], { radius: c === 'nights' ? 7 : 5, color: '#fff', weight: 1.5, fillColor: w.color, fillOpacity: 1 });
    var s = c === 'nights' ? 26 : 22, bg = /^(circle|square|octagon)$/.test(w.bg) ? w.bg : 'circle';
    return L.marker([w.lat, w.lon], { keyboard: false, icon: L.divIcon({ className: 'wpi', iconSize: [s, s], iconAnchor: [s / 2, s / 2], popupAnchor: [0, -s / 2],
      html: '<span class="wpico ' + bg + '" style="background:' + w.color + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + glyph + '</svg></span>' }) });
  }

  var data = null, route = null, apps = {}, boxes = {}, me = null, pendingClaim = null, pendingFocus = null, NIGHTS = [];
  /* days: NIGHT n-1 to NIGHT n along the walking line (day 1 from the start, the last day to FINISH) */
  function dayRange(n) {
    var from = n === 1 ? 0 : null, to = null;
    NIGHTS.forEach(function (x) {
      if (x.w.name.indexOf('NIGHT ' + (n - 1) + ' ') === 0 && from == null) from = x.d;
      if (x.w.name.indexOf('NIGHT ' + n + ' ') === 0 || x.w.name.indexOf('FINISH') === 0 && !NIGHTS.some(function (y) { return y.w.name.indexOf('NIGHT ' + n + ' ') === 0; })) to = x.d;
    });
    if (from == null) from = 0; if (to == null) to = route.length;
    return { from: from, to: to };
  }
  function nightOf(n) { var w = null; NIGHTS.forEach(function (x) { if (!w && x.w.name.indexOf('NIGHT ' + n + ' ') === 0) w = x.w; }); return w; }
  function norm(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  function build(container) {
    var lang = container.getAttribute('data-map');
    if (apps[lang]) return apps[lang];
    var T = I18N[lang];
    var mapEl = container.querySelector('.livemap');
    var status = container.querySelector('.mapstatus');
    var canRotate = typeof L.Map.prototype.setBearing === 'function', coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    /* fingers do the zooming and turning on a phone; the compass appears once the map is turned, to reset north */
    var opts = { scrollWheelZoom: false, zoomSnap: 0.5, zoomControl: !coarse };
    if (canRotate) { opts.rotate = true; opts.touchRotate = true; opts.dragRotate = true; opts.shiftKeyRotate = true; opts.rotateControl = { position: 'topleft', behavior: 'reset', closeOnZeroBearing: true }; }
    var map = L.map(mapEl, opts);
    /* points that must sit exactly on a spot are markers in the marker pane: the rotation plugin keeps
       that pane upright and re-places its markers on every turn; a custom pane would be left behind */
    function pin(ll, cls, size, z) { return L.marker(ll, { icon: L.divIcon({ className: cls, iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2], html: '' }), zIndexOffset: z, keyboard: false }); }
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
      markerFor(w, c).bindPopup(w.name).addTo(cats[c]);
    });
    ['nights', 'water', 'passes', 'side', 'ferrata', 'escape', 'other'].forEach(function (c) {
      if (!cats[c]) return; overlays[T[c]] = cats[c]; if (DEFAULT_ON[c]) cats[c].addTo(map);
    });
    var layersCtl = L.control.layers(null, overlays, { collapsed: true }).addTo(map);
    map.fitBounds(routeGroup.getBounds(), { padding: [12, 12] });

    var nights = NIGHTS;

    /* scope: null for the whole route, or a day number; sets the profile range and the highlighted stretch */
    var scope = null, scopeLayer = null, range = { from: 0, to: route.length };
    var statsEl = container.querySelector('.profstats');
    function stats() {
      var c = climb(route, range.from, range.to);
      statsEl.textContent = (scope == null ? T.total : T.day + ' ' + scope) + ' ' + ((range.to - range.from) / 1000).toFixed(1) + ' ' + T.km + ' · ' + T.ascent + ' ' + Math.round(c.ascent) + ' ' + T.m + ' · ' + T.descent + ' ' + Math.round(c.descent) + ' ' + T.m + (TREK.elevation ? ' · ' + TREK.elevation : '');
    }
    function setScope(n, fit) {
      scope = n;
      if (scopeLayer) { map.removeLayer(scopeLayer); scopeLayer = null; }
      var r = n == null ? { from: 0, to: route.length } : dayRange(n);
      if (n != null && r.to - r.from < 200) {
        /* an arrival or rest day: nothing to walk, show where you sleep */
        range = { from: 0, to: route.length };
        var w = nightOf(n) || route.pts[0];
        if (fit) map.setView([w.lat, w.lon], Math.max(map.getZoom(), 13));
      } else {
        range = r;
        if (n != null) {
          scopeLayer = L.polyline(route.pts.filter(function (p) { return p.d >= r.from && p.d <= r.to; }).map(function (p) { return [p.lat, p.lon]; }), { color: ME, weight: 9, opacity: .45, interactive: false }).addTo(map);
          if (fit) map.fitBounds(scopeLayer.getBounds(), { padding: [20, 20] });
        } else if (fit) map.fitBounds(routeGroup.getBounds(), { padding: [12, 12] });
      }
      stats(); drawProfile(null);
      container.dispatchEvent(new CustomEvent('trek:scope', { bubbles: true, detail: { lang: lang, scope: scope, map: map, range: range } }));
    }

    /* elevation profile of the current scope; the position dot is drawn from the same state as the map marker */
    var canvas = container.querySelector('canvas.profile'), hoverMarker = null, marks = [], markPos = [];
    function drawProfile(hoverX) {
      var dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
      if (!W || !H) return;
      canvas.width = W * dpr; canvas.height = H * dpr;
      var ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.direction = 'ltr';  /* axis labels lay out the same in the RTL page */
      var cs = getComputedStyle(document.documentElement);
      var ink = cs.getPropertyValue('--ink').trim(), muted = cs.getPropertyValue('--muted').trim(), line = cs.getPropertyValue('--line').trim(),
        mark = cs.getPropertyValue('--mark').trim(), lake = cs.getPropertyValue('--lake').trim(), soft = cs.getPropertyValue('--lake-soft').trim();
      var from = range.from, to = range.to, span = Math.max(1, to - from), pts = route.pts.filter(function (p) { return p.d >= from && p.d <= to && p.ele != null; });
      var lo = Infinity, hi = -Infinity; pts.forEach(function (p) { if (p.ele < lo) lo = p.ele; if (p.ele > hi) hi = p.ele; });
      if (!isFinite(lo)) { lo = 0; hi = 500; }
      var minE = Math.floor(lo / 500) * 500, maxE = Math.max(minE + 500, Math.ceil(hi / 500) * 500), eStep = maxE - minE > 1500 ? 1000 : 500;
      var kStep = span > 60000 ? 20 : span > 25000 ? 10 : span > 12000 ? 5 : 2;
      var L0 = 44, R0 = 10, T0 = 12, B0 = 24;
      var x = function (d) { return L0 + (d - from) / span * (W - L0 - R0); }, y = function (e) { return T0 + (1 - (e - minE) / (maxE - minE)) * (H - T0 - B0); };
      ctx.clearRect(0, 0, W, H);
      ctx.font = '11px IBM Plex Mono, monospace'; ctx.fillStyle = muted; ctx.strokeStyle = line; ctx.lineWidth = 1;
      for (var e = minE; e <= maxE; e += eStep) (function (e) { ctx.beginPath(); ctx.moveTo(L0, y(e)); ctx.lineTo(W - R0, y(e)); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(e + ' ' + T.m, L0 - 6, y(e) + 4); })(e);
      for (var k = 0; k * 1000 <= span; k += kStep) { ctx.textAlign = 'center'; ctx.fillText(k + ' ' + T.km, x(from + k * 1000), H - 8); }
      function trace() { ctx.beginPath(); pts.forEach(function (p, i) { if (i) ctx.lineTo(x(p.d), y(p.ele)); else ctx.moveTo(x(p.d), y(p.ele)); }); }
      if (pts.length) {
        trace(); ctx.lineTo(x(pts[pts.length - 1].d), y(minE)); ctx.lineTo(x(pts[0].d), y(minE)); ctx.closePath(); ctx.fillStyle = soft; ctx.fill();
        trace(); ctx.strokeStyle = lake; ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.font = '500 11px IBM Plex Sans, sans-serif';
      var ns = nights.filter(function (n) { return n.d >= from - 1 && n.d <= to + 1; });
      ns.forEach(function (n, i) {
        var px = x(n.d), py = y(n.ele == null ? minE : n.ele);
        ctx.beginPath(); ctx.arc(px, py, 4.5, 0, 7); ctx.fillStyle = mark; ctx.fill();
        ctx.fillStyle = ink; ctx.textAlign = i === ns.length - 1 ? 'right' : i === 0 ? 'left' : 'center';
        ctx.fillText(n.w.name.split(' · ')[0].replace('NIGHT ', 'N'), px, py - 9);
      });
      markPos = [];
      marks.forEach(function (m) {
        if (m.d < from || m.d > to) return;
        var px = x(m.d), py = y(m.ele == null ? minE : m.ele) - 11; markPos.push({ x: px, y: py, m: m });
        ctx.beginPath(); ctx.arc(px, py, 7, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = m.color || mark; ctx.lineWidth = m.est ? 1.5 : 2; if (m.est) ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, py + 7); ctx.lineTo(px, y(m.ele == null ? minE : m.ele)); ctx.strokeStyle = m.color || mark; ctx.stroke();
        if (m.label) { ctx.fillStyle = m.color || mark; ctx.font = '700 9px IBM Plex Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText(m.label, px, py + 3); ctx.font = '500 11px IBM Plex Sans, sans-serif'; }
        else { ctx.fillStyle = m.color || mark; ctx.fillRect(px - 3.5, py - 2.5, 7, 5); }
      });
      if (me && me.near && me.near.pt.d >= from && me.near.pt.d <= to) {
        var mx = x(me.near.pt.d), my = y(me.near.pt.ele == null ? minE : me.near.pt.ele);
        ctx.beginPath(); ctx.arc(mx, my, 6.5, 0, 7); ctx.fillStyle = ME; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
      }
      if (hoverX != null) {
        var d = from + Math.max(0, Math.min(1, (hoverX - L0) / (W - L0 - R0))) * span, a = 0, b = route.pts.length - 1;
        while (a < b) { var mid = (a + b) >> 1; if (route.pts[mid].d < d) a = mid + 1; else b = mid; }
        var p = route.pts[a];
        ctx.strokeStyle = mark; ctx.beginPath(); ctx.moveTo(x(d), T0); ctx.lineTo(x(d), H - B0); ctx.stroke();
        ctx.fillStyle = ink; ctx.textAlign = x(d) > W / 2 ? 'right' : 'left';
        ctx.fillText(((d - from) / 1000).toFixed(1) + ' ' + T.km + ' · ' + (p.ele == null ? '' : p.ele + ' ' + T.m), x(d) + (x(d) > W / 2 ? -6 : 6), T0 + 12);
        if (!hoverMarker) hoverMarker = pin([p.lat, p.lon], 'hoverpin', 16, 900).addTo(map);
        else hoverMarker.setLatLng([p.lat, p.lon]);
      }
    }
    function hover(ev) { var r = canvas.getBoundingClientRect(); var cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left; drawProfile(cx); if (ev.touches) ev.preventDefault(); }
    canvas.addEventListener('mousemove', hover); canvas.addEventListener('touchstart', hover, { passive: false }); canvas.addEventListener('touchmove', hover, { passive: false });
    canvas.addEventListener('mouseleave', function () { drawProfile(null); if (hoverMarker) { map.removeLayer(hoverMarker); hoverMarker = null; } });
    canvas.addEventListener('click', function (ev) {
      var r = canvas.getBoundingClientRect(), cx = ev.clientX - r.left, cy = ev.clientY - r.top, hit = null;
      markPos.forEach(function (p) { if (Math.hypot(p.x - cx, p.y - cy) < 14 && (!hit || Math.hypot(p.x - cx, p.y - cy) < Math.hypot(hit.x - cx, hit.y - cy))) hit = p; });
      if (hit && hit.m.onClick) hit.m.onClick(hit.m);
    });
    stats(); drawProfile(null);
    window.addEventListener('resize', function () { drawProfile(null); });

    /* the position snapshot: the map dot and the profile dot are both drawn from `me` */
    var meMarker = null, meCircle = null;
    function refreshMe() {
      if (!me) return;
      var ll = [me.lat, me.lon];
      if (!meMarker) {
        meMarker = pin(ll, 'mepin', 18, 1000).bindPopup(T.me).addTo(map);
        meCircle = L.circle(ll, { radius: me.acc || 30, weight: 1, color: ME, fillOpacity: .08, interactive: false }).addTo(map);
      } else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(me.acc || 30); }
      drawProfile(null);
    }
    function panToMe() {
      if (!me) return;
      var ll = L.latLng(me.lat, me.lon);
      if (!map.getBounds().pad(-0.15).contains(ll)) map.setView(ll, Math.max(map.getZoom(), 13));
    }
    map.on('locationerror', function (e) { status.textContent = e.message; });

    /* offline tiles: a corridor along the whole route */
    function tileXY(lat, lon, z) {
      var n = Math.pow(2, z), r = lat * Math.PI / 180;
      return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)];
    }
    function tileUrl(z, x, y) { return TILES.replace('{s}', 'abc'[(x + y) % 3]).replace('{z}', z).replace('{x}', x).replace('{y}', y); }
    /* Tiles go straight into the 'tiles' cache the service worker reads, so a save works even before
       the worker controls the page. Three at a time, already-saved tiles are skipped. */
    function saveTiles(urls, btn) {
      if (urls.length > 1500) { status.textContent = T.tilesTooMany + ' (' + urls.length + ')'; return; }
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      var done = 0, failed = 0, i = 0, active = 0; btn.disabled = true;
      function one(u) {
        if (window.caches) return caches.open('tiles').then(function (c) { return c.match(u, { ignoreVary: true }).then(function (hit) { return hit ? null : c.add(u); }); });
        return fetch(u, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); });
      }
      function finish() { status.textContent = T.saved + (urls.length - failed) + (failed ? ' (' + failed + ' failed)' : ''); btn.disabled = false; }
      (function next() {
        while (active < 3 && i < urls.length) {
          (function (u) {
            active++;
            one(u).catch(function () { failed++; }).then(function () {
              active--; done++;
              if (done % 10 === 0) status.textContent = T.saving + ' ' + done + '/' + urls.length;
              if (done >= urls.length) finish(); else setTimeout(next, 20);
            });
          })(urls[i++]);
        }
      })();
    }
    var routeBtn = container.querySelector('[data-act="saveroute"]');
    routeBtn.textContent = T.saveRoute;
    routeBtn.addEventListener('click', function () {
      var seen = {}, urls = [];
      /* z12–15 one tile around the line, z16 the tiles it crosses: a day's map zoomed in stays readable */
      [12, 13, 14, 15, 16].forEach(function (z) {
        var pad = z >= 16 ? 0 : 1;
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

    /* transient focus: a place, a track, a coordinate, or a day (which also scopes the map) */
    var highlight = null;
    function clearHighlight() { if (highlight) { map.removeLayer(highlight); highlight = null; } }
    function focus(q) {
      clearHighlight();
      var mLL = /^ll:(-?[\d.]+),(-?[\d.]+)(?::(.*))?$/.exec(q);
      if (mLL) {
        var ll0 = [+mLL[1], +mLL[2]];
        map.setView(ll0, Math.max(map.getZoom(), 14));
        highlight = pin(ll0, 'focusring', 36, 800).addTo(map);
        if (mLL[3]) highlight.bindPopup(mLL[3]).openPopup();
        return true;
      }
      var mDay = /^day:(\d+)$/.exec(q);
      if (mDay) { setScope(+mDay[1], true); return true; }
      var nq = norm(q), w = null;
      data.wpts.forEach(function (x) { if (!w && norm(x.name).indexOf(nq) >= 0) w = x; });
      if (w) {
        var c = CAT[w.type] || 'other'; if (cats[c] && !map.hasLayer(cats[c])) cats[c].addTo(map);
        map.setView([w.lat, w.lon], Math.max(map.getZoom(), 14));
        cats[c].eachLayer(function (l) { if (l.getLatLng && l.getLatLng().lat === w.lat && l.getLatLng().lng === w.lon) l.openPopup(); });
        highlight = pin([w.lat, w.lon], 'focusring', 36, 800).addTo(map);
        return true;
      }
      var t = null; data.tracks.forEach(function (x) { if (!t && norm(x.name).indexOf(nq) >= 0) t = x; });
      if (t) {
        var g = overlays[shortTrackName(t.name)]; if (g && !map.hasLayer(g)) g.addTo(map);
        var fg = L.featureGroup(); g.eachLayer(function (l) { fg.addLayer(l); });
        map.fitBounds(fg.getBounds(), { padding: [20, 20] });
        highlight = L.polyline(t.segs.map(function (s) { return s.map(function (p) { return [p.lat, p.lon]; }); }), { color: ME, weight: 9, opacity: .35 }).addTo(map);
        return true;
      }
      return false;
    }
    map.on('click', clearHighlight);
    function pick(cb) { mapEl.style.cursor = 'crosshair'; map.once('click', function (e) { mapEl.style.cursor = ''; cb(e.latlng.lat, e.latlng.lng); }); }

    /* hosts: the box moves into whichever day tab or section claims it */
    var host = container.parentNode;
    function claim(h) {
      var n = h.getAttribute('data-host') === 'all' ? null : +h.getAttribute('data-host');
      if (h !== host) { h.appendChild(container); host.classList.add('empty'); h.classList.remove('empty'); host = h; }
      map.invalidateSize();
      if (scope !== n) setScope(n, true); else drawProfile(null);
    }
    apps[lang] = { map: map, focus: focus, pick: pick, box: container, status: status, claim: claim, refreshMe: refreshMe, panToMe: panToMe,
      redraw: function () { map.invalidateSize(); drawProfile(null); }, hostEl: function () { return host; }, scope: function () { return scope; },
      setMarks: function (list) { marks = list || []; drawProfile(null); },
      addOverlay: function (name, layer, on) { layersCtl.addOverlay(layer, name); if (on) layer.addTo(map); } };
    refreshMe();
    return apps[lang];
  }

  function visibleLang() { var w = document.querySelector('.wrap[lang]:not([hidden])'); return w ? w.getAttribute('lang') : null; }
  function langOf(el) { var w = el.closest('[lang]'); return w ? w.getAttribute('lang') : visibleLang(); }
  function allHost(lang) { return document.querySelector('#' + lang + ' .maphost[data-host="all"]'); }
  function appFor(lang) { var box = boxes[lang]; return box && data && box.offsetParent !== null ? build(box) : (apps[lang] || null); }
  function inView(el) {
    var r = el.getBoundingClientRect(), h = window.innerHeight || document.documentElement.clientHeight;
    return r.height > 0 && Math.min(r.bottom, h) - Math.max(r.top, 0) >= r.height * 0.6;
  }
  /* move the language's map box into a host (a day's Map tab or the whole-route section) and scope it */
  function claimHost(h) {
    if (!h) return null;
    if (!data) { pendingClaim = h; return null; }
    var lang = langOf(h), box = boxes[lang]; if (!box) return null;
    var cur = box.parentNode;
    if (cur !== h) { h.appendChild(box); cur.classList.add('empty'); h.classList.remove('empty'); }
    if (box.offsetParent === null) return apps[lang] || null;
    var app = build(box); app.claim(h); return app;
  }
  function showTab(stage, name) {
    if (stage.classList.contains('done')) stage.classList.add('open');  /* a finished day is collapsed; a tab click means show it */
    stage.querySelectorAll('.tabs [data-tab]').forEach(function (b) { var on = b.getAttribute('data-tab') === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    stage.querySelectorAll('.pane').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== name; });
    if (name === 'map') claimHost(stage.querySelector('.maphost'));
    if (name === 'wx') stage.dispatchEvent(new CustomEvent('trek:wxshown', { bubbles: true }));
  }
  function stageOf(lang, n) { return document.querySelector('#' + lang + ' .stage[data-day="' + n + '"]'); }
  /* open a day's Map tab in the visible language, scroll to it, then focus q inside it */
  function openDay(n, q) {
    var lang = visibleLang(), stage = stageOf(lang, n);
    if (!stage) return focusAll(q);
    if (stage.classList.contains('done')) stage.classList.add('open');
    showTab(stage, 'map');
    stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var app = apps[lang];
    if (app && q && q !== 'day:' + n) setTimeout(function () { app.redraw(); app.focus(q); }, 250);
  }
  function focusAll(q) {
    var lang = visibleLang(), h = allHost(lang); if (!h) return;
    claimHost(h);
    h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var app = apps[lang];
    if (app && q) setTimeout(function () { app.redraw(); app.focus(q); }, 250);
  }
  function focusVisible(q, origin) {
    if (!data) { pendingFocus = [q, origin]; return; }
    var mDay = /^day:(\d+)$/.exec(q);
    if (mDay) return openDay(+mDay[1], q);
    var stage = typeof origin === 'number' ? stageOf(visibleLang(), origin) : origin && origin.closest ? origin.closest('.stage[data-day]') : null;
    if (stage) return openDay(+stage.getAttribute('data-day'), q);
    focusAll(q);
  }
  function visible() {
    Object.keys(boxes).forEach(function (lang) { var b = boxes[lang]; if (b.offsetParent !== null) build(b).redraw(); });
  }

  document.querySelectorAll('.mapbox').forEach(function (b) { boxes[b.getAttribute('data-map')] = b; b.querySelector('.mapstatus').textContent = I18N[b.getAttribute('data-map')].loading; });
  /* the GPX is the whole app's data: keep trying on a bad signal, with a growing pause, until it is here */
  (function loadGpx(attempt) {
    fetch(GPX).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }).then(function (t) {
      var d = parseGpx(t), r = buildRoute(d.tracks);
      if (!r.pts.length) throw new Error('no route in GPX');
      data = d; route = r; window.gr52Data = { data: data, route: route };
      NIGHTS = data.wpts.filter(function (w) { return (w.type === 'Night' || w.type === 'Flag') && !/FALLBACK|option/.test(w.name); })
        .map(function (w) { var n = nearestOnRoute(route, w); return { w: w, d: n.pt.d, ele: n.pt.ele }; }).sort(function (a, b) { return a.d - b.d; });
      document.querySelectorAll('.mapstatus').forEach(function (s) { var T = I18N[s.closest('.mapbox').getAttribute('data-map')]; s.textContent = T.ready + data.tracks.length + ' ' + T.tracks + ', ' + data.wpts.length + ' ' + T.wpts + (navigator.onLine ? '' : ' · ' + T.offline); });
      visible();
      if (pendingClaim) { var h = pendingClaim; pendingClaim = null; claimHost(h); }
      if (pendingFocus) { var q = pendingFocus; pendingFocus = null; focusVisible(q[0], q[1]); } else fromUrl();
      document.dispatchEvent(new CustomEvent('trek:gpx'));
    }).catch(function (e) {
      var wait = Math.min(30000, 1000 * Math.pow(2, attempt));
      document.querySelectorAll('.mapstatus').forEach(function (s) { var T = I18N[s.closest('.mapbox').getAttribute('data-map')]; s.textContent = T.loading + ' (' + (e && e.message || e) + ' · ' + T.retry + ' ' + Math.round(wait / 1000) + ' s)'; });
      setTimeout(function () { loadGpx(attempt + 1); }, wait);
    });
  })(0);
  var btn = document.getElementById('langbtn'); if (btn) btn.addEventListener('click', function () { setTimeout(visible, 30); });
  window.gr52Focus = focusVisible;
  window.gr52Map = {
    visibleApp: function () { return appFor(visibleLang()); },
    nearest: function (p) { return route ? nearestOnRoute(route, p) : null; },
    dayRange: function (n) { return route ? dayRange(n) : null; }, nightOf: nightOf, nights: function () { return NIGHTS; },
    dayStats: function (n) { if (!route) return null; var r = dayRange(n), c = climb(route, r.from, r.to); return { km: (r.to - r.from) / 1000, ascent: c.ascent, descent: c.descent }; },
    showTab: showTab, openDay: openDay, hav: hav, app: function (lang) { return apps[lang] || null; },
    /* the route point nearest to a waypoint or track name, or at a distance along the route */
    routePointAt: function (d) { if (!route) return null; var a = 0, b = route.pts.length - 1; while (a < b) { var mid = (a + b) >> 1; if (route.pts[mid].d < d) a = mid + 1; else b = mid; } return route.pts[a]; },
    findPlace: function (q) { if (!data) return null; var nq = norm(q), w = null; data.wpts.forEach(function (x) { if (!w && norm(x.name).indexOf(nq) >= 0) w = x; }); return w ? nearestOnRoute(route, w) : null; },
    /* one position for every map and profile */
    showPosition: function (lat, lon, acc) {
      if (!route) return;
      me = { lat: lat, lon: lon, acc: acc, near: nearestOnRoute(route, { lat: lat, lon: lon }) };
      Object.keys(apps).forEach(function (k) { apps[k].refreshMe(); });
    },
    /* bring the map with the position into view: the day you are on, or the whole route */
    reveal: function (n) {
      var lang = visibleLang(), app = appFor(lang), box = boxes[lang]; if (!box) return;
      var cur = box.parentNode.getAttribute('data-host'), onScreen = box.offsetParent !== null && inView(box.querySelector('.livemap'));
      var keep = onScreen && (cur === 'all' || n == null || +cur === n);
      if (!keep) { if (n != null && stageOf(lang, n)) openDay(n); else focusAll(null); }
      setTimeout(function () { var a = apps[lang]; if (a) { a.redraw(); a.panToMe(); } }, keep ? 0 : 300);
    },
    /* make sure the visible language's map is on screen (for picking a position on it) */
    ensureVisible: function () {
      var lang = visibleLang(), box = boxes[lang]; if (!box) return null;
      var h = box.parentNode, stage = h.closest('.stage');
      if (box.offsetParent === null) { if (stage) { if (stage.classList.contains('done')) stage.classList.add('open'); showTab(stage, 'map'); } else claimHost(allHost(lang)); }
      (stage || h).scrollIntoView({ behavior: 'smooth', block: 'start' });
      return apps[lang] || null;
    }
  };
  /* ---- navigation: a map link becomes ?map=<q>&from=<where you were>, with a bubble that takes you back ---- */
  var lastFrom = null, pushed = 0;
  function whereAmI(origin) {
    var st = origin && origin.closest ? origin.closest('.stage[data-day]') : null;
    if (st) { var on = st.querySelector('.tabs .on'); return 'd' + st.getAttribute('data-day') + (on ? ':' + on.getAttribute('data-tab') : ''); }
    var y = origin && origin.getBoundingClientRect ? origin.getBoundingClientRect().top : 0, best = null, bestY = -Infinity;
    document.querySelectorAll('.wrap:not([hidden]) h2[id], .wrap:not([hidden]) .stage[data-day]').forEach(function (h) { var t = h.getBoundingClientRect().top; if (t <= y + 1 && t > bestY) { best = h; bestY = t; } });
    return best ? (best.id || 'd' + best.getAttribute('data-day')) : 'top';
  }
  function labelFor(from) {
    var lang = visibleLang(), T = I18N[lang], m = /^d(\d+)(?::(\w+))?$/.exec(from);
    if (m) { var st = stageOf(lang, +m[1]), tab = m[2] && st ? st.querySelector('.tabs [data-tab="' + m[2] + '"]') : null; return T.day + ' ' + m[1] + (tab ? ' · ' + tab.textContent.replace(/\d+\s*$/, '').trim() : ''); }
    var el = from !== 'top' ? document.getElementById(from) : null;
    return el ? el.textContent.replace(/^§\d+/, '').trim().slice(0, 40) : T.top;
  }
  function restore(from) {
    var lang = visibleLang(), m = /^d(\d+)(?::(\w+))?$/.exec(from);
    if (m) { var st = stageOf(lang, +m[1]); if (!st) return; if (m[2] && st.querySelector('.tabs [data-tab="' + m[2] + '"]')) showTab(st, m[2]); st.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (from === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    var el = document.getElementById(from); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function bubble(from) { var b = document.getElementById('backbubble'); if (!b) return; if (!from) { b.hidden = true; return; } b.textContent = I18N[visibleLang()].back + ' ' + labelFor(from); b.hidden = false; }
  function dayOf(origin) { var st = origin && origin.closest ? origin.closest('.stage[data-day]') : null; return st ? +st.getAttribute('data-day') : null; }
  function go(q, origin) {
    var from = whereAmI(origin), u = new URL(location.href);
    u.searchParams.set('map', q); u.searchParams.set('from', from); u.hash = '';
    history.pushState({ map: q, from: from, day: dayOf(origin) }, '', u); pushed++;
    lastFrom = from; bubble(from);
    focusVisible(q, origin);
  }
  function back() {
    if (pushed > 0) { history.back(); return; }
    var from = lastFrom, u = new URL(location.href); lastFrom = null; bubble(null);
    u.searchParams.delete('map'); u.searchParams.delete('from'); history.replaceState(null, '', u);
    if (from) restore(from);
  }
  window.addEventListener('popstate', function (e) {
    if (pushed > 0) pushed--;
    var s = e.state;
    if (s && s.map) { lastFrom = s.from; bubble(s.from); focusVisible(s.map, s.day != null ? s.day : null); }
    else { var from = lastFrom; lastFrom = null; bubble(null); if (from) restore(from); }
  });
  function fromUrl() {
    var u = new URL(location.href), q = u.searchParams.get('map'), from = u.searchParams.get('from'), h = decodeURIComponent(location.hash || '');
    if (!q && h.indexOf('#map=') === 0) q = h.slice(5);
    if (!q) return;
    lastFrom = from || null; bubble(lastFrom);
    var m = /^d(\d+)/.exec(from || '');
    focusVisible(q, m ? +m[1] : null);
  }
  var bb = document.getElementById('backbubble'); if (bb) bb.addEventListener('click', back);
  /* swipe sideways on a day card to move between its tabs; the map and sliders keep their own gestures */
  (function () {
    var sx = 0, sy = 0, stage = null;
    document.addEventListener('touchstart', function (e) {
      var t = e.target; stage = null;
      if (!t.closest || t.closest('.livemap, input, canvas, #lightbox')) return;
      stage = t.closest('.stage[data-day]'); if (!stage) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (!stage) return;
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy, st = stage; stage = null;
      if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
      var tabs = Array.prototype.slice.call(st.querySelectorAll('.tabs [data-tab]')), i = tabs.findIndex(function (b) { return b.classList.contains('on'); });
      var rtl = getComputedStyle(st).direction === 'rtl', step = (dx < 0 ? 1 : -1) * (rtl ? -1 : 1), j = i + step;
      if (j < 0 || j >= tabs.length) return;
      showTab(st, tabs[j].getAttribute('data-tab'));
    }, { passive: true });
  })();
  window.gr52Nav = { go: go, back: back };
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var a = e.target.closest('a[data-focus]');
    if (a) { e.preventDefault(); e.stopPropagation(); go(a.getAttribute('data-focus'), a); return; }
    var tab = e.target.closest('.tabs [data-tab]');
    if (tab) { showTab(tab.closest('.stage'), tab.getAttribute('data-tab')); return; }
    var c = e.target.closest('.mapclaim');
    if (c) claimHost(c.closest('.maphost'));
  }, true);
  window.addEventListener('hashchange', fromUrl);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
})();
