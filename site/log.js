/* Trip log page: pictures by day (a two-column grid, inline in the text, dots on the day's map and on
   the elevation profile, a lightbox), weather history per day from the Open-Meteo archive, and
   upload. Builds on map.js (window.gr52Map, the trek:gpx and trek:scope events). Config in
   window.LOG (user, days with dates and time anchors, per-picture overrides) and window.TREK.
   A picture without coordinates is placed on the route by its time, between the day's anchors. */
(function () {
  'use strict';
  var LOG = window.LOG || {}, TREK = window.TREK || {}, USER = LOG.user || 'me', BASE = '/log/' + USER + '/photos/', ORIG = '/log/' + USER + '/orig/', UPLOAD = '/log/' + USER + '/upload';
  var T = {
    en: { none: 'No pictures for this day yet.', onMap: 'Show on map', est: 'place estimated from the time', night: 'night spot', high: 'high point', rain: 'rain', gusts: 'gusts', sun: 'sun',
      source: 'ERA5 reanalysis via Open-Meteo', hourly: 'hour by hour at the high point: temperature, bars rain mm', uploading: 'Uploading', done: 'done', failed: 'failed', taken: 'taken', photo: 'picture', download: 'Download',
      codes: { 0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'showers', 81: 'showers', 82: 'heavy showers', 85: 'snow showers', 86: 'snow showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail' } },
    he: { none: 'עדיין אין תמונות ליום הזה.', onMap: 'הצג במפה', est: 'המיקום משוער לפי השעה', night: 'לינה', high: 'נקודה גבוהה', rain: 'גשם', gusts: 'משבים', sun: 'שמש',
      source: 'ריאנליזה ERA5 דרך Open-Meteo', hourly: 'שעה אחר שעה בנקודה הגבוהה: טמפרטורה, עמודות גשם מ"מ', uploading: 'מעלה', done: 'הועלה', failed: 'נכשל', taken: 'צולם', photo: 'תמונה', download: 'הורדה',
      codes: { 0: 'בהיר', 1: 'בהיר ברובו', 2: 'מעונן חלקית', 3: 'מעונן', 45: 'ערפל', 48: 'ערפל קפוא', 51: 'טפטוף קל', 53: 'טפטוף', 55: 'טפטוף כבד', 56: 'טפטוף קפוא', 57: 'טפטוף קפוא', 61: 'גשם קל', 63: 'גשם', 65: 'גשם כבד', 66: 'גשם קפוא', 67: 'גשם קפוא', 71: 'שלג קל', 73: 'שלג', 75: 'שלג כבד', 77: 'גרגרי שלג', 80: 'ממטרים', 81: 'ממטרים', 82: 'ממטרים כבדים', 85: 'ממטרי שלג', 86: 'ממטרי שלג', 95: 'סופת רעמים', 96: 'סופת רעמים עם ברד', 99: 'סופת רעמים עם ברד' } }
  };
  var photos = [], byId = {}, over = LOG.photos || {}, DAYS = LOG.days || {}, clusters = {}, layers = {};
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function langOf(el) { var w = el.closest('[lang]'); return w ? w.getAttribute('lang') : 'en'; }
  function visibleLang() { var w = document.querySelector('.wrap[lang]:not([hidden])'); return w ? w.getAttribute('lang') : 'en'; }
  function dayOf(p) {
    var o = over[p.id]; if (o && o.day != null) return o.day;
    var d = (p.taken || '').slice(0, 10), n = null;
    Object.keys(DAYS).forEach(function (k) { if (DAYS[k].date === d) n = +k; });
    return n;
  }
  function caption(p, lang) { var o = over[p.id] || {}, c = o.caption; if (c && typeof c === 'object') c = c[lang] || c.en || c.he; return c || p.caption || ''; }
  function when(p) { return p.taken ? p.taken.slice(11, 16) : ''; }
  function tile(p, lang) {
    var c = caption(p, lang);
    return '<a class="tile" href="' + BASE + esc(p.file) + '" data-photo="' + esc(p.id) + '"' + (p.w && p.h ? ' style="aspect-ratio:' + p.w + '/' + p.h + '"' : '') + '><img src="' + BASE + esc(p.thumb) + '" alt="' + esc(c) + '" loading="lazy">' + (c || when(p) ? '<span>' + esc(c || when(p)) + '</span>' : '') + '</a>';
  }

  /* ---- where a picture was taken: its own coordinates, an override, or the route at that time ---- */
  function hm(s) { var m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? +m[1] + m[2] / 60 : null; }
  function anchorsFor(n) {
    var G = window.gr52Map, r = G.dayRange(n); if (!r || r.to - r.from < 200) return null;
    var list = ((DAYS[n] || {}).anchors || []).map(function (a) {
      var t = hm(a.time), d = a.at === 'start' ? r.from : a.at === 'end' ? r.to : a.at != null && a.km != null ? null : null;
      if (a.km != null) d = r.from + a.km * 1000;
      else if (a.at && a.at !== 'start' && a.at !== 'end') { var f = G.findPlace(a.at); d = f ? Math.max(r.from, Math.min(r.to, f.pt.d)) : null; }
      return t != null && d != null ? { t: t, d: d } : null;
    }).filter(Boolean).sort(function (a, b) { return a.t - b.t; });
    if (!list.length) list = [{ t: (TREK.plannedStart || 8), d: r.from }, { t: (TREK.plannedStart || 8) + 9, d: r.to }];
    if (list.length === 1) list.push(list[0].d > (r.from + r.to) / 2 ? { t: list[0].t - 8, d: r.from } : { t: list[0].t + 8, d: r.to });
    return { range: r, list: list };
  }
  function place(p) {
    var o = over[p.id] || {};
    if (o.lat != null && o.lon != null) return { lat: o.lat, lon: o.lon, d: window.gr52Map.nearest(o).pt.d, est: false };
    if (p.lat != null && p.lon != null) return { lat: p.lat, lon: p.lon, d: window.gr52Map.nearest(p).pt.d, est: false };
    var n = dayOf(p), t = hm((p.taken || '').slice(11)); if (n == null || t == null) return null;
    var A = anchorsFor(n); if (!A) return null;
    var L0 = A.list, d;
    if (t <= L0[0].t) d = L0[0].d; else if (t >= L0[L0.length - 1].t) d = L0[L0.length - 1].d;
    else { for (var i = 1; i < L0.length; i++) if (t <= L0[i].t) { var a = L0[i - 1], b = L0[i]; d = a.d + (b.d - a.d) * (t - a.t) / (b.t - a.t); break; } }
    var pt = window.gr52Map.routePointAt(d);
    return pt ? { lat: pt.lat, lon: pt.lon, d: pt.d, ele: pt.ele, est: true } : null;
  }

  /* ---- galleries: two columns filled by height, so different shapes leave no holes ---- */
  function grid(list, lang) {
    var cols = [[], []], h = [0, 0];
    list.forEach(function (p) { var k = h[0] <= h[1] ? 0 : 1; cols[k].push(tile(p, lang)); h[k] += p.w && p.h ? p.h / p.w : 0.75; });
    return '<div class="col">' + cols[0].join('') + '</div><div class="col">' + cols[1].join('') + '</div>';
  }
  function render() {
    document.querySelectorAll('.gallery').forEach(function (g) {
      var lang = langOf(g), key = g.getAttribute('data-day'), list = photos.filter(function (p) { var d = dayOf(p); return key === 'none' ? d == null : d === +key; });
      g._list = list;
      g.innerHTML = list.length ? grid(list, lang) : (key === 'none' ? '' : '<p class="muted">' + T[lang].none + '</p>');
      var sec = g.closest('.undated'); if (sec) sec.hidden = !list.length;
      var badge = g.closest('.stage') && g.closest('.stage').querySelector('[data-tab="pics"] .badge'); if (badge) { badge.textContent = list.length ? String(list.length) : ''; badge.hidden = !list.length; }
    });
    document.querySelectorAll('.photoref').forEach(function (s) {
      var p = byId[s.getAttribute('data-photo')]; if (!p) { s.innerHTML = ''; return; }
      var lang = langOf(s), c = caption(p, lang);
      s.innerHTML = '<a class="inpic" href="' + BASE + esc(p.file) + '" data-photo="' + esc(p.id) + '"><img src="' + BASE + esc(p.thumb) + '" alt="' + esc(c) + '" loading="lazy">' + (c ? '<span>' + esc(c) + '</span>' : '') + '</a>';
    });
    Object.keys(layers).forEach(function (lang) { rebuildDots(lang); });
  }

  /* ---- dots: one per group of pictures within 150 m, on the map and on the profile ---- */
  function hav(a, b) { return window.gr52Map.hav(a, b); }
  function clusterize(list) {
    var out = [];
    list.forEach(function (p) {
      var c = null; out.forEach(function (x) { if (!c && hav(x, p.pos) < 150) c = x; });
      if (c) { c.items.push(p); c.lat = c.items.reduce(function (s, q) { return s + q.pos.lat; }, 0) / c.items.length; c.lon = c.items.reduce(function (s, q) { return s + q.pos.lon; }, 0) / c.items.length; c.d = c.items.reduce(function (s, q) { return s + q.pos.d; }, 0) / c.items.length; c.est = c.est && p.pos.est; }
      else out.push({ lat: p.pos.lat, lon: p.pos.lon, d: p.pos.d, ele: p.pos.ele, est: p.pos.est, items: [p] });
    });
    return out;
  }
  function rebuildDots(lang) {
    var L0 = layers[lang]; if (!L0 || !window.gr52Data) return;
    L0.group.clearLayers();
    var list = [];
    photos.forEach(function (p) { if (L0.scope != null && dayOf(p) !== L0.scope) return; var pos = place(p); if (pos) list.push({ p: p, pos: pos }); });
    var marks = [];
    clusterize(list).forEach(function (c, k) {
      var id = lang + '-' + (L0.scope == null ? 'all' : L0.scope) + '-' + k, items = c.items.map(function (x) { return x.p; }); clusters[id] = items;
      var m = L.marker([c.lat, c.lon], { icon: L.divIcon({ className: 'photodot' + (c.est ? ' est' : ''), html: '<span>' + (items.length > 1 ? items.length : '') + '</span>', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14] }), zIndexOffset: 700, keyboard: false });
      m.bindPopup('<div class="popthumbs">' + items.map(function (p) { return '<a href="' + BASE + esc(p.file) + '" data-photo="' + esc(p.id) + '" data-cluster="' + id + '"><img src="' + BASE + esc(p.thumb) + '" alt=""></a>'; }).join('') + '</div>', { maxWidth: 260 });
      L0.group.addLayer(m);
      var pt = window.gr52Map.nearest({ lat: c.lat, lon: c.lon }).pt;
      marks.push({ d: pt.d, ele: pt.ele, est: c.est, label: items.length > 1 ? String(items.length) : '', onClick: function () { open(items, 0); } });
    });
    var app = window.gr52Map.app(lang); if (app) app.setMarks(marks);
  }
  document.addEventListener('trek:scope', function (e) {
    var d = e.detail;
    if (!layers[d.lang]) layers[d.lang] = { group: L.layerGroup().addTo(d.map), scope: d.scope };
    layers[d.lang].scope = d.scope;
    rebuildDots(d.lang);
  });

  /* ---- lightbox: arrows, keys, swipe sideways, swipe down to close, download ---- */
  var lb = document.getElementById('lightbox'), cur = { list: [], i: 0 };
  function show(i) {
    var p = cur.list[i]; if (!p) return; cur.i = i;
    var lang = visibleLang(), c = caption(p, lang), pos = place(p);
    lb.querySelector('img').src = BASE + p.file;
    var dl = lb.querySelector('.lbdl'); dl.href = p.orig ? ORIG + p.orig : BASE + p.file; dl.setAttribute('download', p.orig ? (p.name || p.orig) : (p.id + '.jpg')); dl.title = T[lang].download;
    lb.querySelector('.lbcap').innerHTML = (c ? esc(c) + ' · ' : '') + (p.taken ? T[lang].taken + ' ' + esc(p.taken.replace('T', ' ').slice(0, 16)) : '')
      + (pos ? ' · <a href="?map=ll:' + pos.lat.toFixed(5) + ',' + pos.lon.toFixed(5) + '" class="focus" data-go="ll:' + pos.lat.toFixed(5) + ',' + pos.lon.toFixed(5) + ':' + esc(c || T[lang].photo) + '" data-day="' + (dayOf(p) == null ? '' : dayOf(p)) + '">' + T[lang].onMap + '</a>' + (pos.est ? ' (' + T[lang].est + ')' : '') : '');
    lb.querySelector('.lbn').textContent = (i + 1) + ' / ' + cur.list.length;
    lb.querySelector('[data-lb="prev"]').disabled = i === 0; lb.querySelector('[data-lb="next"]').disabled = i === cur.list.length - 1;
    var pre = cur.list[i + 1]; if (pre) { var img = new Image(); img.src = BASE + pre.file; }
  }
  function open(list, i) { cur.list = list; lb.hidden = false; document.body.classList.add('lbopen'); show(i); }
  function close() { lb.hidden = true; document.body.classList.remove('lbopen'); }
  if (lb) {
    lb.addEventListener('click', function (e) {
      if (e.target.closest('[data-lb="prev"]')) return show(cur.i - 1);
      if (e.target.closest('[data-lb="next"]')) return show(cur.i + 1);
      if (e.target.closest('.lbdl')) return;
      var g = e.target.closest('a[data-go]');
      if (g) { /* close first, then navigate from the picture's day so its map opens */
        e.preventDefault(); close();
        var lang = visibleLang(), st = g.getAttribute('data-day') !== '' ? document.querySelector('#' + lang + ' .stage[data-day="' + g.getAttribute('data-day') + '"]') : null;
        if (window.gr52Nav) window.gr52Nav.go(g.getAttribute('data-go'), st || g);
        return;
      }
      if (e.target.closest('[data-lb="close"]') || e.target === lb) close();
    });
    document.addEventListener('keydown', function (e) { if (lb.hidden) return; if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') show(cur.i + 1); if (e.key === 'ArrowLeft') show(cur.i - 1); });
    var sx = 0, sy = 0, st0 = 0;
    lb.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; st0 = Date.now(); }, { passive: true });
    lb.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dy) < Math.abs(dx)) { var rtl = getComputedStyle(document.documentElement).direction === 'rtl'; show(cur.i + (dx < 0 ? 1 : -1) * (rtl ? -1 : 1)); }
      else if (dy > 90 && Math.abs(dx) < 60 && Date.now() - st0 < 600) close();
    }, { passive: true });
  }
  /* capture phase: Leaflet stops clicks inside popups before they reach the document */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-photo]'); if (!a || !lb) return;
    e.preventDefault(); e.stopPropagation();
    var id = a.getAttribute('data-photo'), list;
    if (a.getAttribute('data-cluster')) list = clusters[a.getAttribute('data-cluster')] || [byId[id]];
    else { var st = a.closest('.stage'), g = st ? st.querySelector('.gallery') : a.closest('.gallery'); list = (g && g._list && g._list.length) ? g._list : [byId[id]]; }
    var i = 0; list.forEach(function (p, k) { if (p.id === id) i = k; });
    open(list, i);
  }, true);

  /* ---- weather history: the night spot and the day's high point on that date (ERA5) ---- */
  var ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function dayGeometry(n) {
    var G = window.gr52Map, D = window.gr52Data; if (!D) return null;
    var night = G.nightOf(n) || (n === 0 ? null : G.nights().filter(function (x) { return /^FINISH/.test(x.w.name); }).map(function (x) { return x.w; })[0]);
    if (!night) return null;
    var pts = [{ lat: night.lat, lon: night.lon, ele: night.ele != null ? night.ele : (G.nearest(night).pt.ele || 0) }];
    var r = G.dayRange(n);
    if (r && r.to - r.from > 200) { var hi = null; D.route.pts.forEach(function (p) { if (p.d >= r.from && p.d <= r.to && p.ele != null && (!hi || p.ele > hi.ele)) hi = p; }); if (hi) pts.push({ lat: hi.lat, lon: hi.lon, ele: hi.ele }); }
    return pts;
  }
  function dropWx(box) { var st = box.closest('.stage'), tab = st.querySelector('[data-tab="wx"]'); if (tab && tab.classList.contains('on')) window.gr52Map.showTab(st, 'pics'); if (tab) tab.remove(); box.closest('.pane').remove(); }
  function drawHours(canvas, loc, date) {
    var hs = []; loc.hourly.time.forEach(function (t, i) { if (t.indexOf(date) === 0) hs.push({ h: +t.slice(11, 13), temp: loc.hourly.temperature_2m[i], rain: loc.hourly.precipitation[i] || 0 }); });
    var dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight; if (!W || !hs.length) return;
    canvas.width = W * dpr; canvas.height = H * dpr; var c = canvas.getContext('2d'); c.scale(dpr, dpr); c.direction = 'ltr';
    var cs = getComputedStyle(document.documentElement), ink = cs.getPropertyValue('--ink').trim(), muted = cs.getPropertyValue('--muted').trim(), line = cs.getPropertyValue('--line').trim(), lake = cs.getPropertyValue('--lake').trim();
    var L0 = 34, R0 = 30, T0 = 8, B0 = 18, temps = hs.map(function (r) { return r.temp; }).filter(function (v) { return v != null; });
    var tMin = Math.floor(Math.min.apply(null, temps) / 5) * 5 - 5, tMax = Math.ceil(Math.max.apply(null, temps) / 5) * 5 + 5, pMax = Math.max(2, Math.max.apply(null, hs.map(function (r) { return r.rain; })));
    var x = function (h) { return L0 + h / 23 * (W - L0 - R0); }, y = function (t) { return T0 + (1 - (t - tMin) / (tMax - tMin)) * (H - T0 - B0); }, yP = function (p) { return H - B0 - p / pMax * (H - T0 - B0) * 0.6; };
    c.clearRect(0, 0, W, H); c.strokeStyle = line; c.fillStyle = muted; c.font = '10px IBM Plex Mono, monospace'; c.lineWidth = 1;
    for (var h = 0; h <= 23; h += 3) { c.beginPath(); c.moveTo(x(h), T0); c.lineTo(x(h), H - B0); c.stroke(); c.textAlign = 'center'; c.fillText(h + ':00', x(h), H - 5); }
    c.textAlign = 'right'; c.fillText(tMax + '°', L0 - 4, y(tMax) + 4); c.fillText(tMin + '°', L0 - 4, y(tMin) + 4); c.textAlign = 'left'; c.fillText(pMax.toFixed(0) + ' mm', W - R0 + 4, yP(pMax) + 4);
    hs.forEach(function (r) { if (r.rain > 0) { c.fillStyle = lake; c.globalAlpha = .55; c.fillRect(x(r.h) - 3, yP(r.rain), 6, H - B0 - yP(r.rain)); c.globalAlpha = 1; } });
    c.beginPath(); var started = false; hs.forEach(function (r) { if (r.temp == null) return; if (!started) { c.moveTo(x(r.h), y(r.temp)); started = true; } else c.lineTo(x(r.h), y(r.temp)); }); c.strokeStyle = ink; c.lineWidth = 1.6; c.stroke();
  }
  function renderWx(box, locs, pts, date) {
    var lang = langOf(box), L0 = T[lang], N = locs[0], H = locs[1], iN = N.daily.time.indexOf(date);
    if (iN < 0 || N.daily.temperature_2m_max[iN] == null) return false;
    function row(k, loc, ele) { var i = loc.daily.time.indexOf(date); return '<span><span class="wxk">' + k + '</span> ' + Math.round(ele) + ' m: <b>' + Math.round(loc.daily.temperature_2m_min[i]) + '–' + Math.round(loc.daily.temperature_2m_max[i]) + ' °C</b>, ' + (L0.codes[loc.daily.weather_code[i]] || loc.daily.weather_code[i] || '') + '</span>'; }
    var rows = [row(L0.night, N, pts[0].ele)];
    if (H) rows.push(row(L0.high, H, pts[1].ele));
    var src = H || N, i = src.daily.time.indexOf(date);
    rows.push('<span><span class="wxk">' + L0.rain + '</span> ' + (src.daily.precipitation_sum[i] || 0).toFixed(1) + ' mm</span>');
    rows.push('<span><span class="wxk">' + L0.gusts + '</span> ' + Math.round(src.daily.wind_gusts_10m_max[i] || 0) + ' km/h</span>');
    if (N.daily.sunrise && N.daily.sunrise[iN]) rows.push('<span><span class="wxk">' + L0.sun + '</span> ' + N.daily.sunrise[iN].slice(11) + '–' + N.daily.sunset[iN].slice(11) + '</span>');
    box.innerHTML = '<div class="wxrow">' + rows.join('') + '</div><canvas class="wxhist"></canvas><div class="wxlegend">' + L0.hourly + ' · ' + L0.source + '</div>';
    var cv = box.querySelector('canvas'); function draw() { if (cv.clientWidth) drawHours(cv, src, date); }
    draw(); box.closest('.stage').addEventListener('trek:wxshown', draw); window.addEventListener('resize', draw);
    return true;
  }
  function weather() {
    document.querySelectorAll('.wxh[data-day]').forEach(function (box) {
      var n = +box.getAttribute('data-day'), date = box.closest('.stage').getAttribute('data-date'), pts = dayGeometry(n);
      if (!pts || !date) { dropWx(box); return; }
      var key = (TREK.slug || 'trek') + '-logwx-' + n + '-' + date, cached = lsGet(key);
      function paint(locs) { if (!renderWx(box, locs, pts, date)) dropWx(box); }
      if (cached) { paint(cached); return; }
      var u = ARCHIVE + '?latitude=' + pts.map(function (p) { return p.lat.toFixed(4); }).join(',') + '&longitude=' + pts.map(function (p) { return p.lon.toFixed(4); }).join(',') + '&elevation=' + pts.map(function (p) { return Math.round(p.ele); }).join(',')
        + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max,sunrise,sunset&hourly=temperature_2m,precipitation&timezone=' + encodeURIComponent(TREK.timezone || 'auto') + '&wind_speed_unit=kmh&start_date=' + date + '&end_date=' + date;
      fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) { var locs = Array.isArray(j) ? j : [j]; if (locs[0].daily.temperature_2m_max[0] != null) lsSet(key, locs); paint(locs); }).catch(function () { dropWx(box); });
    });
  }

  /* ---- upload: straight to /log/<user>/upload, one file at a time, then the index is re-read ---- */
  document.querySelectorAll('.upload input[type=file]').forEach(function (input) {
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files), list = input.closest('.upload').querySelector('.uplist'), lang = langOf(input), k = 0;
      (function next() {
        if (k >= files.length) { loadIndex().then(render); return; }
        var f = files[k++], row = document.createElement('div'); row.textContent = f.name + ' · ' + T[lang].uploading + ' 0 %'; list.appendChild(row);
        var fd = new FormData(); fd.append('photo', f, f.name);
        var xhr = new XMLHttpRequest(); xhr.open('POST', UPLOAD);
        xhr.upload.onprogress = function (e) { if (e.lengthComputable) row.textContent = f.name + ' · ' + T[lang].uploading + ' ' + Math.round(e.loaded / e.total * 100) + ' %'; };
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) { try { JSON.parse(xhr.responseText).forEach(add); } catch (e) { } row.textContent = f.name + ' · ' + T[lang].done; render(); }
          else row.textContent = f.name + ' · ' + T[lang].failed + ' (' + xhr.status + ' ' + xhr.responseText.slice(0, 80) + ')';
          next();
        };
        xhr.onerror = function () { row.textContent = f.name + ' · ' + T[lang].failed; next(); };
        xhr.send(fd);
      })();
      input.value = '';
    });
  });
  function add(p) { if (!p || !p.id) return; if (byId[p.id]) photos.splice(photos.indexOf(byId[p.id]), 1); byId[p.id] = p; photos.push(p); photos.sort(function (a, b) { return (a.taken || '9') < (b.taken || '9') ? -1 : 1; }); }
  function loadIndex() {
    return fetch(BASE + 'index.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; })
      .then(function (list) { photos = []; byId = {}; (Array.isArray(list) ? list : []).forEach(add); });
  }

  /* ---- boot ---- */
  loadIndex().then(render);
  function onGpx() { weather(); render(); }
  if (window.gr52Data) onGpx(); else document.addEventListener('trek:gpx', onGpx);
})();
