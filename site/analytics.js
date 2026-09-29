/* Google Analytics events: what a reader does on the page. build.py loads this file only with a
   trek.json "analytics" id and only on the production hostname, after it has defined gtag.
   It only listens: at the window, in the capture phase, so the page's own handlers that stop a click still count. */
(function () {
  'use strict';
  if (typeof window.gtag !== 'function') throw new Error('analytics.js needs the gtag tag first');
  function send(name, params) { window.gtag('event', name, params || {}); }
  var once = {};
  function sendOnce(key, name, params) { if (once[key]) return; once[key] = true; send(name, params); }
  var lang = function () { return document.documentElement.lang || ''; };

  /* how far down the page a reader got */
  var marks = [25, 50, 75, 100];
  function depth() {
    var max = document.documentElement.scrollHeight - window.innerHeight; if (max <= 0) return;
    var pct = window.scrollY / max * 100;
    marks.forEach(function (m) { if (pct >= m - 1) sendOnce('scroll' + m, 'scroll_depth', { percent: m }); });
  }
  var depthTimer = null;
  window.addEventListener('scroll', function () { clearTimeout(depthTimer); depthTimer = setTimeout(depth, 300); }, { passive: true });

  /* which sections and days a reader reached: a heading or a day block in the upper part of the screen.
     A hidden language's copy never intersects, so each section counts once per page view. */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target, day = el.getAttribute('data-day');
      if (day !== null) sendOnce('day' + day, 'day_view', { day: +day });
      else sendOnce('sec' + el.id, 'section_view', { section: el.id.indexOf('he-') === 0 ? el.id.slice(3) : el.id });
    });
  }, { rootMargin: '0px 0px -50% 0px' });
  document.querySelectorAll('h2[id], .stage[data-day], .wxh[data-day]').forEach(function (el) { io.observe(el); });

  /* pictures and clips opened in the lightbox (log.js sends trek:photo for each one shown) */
  document.addEventListener('trek:photo', function (e) {
    var p = e.detail; send('photo_view', { photo_id: p.id, day: p.day == null ? '' : p.day, media: p.video ? 'video' : 'photo' });
  });

  document.addEventListener('trek:lang', function (e) { send('language_switch', { language: e.detail }); });

  window.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : null; if (!t) return;
    var a;
    if ((a = t.closest('#lightbox .lbdl'))) return send('photo_download', {});
    if ((a = t.closest('a[href$=".gpx"]'))) return send('gpx_download', {});
    if ((a = t.closest('a[data-focus], a[data-go]'))) return send('map_link', { target: (a.getAttribute('data-focus') || a.getAttribute('data-go')).slice(0, 100) });
    if ((a = t.closest('.tabs [data-tab]'))) { var st = a.closest('[data-day]'); return send('tab_view', { tab: a.getAttribute('data-tab'), day: st ? +st.getAttribute('data-day') : '' }); }
    if ((a = t.closest('[data-act="snapshot"]'))) return send('position_snapshot', {});
  }, true);  /* outbound links, site search and the 90% scroll: GA's enhanced measurement counts them */

  /* the first time a reader moves, zooms or taps a map on this page view */
  ['pointerdown', 'wheel'].forEach(function (type) {
    window.addEventListener(type, function (e) { if (e.target.closest && e.target.closest('.livemap')) sendOnce('map', 'map_use', { language: lang() }); }, { capture: true, passive: true });
  });
})();
