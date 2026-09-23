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
      source: 'ERA5 reanalysis via Open-Meteo', hourly: 'hour by hour at the high point: temperature, bars rain mm', uploading: 'Uploading', done: 'done', failed: 'failed', retry: 'again…', skipped: 'already here', taken: 'taken', photo: 'picture', photos: 'pictures', layer: 'Pictures', zoomIn: 'zoom in for the pictures', download: 'Download',
      edit: 'Edit', save: 'Save', cancel: 'Cancel', saved: 'saved', saveFail: 'could not save', editHint: 'A blank line ends a paragraph. [[photo:ID]] places a picture, [[map:Name|label]] links the map, [[gmaps:Place|label]] opens Google Maps.', keyPrompt: 'This log asks for an edit key:',
      inGmaps: 'Open in Google Maps', openUrl: 'Open the site', addPic: 'Add a picture…', pickHint: 'Tap a picture to put it at the cursor; the outlined ones are already in the text.', addLog: 'Add to the log', removeLog: 'Remove from the log', hide: 'Hide picture', unhide: 'Show picture', cover: 'Use as the cover', uncover: 'Remove from the cover', captionEdit: 'Edit caption', captionPrompt: 'Caption', hidden: 'hidden', noText: 'This day has no text yet; the picture goes into a new paragraph.',
      codes: { 0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'showers', 81: 'showers', 82: 'heavy showers', 85: 'snow showers', 86: 'snow showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail' } },
    he: { none: 'עדיין אין תמונות ליום הזה.', onMap: 'הצג במפה', est: 'המיקום משוער לפי השעה', night: 'לינה', high: 'נקודה גבוהה', rain: 'גשם', gusts: 'משבים', sun: 'שמש',
      source: 'ריאנליזה ERA5 דרך Open-Meteo', hourly: 'שעה אחר שעה בנקודה הגבוהה: טמפרטורה, עמודות גשם מ"מ', uploading: 'מעלה', done: 'הועלה', failed: 'נכשל', retry: 'מנסה שוב…', skipped: 'כבר כאן', taken: 'צולם', photo: 'תמונה', photos: 'תמונות', layer: 'תמונות', zoomIn: 'התקרבו כדי לראות את התמונות', download: 'הורדה',
      edit: 'עריכה', save: 'שמירה', cancel: 'ביטול', saved: 'נשמר', saveFail: 'השמירה נכשלה', editHint: 'שורה ריקה מסיימת פסקה. [[photo:ID]] מציב תמונה, [[map:שם|כיתוב]] מקשר למפה, [[gmaps:מקום|כיתוב]] פותח ב-Google Maps.', keyPrompt: 'היומן הזה מבקש מפתח עריכה:',
      inGmaps: 'פתיחה ב-Google Maps', openUrl: 'פתיחת האתר', addPic: 'הוספת תמונה…', pickHint: 'הקישו על תמונה כדי להציב אותה במקום הסמן; המסומנות כבר בטקסט.', addLog: 'הוספה ליומן', removeLog: 'הסרה מהיומן', hide: 'הסתרת התמונה', unhide: 'הצגת התמונה', cover: 'שימוש כתמונת השער', uncover: 'הסרה מתמונת השער', captionEdit: 'עריכת כיתוב', captionPrompt: 'כיתוב', hidden: 'מוסתרות', noText: 'ליום הזה עוד אין טקסט; התמונה תיכנס לפסקה חדשה.',
      codes: { 0: 'בהיר', 1: 'בהיר ברובו', 2: 'מעונן חלקית', 3: 'מעונן', 45: 'ערפל', 48: 'ערפל קפוא', 51: 'טפטוף קל', 53: 'טפטוף', 55: 'טפטוף כבד', 56: 'טפטוף קפוא', 57: 'טפטוף קפוא', 61: 'גשם קל', 63: 'גשם', 65: 'גשם כבד', 66: 'גשם קפוא', 67: 'גשם קפוא', 71: 'שלג קל', 73: 'שלג', 75: 'שלג כבד', 77: 'גרגרי שלג', 80: 'ממטרים', 81: 'ממטרים', 82: 'ממטרים כבדים', 85: 'ממטרי שלג', 86: 'ממטרי שלג', 95: 'סופת רעמים', 96: 'סופת רעמים עם ברד', 99: 'סופת רעמים עם ברד' } }
  };
  var photos = [], hiddenPics = [], byId = {}, over = LOG.photos || {}, DAYS = LOG.days || {}, clusters = {}, layers = {};
  var EDITS = { days: {}, photos: {} }, EDITS_URL = BASE + 'edits.json', EDIT_URL = '/log/' + USER + '/edit';
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
  function colsFor(g) { return g.clientWidth > 700 ? 3 : 2; }
  function grid(list, lang, n) {
    var cols = [], h = [];
    for (var i = 0; i < n; i++) { cols.push([]); h.push(0); }
    list.forEach(function (p) { var k = 0; h.forEach(function (v, i) { if (v < h[k]) k = i; }); cols[k].push(tile(p, lang)); h[k] += p.w && p.h ? p.h / p.w : 0.75; });
    return cols.map(function (c) { return '<div class="col">' + c.join('') + '</div>'; }).join('');
  }
  var relayout = null;
  window.addEventListener('resize', function () { clearTimeout(relayout); relayout = setTimeout(function () { var changed = false; document.querySelectorAll('.gallery').forEach(function (g) { if (g._cols && g._cols !== colsFor(g) && g._list && g._list.length) changed = true; }); if (changed) render(); }, 200); });
  function render() {
    document.querySelectorAll('.gallery').forEach(function (g) {
      var lang = langOf(g), key = g.getAttribute('data-day'), list = photos.filter(function (p) { var d = dayOf(p); return key === 'none' ? d == null : d === +key; });
      g._list = list; g._cols = colsFor(g);
      g.style.gridTemplateColumns = 'repeat(' + g._cols + ',1fr)';
      var hid = hiddenPics.filter(function (p) { var d = dayOf(p); return key === 'none' ? d == null : d === +key; });
      g.innerHTML = (list.length ? grid(list, lang, g._cols) : (key === 'none' ? '' : '<p class="muted">' + T[lang].none + '</p>'))
        + (hid.length ? '<details class="hiddenpics"><summary>' + hid.length + ' ' + T[lang].hidden + '</summary><div class="gallery hid">' + hid.map(function (p) { return tile(p, lang).replace('class="tile"', 'class="tile hid"'); }).join('') + '</div></details>' : '');
      var sec = g.closest('.undated'); if (sec) sec.hidden = !list.length;
      var badge = g.closest('.stage') && g.closest('.stage').querySelector('[data-tab="pics"] .badge'); if (badge) { badge.textContent = list.length ? String(list.length) : ''; badge.hidden = !list.length; }
    });
    document.querySelectorAll('.stage[data-day]').forEach(function (st) { var n = +st.getAttribute('data-day'); if (EDITS.days[n] && EDITS.days[n].text && EDITS.days[n].text[langOf(st)] && !st._edited) redrawLog(st); });
    document.querySelectorAll('.photoref').forEach(function (s) {
      var p = byId[s.getAttribute('data-photo')]; if (!p) { s.innerHTML = ''; return; }
      var lang = langOf(s), c = caption(p, lang);
      s.innerHTML = '<a class="inpic ' + (p.w && p.h && p.h > p.w ? 'port' : 'land') + '" href="' + BASE + esc(p.file) + '" data-photo="' + esc(p.id) + '"><img src="' + BASE + esc(p.file) + '" alt="' + esc(c) + '" loading="lazy"' + (p.w && p.h ? ' width="' + p.w + '" height="' + p.h + '" style="--ar:' + (p.w / p.h).toFixed(4) + '"' : '') + '>' + (c ? '<span>' + esc(c) + '</span>' : '') + '</a>';
    });
    Object.keys(layers).forEach(function (lang) { rebuildDots(lang); });
  }

  /* ---- dots on the map: one preview per group of pictures that would overlap at this zoom (up to four
     previews split in the circle, then a count), rebuilt on every zoom; the whole-route map shows them
     only once zoomed in. They sit in a "Pictures" overlay of the layer control. On the profile, one mark
     per group of pictures close together along the route. ---- */
  var ALL_MIN_ZOOM = 12, GROUP_PX = 48, DOT = 46;
  function small(p) { return BASE + esc(p.small || p.thumb); }
  function clusterize(list, map) {
    var z = map.getZoom(), out = [];
    list.forEach(function (x) {
      var pt = map.project([x.pos.lat, x.pos.lon], z), c = null;
      out.forEach(function (g) { if (!c && g.pt.distanceTo(pt) < GROUP_PX) c = g; });
      if (c) { c.items.push(x.p); c.est = c.est && x.pos.est; }
      else out.push({ pt: pt, lat: x.pos.lat, lon: x.pos.lon, est: x.pos.est, items: [x.p] });
    });
    return out;
  }
  function dotIcon(items, est) {
    var n = Math.min(items.length, 4);
    var html = '<span class="pdi n' + n + '">' + items.slice(0, n).map(function (p) { return '<img src="' + small(p) + '" alt="">'; }).join('') + '</span>' + (items.length > 1 ? '<b>' + items.length + '</b>' : '');
    return L.divIcon({ className: 'photodot' + (est ? ' est' : ''), html: html, iconSize: [DOT, DOT], iconAnchor: [DOT / 2, DOT / 2], popupAnchor: [0, -DOT / 2] });
  }
  function rebuildDots(lang) {
    var L0 = layers[lang]; if (!L0 || !window.gr52Data) return;
    var map = L0.map, G = window.gr52Map;
    L0.group.clearLayers();
    var list = [];
    photos.forEach(function (p) { if (L0.scope != null && dayOf(p) !== L0.scope) return; var pos = place(p); if (pos) list.push({ p: p, pos: pos }); });
    /* while the overlay is being switched off the map still lists it as the group's home, so a marker added now would be orphaned */
    var on = map.hasLayer(L0.group), hint = L0.hint; if (hint) hint.hidden = !(on && L0.scope == null && list.length && map.getZoom() < ALL_MIN_ZOOM);
    if (on && !(L0.scope == null && map.getZoom() < ALL_MIN_ZOOM)) clusterize(list, map).forEach(function (c, k) {
      var id = lang + '-' + (L0.scope == null ? 'all' : L0.scope) + '-' + c.items[0].id, items = c.items; clusters[id] = items; /* keyed by the first picture, so an open popup still finds its group after the map re-clusters */
      var m = L.marker([c.lat, c.lon], { icon: dotIcon(items, c.est), zIndexOffset: 700, keyboard: false });
      m.bindPopup('<div class="popthumbs">' + items.map(function (p) { return '<a href="' + BASE + esc(p.file) + '" data-photo="' + esc(p.id) + '" data-cluster="' + id + '"><img src="' + BASE + esc(p.thumb) + '" alt="" loading="lazy"></a>'; }).join('') + '</div>', { maxWidth: 330 });
      L0.group.addLayer(m);
    });
    /* the profile: groups by distance along the route, about a sixtieth of the stretch apart */
    var span = L0.range ? L0.range.to - L0.range.from : 0, tol = Math.max(60, span / 60), groups = [];
    list.slice().sort(function (a, b) { return a.pos.d - b.pos.d; }).forEach(function (x) {
      var g = groups[groups.length - 1];
      if (g && x.pos.d - g.d0 < tol) { g.items.push(x.p); g.est = g.est && x.pos.est; } else groups.push({ d0: x.pos.d, items: [x.p], est: x.pos.est });
    });
    var app = G.app(lang);
    if (app) app.setMarks(groups.map(function (g) { var pt = G.routePointAt(g.d0) || {}; return { d: g.d0, ele: pt.ele, est: g.est, label: g.items.length > 1 ? String(g.items.length) : '', onClick: function () { open(g.items, 0); } }; }));
  }
  document.addEventListener('trek:scope', function (e) {
    var d = e.detail;
    if (!layers[d.lang]) {
      var group = L.layerGroup(), app = window.gr52Map.app(d.lang);
      if (app && app.addOverlay) app.addOverlay(T[d.lang].layer, group, true); else group.addTo(d.map);
      var hint = document.createElement('div'); hint.className = 'maphint'; hint.textContent = T[d.lang].zoomIn; hint.hidden = true; d.map.getContainer().appendChild(hint);
      layers[d.lang] = { group: group, map: d.map, hint: hint };
      d.map.on('zoomend overlayadd overlayremove', function () { rebuildDots(d.lang); });
    }
    layers[d.lang].scope = d.scope; layers[d.lang].range = d.range;
    rebuildDots(d.lang);
  });

  /* ---- lightbox: arrows, keys, swipe sideways, swipe down to close, download ---- */
  var lb = document.getElementById('lightbox'), cur = { list: [], i: 0 };
  var sheetWrap = document.createElement('div'); sheetWrap.id = 'sheetwrap'; sheetWrap.hidden = true; sheetWrap.innerHTML = '<div class="sheet" role="menu"></div>'; document.body.appendChild(sheetWrap);
  function show(i) {
    var p = cur.list[i]; if (!p) return; cur.i = i;
    var lang = visibleLang(), c = caption(p, lang), pos = place(p);
    lb.querySelector('img').src = BASE + p.file;
    var dl = lb.querySelector('.lbdl'); dl.href = p.orig ? ORIG + p.orig : BASE + p.file; dl.setAttribute('download', p.orig ? (p.name || p.orig) : (p.id + '.jpg')); dl.title = T[lang].download;
    lb.querySelector('.lbcap').innerHTML = (c ? esc(c) + ' · ' : '') + (p.taken ? T[lang].taken + ' ' + esc(p.taken.replace('T', ' ').slice(0, 16)) : '')
      + (pos ? ' · <a href="?map=ll:' + pos.lat.toFixed(5) + ',' + pos.lon.toFixed(5) + '" class="focus" data-go="ll:' + pos.lat.toFixed(5) + ',' + pos.lon.toFixed(5) + ':' + esc(c || T[lang].photo) + '" data-day="' + (dayOf(p) == null ? '' : dayOf(p)) + '">' + T[lang].onMap + '</a>' + (pos.est ? ' (' + T[lang].est + ')' : '') : '');
    lb.querySelector('.lbn').textContent = (i + 1) + ' / ' + cur.list.length;
    if (overlay === 'lb') { var u = new URL(location.href); if (u.searchParams.get('photo') !== p.id) { u.searchParams.set('photo', p.id); history.replaceState(history.state, '', u); } }
    lb.querySelector('[data-lb="prev"]').disabled = i === 0; lb.querySelector('[data-lb="next"]').disabled = i === cur.list.length - 1;
    var pre = cur.list[i + 1]; if (pre) { var img = new Image(); img.src = BASE + pre.file; }
  }
  /* the lightbox and the sheet are history entries, so the phone's back button closes them instead of
     leaving the page; the lightbox also keeps ?photo=ID in the address, so the link can be shared */
  var overlay = null, popPending = false;
  function pushOverlay(kind, photoId) {
    var u = new URL(location.href); if (photoId) u.searchParams.set('photo', photoId);
    history.pushState(Object.assign({}, history.state || {}, { overlay: kind }), '', u); overlay = kind;
  }
  function popOverlay() {
    if (history.state && history.state.overlay && overlay) { popPending = true; overlay = null; history.back(); return; }
    overlay = null; var u = new URL(location.href); if (u.searchParams.has('photo')) { u.searchParams.delete('photo'); history.replaceState(history.state, '', u); }
  }
  window.gr52Overlay = { onPop: function () {
    /* the address the overlay was pushed over may be stale; note the place again once closed */
    if (window.gr52Nav && window.gr52Nav.noteAt) setTimeout(window.gr52Nav.noteAt, 50);
    if (popPending) { popPending = false; return true; }
    if (!lb.hidden) { lb.hidden = true; document.body.classList.remove('lbopen'); overlay = null; return true; }
    if (!sheetWrap.hidden) { sheetWrap.setAttribute('hidden', ''); overlay = null; return true; }
    return false;
  } };
  function open(list, i, quiet) { cur.list = list; lb.hidden = false; document.body.classList.add('lbopen'); if (!quiet && overlay !== 'lb') pushOverlay('lb', list[i] && list[i].id); show(i); }
  function close() { lb.hidden = true; document.body.classList.remove('lbopen'); popOverlay(); }
  function showSheet() { sheetWrap.hidden = false; if (overlay !== 'sheet') pushOverlay('sheet'); }
  function hideSheet() { sheetWrap.setAttribute('hidden', ''); popOverlay(); }
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
      if (e.target.closest('[data-lb="close"]') || !e.target.closest('img,button,a,.lbcap,.lbnav')) close();
    });
    document.addEventListener('keydown', function (e) { if (lb.hidden) return; if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') show(cur.i + 1); if (e.key === 'ArrowLeft') show(cur.i - 1); });
    var sx = 0, sy = 0, st0 = 0;
    lb.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; st0 = Date.now(); }, { passive: true });
    lb.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dy) < Math.abs(dx)) show(cur.i + (dx < 0 ? 1 : -1)); /* the next picture is to the right in both languages, like the arrow buttons */
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
    var i = -1; list.forEach(function (p, k) { if (p.id === id) i = k; });
    if (i < 0) { list = [byId[id]]; i = 0; } /* a stale group (the map re-clustered since the popup opened): show the picture that was clicked */
    open(list, i);
  }, true);

  /* ---- editing on the page: a day's text, a picture in or out of the log, hidden, captions.
     Edits go to /log/<user>/edit and come back in photos/edits.json, which is read on load and laid over
     the built page; tools/log_pull.py folds them into log.yaml. ---- */
  function loadEdits() {
    return fetch(EDITS_URL, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (e) { if (e && typeof e === 'object') EDITS = e; EDITS.days = EDITS.days || {}; EDITS.photos = EDITS.photos || {}; applyPhotoEdits(); });
  }
  /* the cover picture behind the header: built from log.yaml, changed on the page through edits.json */
  function coverId() { return EDITS.cover !== undefined ? EDITS.cover : (LOG.cover ? LOG.cover.photo : null); }
  function applyCover() {
    if (EDITS.cover === undefined) return;
    document.querySelectorAll('.wrap > header').forEach(function (h) {
      var mast = h.querySelector('.mast');
      if (!EDITS.cover) { if (mast) { while (mast.children.length) { var c = mast.firstElementChild; if (c.classList.contains('coverimg')) c.remove(); else h.insertBefore(c, mast); } mast.remove(); } h.classList.remove('cover'); return; }
      if (!mast) {
        mast = document.createElement('div'); mast.className = 'mast';
        var img = document.createElement('img'); img.className = 'coverimg'; img.alt = ''; mast.appendChild(img);
        var eb = h.querySelector('.eyebrow'), h1 = h.querySelector('h1'); h.insertBefore(mast, eb || h1); if (eb) mast.appendChild(eb); if (h1) mast.appendChild(h1);
      }
      var src = BASE + EDITS.cover + '.jpg', im = mast.querySelector('.coverimg'); if (im.getAttribute('src') !== src) im.src = src;
      mast.style.setProperty('--cover-y', LOG.cover && LOG.cover.photo === EDITS.cover ? LOG.cover.y : '50%');
      h.classList.add('cover');
    });
    if (window.gr52Mast) window.gr52Mast.refresh();
  }
  function applyPhotoEdits() {
    applyCover();
    Object.keys(EDITS.photos).forEach(function (id) {
      var e = EDITS.photos[id], o = over[id] = over[id] || {};
      if ('hide' in e) o.hide = !!e.hide;
      if (e.caption) { var c = o.caption; o.caption = Object.assign({}, typeof c === 'object' && c ? c : (c ? { en: c, he: c } : {}), e.caption); }
    });
  }
  var editKey = null;
  try { editKey = localStorage.getItem('log-edit-key'); } catch (e) { }
  function postEdit(body, lang) {
    var h = { 'Content-Type': 'application/json' }; if (editKey) h['X-Log-Key'] = editKey;
    return fetch(EDIT_URL, { method: 'POST', headers: h, body: JSON.stringify(body) }).then(function (r) {
      if (r.status === 403) { var k = prompt(T[lang].keyPrompt); if (k == null) throw new Error('no key'); editKey = k; try { localStorage.setItem('log-edit-key', k); } catch (e) { } return postEdit(body, lang); }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (e) { EDITS = e; EDITS.days = EDITS.days || {}; EDITS.photos = EDITS.photos || {}; applyPhotoEdits(); return e; });
  }
  function dayText(n, lang) {
    var e = EDITS.days[n] && EDITS.days[n].text && EDITS.days[n].text[lang];
    if (e) return e.slice();
    var d = DAYS[n] && DAYS[n].text; return d && d[lang] ? d[lang].slice() : [];
  }
  /* the same rendering as src/render_log.py: tokens to links and picture blocks, a paragraph per block */
  var KEEP = /<\/?(b|i|a|br|span|em|strong)(\s[^>]*)?>/g, TOKEN = /\[\[(map|photo|photos|gmaps|url):([^\]|]+)(?:\|([^\]]*))?\]\]/g, GMAPS = 'https://www.google.com/maps/search/?api=1&query=', PHOTO_RUN = /(?:\s*\[\[photos?:[^\]]+\]\])+\s*/g;
  function escAll(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function strongOf(chars) { for (var i = 0; i < chars.length; i++) { var ch = chars[i]; if (/[A-Za-zÀ-ɏ]/.test(ch)) return 'L'; if (/[֐-׿؀-ۿ0-9]/.test(ch)) return 'R'; } return null; }
  function arrows(s) { var out = s.split(''); for (var i = 0; i < out.length; i++) if (out[i] === '→' && !(strongOf(s.slice(0, i).split('').reverse()) === 'L' && strongOf(s.slice(i + 1)) === 'L')) out[i] = '←'; return out.join(''); }
  function txt(s, lang) {
    s = s == null ? '' : String(s); if (lang === 'he' && s.indexOf('→') >= 0) s = arrows(s);
    var out = '', pos = 0, m; KEEP.lastIndex = 0;
    while ((m = KEEP.exec(s))) { out += escAll(s.slice(pos, m.index)) + m[0]; pos = m.index + m[0].length; }
    return out + escAll(s.slice(pos));
  }
  function logtxt(s, lang) {
    var out = '', pos = 0, m; TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(s))) {
      out += txt(s.slice(pos, m.index), lang);
      var kind = m[1], arg = m[2].trim(), label = (m[3] || '').trim();
      if (kind === 'map' || kind === 'gmaps' || kind === 'url') out += linkHtml(linkSpecs(kind, arg), label, lang);
      else out += arg.split(',').map(function (i) { return '<span class="photoref" data-photo="' + esc(i.trim()) + '"></span>'; }).join('');
      pos = m.index + m[0].length;
    }
    return out + txt(s.slice(pos), lang);
  }
  function linkSpecs(kind, arg) {
    var out = [];
    arg.split(';').forEach(function (part, i) { part = part.trim(); var m = /^(map|gmaps|url):(.+)$/.exec(part), k = m ? m[1] : (i === 0 ? kind : null), q = (m ? m[2] : part).trim(); if (k && q) out.push({ k: k, q: q }); });
    return out;
  }
  function linkHref(sp) { return sp.k === 'map' ? '?map=' + esc(sp.q) : sp.k === 'gmaps' ? GMAPS + encodeURIComponent(sp.q) : esc(sp.q); }
  function linkHtml(specs, label, lang) {
    var icons = specs.map(function (sp) { return '<i class="ic-' + sp.k + '"></i>'; }).join(''), s0 = specs[0], text = txt(label || s0.q, lang);
    if (specs.length === 1) return s0.k === 'map' ? '<a href="?map=' + esc(s0.q) + '" class="lk k-map focus" data-focus="' + esc(s0.q) + '">' + icons + text + '</a>'
      : '<a href="' + linkHref(s0) + '" class="lk k-' + s0.k + '" target="_blank" rel="noopener">' + icons + text + '</a>';
    return '<a href="' + linkHref(s0) + '" class="lk multi" data-links="' + esc(JSON.stringify(specs)) + '">' + icons + text + '</a>';
  }
  function blocks(para, lang) {
    var s = para == null ? '' : String(para), out = [], pos = 0, m; PHOTO_RUN.lastIndex = 0;
    while ((m = PHOTO_RUN.exec(s))) {
      var text = s.slice(pos, m.index).trim(); if (text) out.push('<p>' + logtxt(text, lang) + '</p>');
      var ids = []; m[0].replace(/\[\[photos?:([^\]|]+)/g, function (_, x) { x.split(',').forEach(function (i) { if (i.trim()) ids.push(i.trim()); }); });
      if (ids.length > 1) out.push('<div class="photos">' + ids.map(function (i) { return '<span class="photoref" data-photo="' + esc(i) + '"></span>'; }).join('') + '</div>');
      else if (ids.length) out.push('<div class="photoref" data-photo="' + esc(ids[0]) + '"></div>');
      pos = m.index + m[0].length;
    }
    var tail = s.slice(pos).trim(); if (tail) out.push('<p>' + logtxt(tail, lang) + '</p>');
    return out.join('\n');
  }
  function redrawLog(st) {
    var n = +st.getAttribute('data-day'), lang = langOf(st), pane = st.querySelector('.pane[data-pane="log"]');
    pane.innerHTML = dayText(n, lang).map(function (p) { return blocks(p, lang); }).join('\n');
    st._edited = true;
  }
  function saveText(n, texts, lang) {
    return postEdit({ day: n, text: texts }, lang).then(function () {
      document.querySelectorAll('.stage[data-day="' + n + '"]').forEach(function (st) { st._edited = false; redrawLog(st); });
      render();
    });
  }
  /* the editor: the day's paragraphs in a textarea, blank lines between them */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.tabs .editbtn'); if (!b) return;
    var st = b.closest('.stage'), n = +st.getAttribute('data-day'), lang = langOf(st), pane = st.querySelector('.pane[data-pane="log"]');
    if (st.querySelector('.editor')) { st.querySelector('.editor').remove(); b.classList.remove('on'); pane.hidden = false; return; }
    window.gr52Map.showTab(st, 'log');
    var ed = document.createElement('div'); ed.className = 'editor';
    ed.innerHTML = '<textarea spellcheck="false"></textarea><div class="row"><button type="button" class="primary" data-act="save">' + T[lang].save + '</button><button type="button" data-act="cancel">' + T[lang].cancel + '</button><button type="button" data-act="pick">' + T[lang].addPic + '</button><span class="msg"></span><span class="hint">' + esc(T[lang].editHint) + '</span></div>';
    ed.querySelector('textarea').value = dayText(n, lang).join('\n\n');
    pane.hidden = true; pane.parentNode.insertBefore(ed, pane); b.classList.add('on');
    ed.addEventListener('click', function (ev) {
      var act = ev.target.closest('[data-act]'); if (!act) return;
      if (act.getAttribute('data-act') === 'cancel') { ed.remove(); b.classList.remove('on'); pane.hidden = false; return; }
      if (act.getAttribute('data-act') === 'pick') { pickPicture(n, lang, ed.querySelector('textarea')); return; }
      var paras = ed.querySelector('textarea').value.split(/\n\s*\n/).map(function (x) { return x.trim(); }).filter(Boolean), texts = {}; texts[lang] = paras;
      var msg = ed.querySelector('.msg'); msg.textContent = '…';
      saveText(n, texts, lang).then(function () { ed.remove(); b.classList.remove('on'); pane.hidden = false; }, function (err) { msg.textContent = T[lang].saveFail + ' (' + (err && err.message || err) + ')'; });
    });
  });
  /* the picker: the day's pictures in a grid; one tap puts its token where the cursor is */
  function pickPicture(n, lang, ta) {
    var list = photos.filter(function (p) { return dayOf(p) === n; }), used = ta.value;
    var sh = sheetWrap.querySelector('.sheet'); sh.setAttribute('dir', lang === 'he' ? 'rtl' : 'ltr');
    sh.innerHTML = '<div class="who"><span>' + esc(T[lang].pickHint) + '</span></div><div class="pick">' + list.map(function (p) { return '<a href="#" data-pick="' + esc(p.id) + '" class="' + (used.indexOf('[[photo:' + p.id + ']]') >= 0 ? 'used' : '') + '" title="' + esc(caption(p, lang) || when(p)) + '"><img src="' + small(p) + '" alt="" loading="lazy"></a>'; }).join('') + '</div><button type="button" data-k="cancel" class="cancel">' + T[lang].cancel + '</button>';
    showSheet();
    sh.onclick = function (ev) {
      var a = ev.target.closest('a[data-pick]');
      if (a) {
        ev.preventDefault(); hideSheet();
        var tok = '[[photo:' + a.getAttribute('data-pick') + ']]', s0 = ta.selectionStart != null ? ta.selectionStart : ta.value.length, s1 = ta.selectionEnd != null ? ta.selectionEnd : s0;
        var before = ta.value.slice(0, s0), after = ta.value.slice(s1);
        var ins = (before && !/\s$/.test(before) ? ' ' : '') + tok + (after && !/^\s/.test(after) ? ' ' : '');
        ta.value = before + ins + after; ta.focus(); ta.selectionStart = ta.selectionEnd = before.length + ins.length;
        return;
      }
      if (ev.target.closest('[data-k="cancel"]')) hideSheet();
    };
  }
  /* a picture in or out of the day's text, in every language; a hidden picture; a caption */
  var PHOTO_TOKEN = function (id) { return new RegExp('\\s*\\[\\[photo:' + id + '\\]\\]', 'g'); };
  function inLog(n, id) { return Object.keys(DAYS[n] ? DAYS[n].text || {} : {}).concat(Object.keys(EDITS.days[n] && EDITS.days[n].text || {})).some(function (lang) { return dayText(n, lang).some(function (p) { return p.indexOf('[[photo:' + id + ']]') >= 0; }); }); }
  function togglePhoto(n, id, on, lang) {
    var texts = {}, langs = Object.keys(T);
    langs.forEach(function (l) {
      var paras = dayText(n, l).map(function (p) { return p.replace(PHOTO_TOKEN(id), ''); }).map(function (p) { return p.trim(); }).filter(Boolean);
      if (on) { if (paras.length) paras[paras.length - 1] += ' [[photo:' + id + ']]'; else paras.push('[[photo:' + id + ']]'); }
      texts[l] = paras;
    });
    return saveText(n, texts, lang);
  }
  function setHidden(id, hide, lang) { return postEdit({ photo: id, hide: hide }, lang).then(function () { return loadIndex(); }).then(render); }
  function editCaption(id, lang) {
    var p = byId[id]; if (!p) return;
    var c = prompt(T[lang].captionPrompt, caption(p, lang)); if (c == null) return;
    var cap = {}; cap[lang] = c;
    postEdit({ photo: id, caption: cap }, lang).then(render);
  }
  /* long press (or right click) on a picture opens the sheet */
  sheetWrap.addEventListener('click', function (e) { if (e.target === sheetWrap) hideSheet(); });
  function openSheet(a) {
    var id = a.getAttribute('data-photo'), p = byId[id]; if (!p) return;
    var st = a.closest('.stage'), lang = langOf(a), n = st ? +st.getAttribute('data-day') : dayOf(p), hidden = !!(over[id] && over[id].hide), inline = !!a.closest('.photoref'), items = [];
    if (n != null && !hidden) items.push({ k: inline || inLog(n, id) ? 'remove' : 'add', t: T[lang][inline || inLog(n, id) ? 'removeLog' : 'addLog'] });
    items.push({ k: 'caption', t: T[lang].captionEdit });
    items.push({ k: coverId() === id ? 'uncover' : 'cover', t: T[lang][coverId() === id ? 'uncover' : 'cover'] });
    items.push({ k: hidden ? 'unhide' : 'hide', t: T[lang][hidden ? 'unhide' : 'hide'], cls: hidden ? '' : 'danger' });
    items.push({ k: 'cancel', t: T[lang].cancel, cls: 'cancel' });
    var sh = sheetWrap.querySelector('.sheet'); sh.setAttribute('dir', lang === 'he' ? 'rtl' : 'ltr');
    sh.innerHTML = '<div class="who"><img src="' + small(p) + '" alt=""><span>' + esc(caption(p, lang) || when(p) || id) + '</span></div>' + items.map(function (it) { return '<button type="button" data-k="' + it.k + '" class="' + (it.cls || '') + '">' + esc(it.t) + '</button>'; }).join('');
    showSheet();
    sh.onclick = function (e) {
      var b = e.target.closest('[data-k]'); if (!b) return; var k = b.getAttribute('data-k'); hideSheet();
      var done = null;
      if (k === 'add') done = togglePhoto(n, id, true, lang); else if (k === 'remove') done = togglePhoto(n, id, false, lang);
      else if (k === 'hide') done = setHidden(id, true, lang); else if (k === 'unhide') done = setHidden(id, false, lang);
      else if (k === 'caption') editCaption(id, lang);
      else if (k === 'cover') done = postEdit({ cover: id }, lang).then(function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
      else if (k === 'uncover') done = postEdit({ cover: null }, lang);
      if (done) done.catch(function (err) { alert(T[lang].saveFail + ' (' + (err && err.message || err) + ')'); });
    };
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a.lk.multi'); if (!a) return;
    e.preventDefault(); e.stopPropagation();
    var lang = langOf(a), specs = []; try { specs = JSON.parse(a.getAttribute('data-links')); } catch (err) { }
    var sh = sheetWrap.querySelector('.sheet'); sh.setAttribute('dir', lang === 'he' ? 'rtl' : 'ltr');
    sh.innerHTML = '<div class="who"><span>' + esc(a.textContent) + '</span></div><div class="chips">' + specs.map(function (sp) {
      var t = T[lang][sp.k === 'map' ? 'onMap' : sp.k === 'gmaps' ? 'inGmaps' : 'openUrl'];
      return sp.k === 'map' ? '<a href="?map=' + esc(sp.q) + '" class="lk k-map" data-go="' + esc(sp.q) + '"><i class="ic-map"></i>' + t + '</a>' : '<a href="' + linkHref(sp) + '" class="lk k-' + sp.k + '" target="_blank" rel="noopener"><i class="ic-' + sp.k + '"></i>' + t + '</a>';
    }).join('') + '</div><button type="button" data-k="cancel" class="cancel">' + T[lang].cancel + '</button>';
    showSheet();
    sh.onclick = function (ev) {
      var g = ev.target.closest('a[data-go]'); if (g) { ev.preventDefault(); hideSheet(); if (window.gr52Nav) window.gr52Nav.go(g.getAttribute('data-go'), a); return; }
      if (ev.target.closest('a.lk')) { hideSheet(); return; }
      if (ev.target.closest('[data-k="cancel"]')) hideSheet();
    };
  }, true);
  var pressTimer = null, pressed = null, pressStart = null, pressEnd = 0;
  function pressTarget(e) { var a = e.target.closest && e.target.closest('a[data-photo]'); return a && !a.closest('#lightbox') && !a.closest('.leaflet-popup') ? a : null; }
  document.addEventListener('pointerdown', function (e) {
    var a = pressTarget(e); if (!a || e.button > 0) return;
    pressed = null; pressStart = [e.clientX, e.clientY];
    clearTimeout(pressTimer); pressTimer = setTimeout(function () { pressed = a; openSheet(a); }, 550);
  }, true);
  document.addEventListener('pointermove', function (e) { if (pressTimer && pressStart && Math.hypot(e.clientX - pressStart[0], e.clientY - pressStart[1]) > 12) { clearTimeout(pressTimer); pressTimer = null; } }, true);
  ['pointerup', 'pointercancel'].forEach(function (t) { document.addEventListener(t, function () { clearTimeout(pressTimer); pressTimer = null; if (pressed) pressEnd = Date.now(); }, true); });
  /* the click that follows a long press is swallowed, but only the one right after it: a tap outside the sheet a moment later must close it */
  document.addEventListener('click', function (e) { var swallow = pressed && Date.now() - pressEnd < 500; pressed = null; if (swallow) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('contextmenu', function (e) { var a = pressTarget(e); if (a) { e.preventDefault(); clearTimeout(pressTimer); pressTimer = null; openSheet(a); } });

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
  function dropWx(box) { var st = box.closest('.stage'), tab = st.querySelector('[data-tab="wx"]'); if (tab && tab.classList.contains('on')) window.gr52Map.showTab(st, 'log'); if (tab) tab.remove(); box.closest('.pane').remove(); }
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

  /* ---- upload: straight to /log/<user>/upload, one file at a time, then the index is re-read.
     A zip (a Google Photos album download, for one) is unpacked here entry by entry; a picture's
     sidecar JSON, when the zip has one, supplies the place and time the picture itself may lack. ---- */
  var IMG = /\.(jpe?g|png|heic|heif|webp|avif|tiff?)$/i;
  function localStamp(epoch) {
    /* the picture's own time is local; a sidecar epoch becomes local time in the trek's zone */
    try { var parts = new Intl.DateTimeFormat('en-GB', { timeZone: TREK.timezone && TREK.timezone !== 'auto' ? TREK.timezone : undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(epoch * 1000)), o = {}; parts.forEach(function (p) { o[p.type] = p.value; }); return o.year + '-' + o.month + '-' + o.day + 'T' + (o.hour === '24' ? '00' : o.hour) + ':' + o.minute + ':' + o.second; } catch (e) { return null; }
  }
  function sidecarFields(meta) {
    var f = {}, g = meta && (meta.geoDataExif && meta.geoDataExif.latitude ? meta.geoDataExif : meta.geoData);
    if (g && (g.latitude || g.longitude)) { f.lat = g.latitude; f.lon = g.longitude; if (g.altitude) f.alt = g.altitude; }
    var t = meta && meta.photoTakenTime && meta.photoTakenTime.timestamp; if (t) { var s = localStamp(+t); if (s) f.taken = s; }
    return f;
  }
  function unzip(file, onEntry) {
    if (!window.zip) return Promise.reject(new Error('zip support did not load'));
    var reader = new zip.ZipReader(new zip.BlobReader(file));
    return reader.getEntries().then(function (entries) {
      var metas = {}, pics = [];
      entries.forEach(function (e) { if (e.directory || /(^|\/)(__MACOSX|\.)/.test(e.filename)) return; var base = e.filename.split('/').pop(); if (/\.json$/i.test(base)) metas[base.toLowerCase()] = e; else if (IMG.test(base)) pics.push(e); });
      function metaFor(base) {
        var b = base.toLowerCase(), stem = b.replace(/\.[^.]+$/, ''), keys = Object.keys(metas);
        var k = keys.filter(function (x) { return x === b + '.json' || x === b + '.supplemental-metadata.json' || x === stem + '.json' || (x.indexOf(b + '.') === 0 && /\.json$/.test(x)); })[0];
        return k ? metas[k].getData(new zip.TextWriter()).then(function (t) { try { return JSON.parse(t); } catch (e) { return null; } }) : Promise.resolve(null);
      }
      var i = 0;
      return (function step() {
        if (i >= pics.length) return reader.close().then(function () { return pics.length; });
        var e = pics[i++], base = e.filename.split('/').pop();
        return Promise.all([e.getData(new zip.BlobWriter()), metaFor(base)]).then(function (r) { return onEntry(new File([r[0]], base), sidecarFields(r[1]), i, pics.length); }).then(step);
      })();
    });
  }
  function send(f, fields, row, lang, tries) {
    /* one picture; a failed transfer is tried again twice before the row says so, with the reason */
    tries = tries == null ? 2 : tries;
    return new Promise(function (resolve) {
      var fd = new FormData(); Object.keys(fields || {}).forEach(function (k) { if (fields[k] != null) fd.append(k, String(fields[k])); }); fd.append('photo', f, f.name);
      var xhr = new XMLHttpRequest(); xhr.open('POST', UPLOAD);
      xhr.upload.onprogress = function (e) { if (e.lengthComputable) row.textContent = f.name + ' · ' + T[lang].uploading + ' ' + Math.round(e.loaded / e.total * 100) + ' %'; };
      function fail(why) {
        if (tries > 0) { row.textContent = f.name + ' · ' + T[lang].retry; setTimeout(function () { send(f, fields, row, lang, tries - 1).then(resolve); }, 1500); return; }
        row.textContent = f.name + ' · ' + T[lang].failed + (why ? ' (' + why + ')' : ''); row.className = 'bad'; resolve(false);
      }
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) { try { JSON.parse(xhr.responseText).forEach(add); } catch (e) { } row.textContent = f.name + ' · ' + T[lang].done; render(); resolve(true); }
        else if (xhr.status === 422 || xhr.status === 400) fail(xhr.status + ' ' + xhr.responseText.slice(0, 80));
        else fail(xhr.status + ' ' + xhr.responseText.slice(0, 80));
      };
      xhr.onerror = function () { fail(''); };
      xhr.send(fd);
    });
  }
  /* what the log already holds: the file name, or the second it was taken (the picture itself or its sidecar) */
  function known(name, fields) {
    var n = (name || '').toLowerCase(), t = fields && fields.taken;
    return photos.some(function (p) { return (p.name || '').toLowerCase() === n || (t && p.taken === t); });
  }
  function pool(items, n, work) {
    /* run work(item) over the list, n at a time, in order of start */
    var i = 0, results = [];
    function next() { if (i >= items.length) return Promise.resolve(); var k = i++; return Promise.resolve(work(items[k], k)).then(function (r) { results[k] = r; return next(); }); }
    var lanes = []; for (var j = 0; j < Math.min(n, items.length); j++) lanes.push(next());
    return Promise.all(lanes).then(function () { return results; });
  }
  var PARALLEL = 3;
  document.querySelectorAll('.upload input[type=file]').forEach(function (input) {
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files), list = input.closest('.upload').querySelector('.uplist'), lang = langOf(input);
      function rowFor(name) { var row = document.createElement('div'); row.textContent = name + ' · ' + T[lang].uploading + ' 0 %'; list.appendChild(row); return row; }
      function summary(row, name, sent, skipped, failed) {
        row.textContent = name + ' · ' + sent + ' ' + T[lang].photos + ' · ' + T[lang].done + (skipped ? ' · ' + skipped + ' ' + T[lang].skipped : '') + (failed ? ' · ' + failed + ' ' + T[lang].failed : '');
      }
      var zips = files.filter(function (f) { return /\.zip$/i.test(f.name); }), pics = files.filter(function (f) { return !/\.zip$/i.test(f.name); });
      var onlyNew = pics.filter(function (f) { return !known(f.name, null); }), skippedLoose = pics.length - onlyNew.length;
      var loose = onlyNew.length ? pool(onlyNew, PARALLEL, function (f) { return send(f, null, rowFor(f.name), lang); }) : Promise.resolve([]);
      loose.then(function (res) {
        if (pics.length) { var r = rowFor(''); summary(r, T[lang].photos, res.filter(Boolean).length, skippedLoose, res.filter(function (x) { return x === false; }).length); }
        return zips.reduce(function (chain, z) {
          return chain.then(function () {
            var zrow = rowFor(z.name), sent = 0, skipped = 0, failed = 0, queue = [];
            /* the zip is read entry by entry; what the log already has is skipped, the rest goes up three at a time */
            return unzip(z, function (pic, fields, n, total) {
              zrow.textContent = z.name + ' · ' + n + ' / ' + total + (skipped ? ' · ' + skipped + ' ' + T[lang].skipped : '');
              if (known(pic.name, fields)) { skipped++; return; }
              var p = pool([pic], 1, function (f) { return send(f, fields, rowFor(f.name), lang); }).then(function (r) { if (r[0]) sent++; else failed++; });
              queue.push(p); p.then(function () { queue.splice(queue.indexOf(p), 1); });
              return queue.length >= PARALLEL ? Promise.race(queue) : null;
            }).then(function () { return Promise.all(queue); })
              .then(function () { summary(zrow, z.name, sent, skipped, failed); }, function (e) { zrow.textContent = z.name + ' · ' + T[lang].failed + ' (' + (e && e.message || e) + ')'; });
          });
        }, Promise.resolve());
      }).then(function () { loadIndex().then(render); });
      input.value = '';
    });
  });
  function add(p) { if (!p || !p.id) return; byId[p.id] = p; [photos, hiddenPics].forEach(function (L) { for (var k = L.length - 1; k >= 0; k--) if (L[k].id === p.id) L.splice(k, 1); }); if (over[p.id] && over[p.id].hide) { hiddenPics.push(p); return; } photos.push(p); photos.sort(function (a, b) { return (a.taken || '9') < (b.taken || '9') ? -1 : 1; }); }
  function loadIndex() {
    return fetch(BASE + 'index.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; })
      .then(function (list) { photos = []; hiddenPics = []; byId = {}; (Array.isArray(list) ? list : []).forEach(add); });
  }

  /* the route's distance (unless the log gives one) and climb for each walking day, around the chips written in the log */
  function routeChips() {
    var G = window.gr52Map;
    document.querySelectorAll('.stage[data-day] .stats').forEach(function (st) {
      var n = +st.closest('.stage').getAttribute('data-day'), s = G.dayStats(n);
      if (!s || s.km < 0.2 || st.querySelector('.auto')) return;
      var lang = langOf(st), hasKm = Array.prototype.some.call(st.querySelectorAll('.st'), function (x) { return /km|ק"מ/.test(x.textContent); });
      if (!hasKm) { var km = document.createElement('span'); km.className = 'auto'; km.setAttribute('dir', 'ltr'); km.textContent = '≈' + s.km.toFixed(s.km < 10 ? 1 : 0) + ' ' + (lang === 'he' ? 'ק"מ' : 'km'); st.insertBefore(km, st.firstChild); }
      var chip = document.createElement('span'); chip.className = 'auto'; chip.setAttribute('dir', 'ltr'); chip.textContent = '+' + Math.round(s.ascent).toLocaleString('en') + ' / −' + Math.round(s.descent).toLocaleString('en') + ' m';
      st.appendChild(chip);
    });
  }

  /* ---- boot ---- */
  loadEdits().then(loadIndex).then(render).then(function () {
    var id = new URL(location.href).searchParams.get('photo'), p = id && byId[id]; if (!p) return;
    var n = dayOf(p), list = photos.filter(function (x) { return dayOf(x) === n; }), i = Math.max(0, list.indexOf(p));
    var st = n != null && document.querySelector('.wrap:not([hidden]) .stage[data-day="' + n + '"]'); if (st) st.scrollIntoView({ block: 'start' });
    open(list.length ? list : [p], i, true);
  });
  function onGpx() { weather(); render(); routeChips(); }
  if (window.gr52Data) onGpx(); else document.addEventListener('trek:gpx', onGpx);
})();
