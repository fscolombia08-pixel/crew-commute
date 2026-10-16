/*
 * Crew Commute: core helpers (namespace, escaping, time and date math).
 * Plain browser script, no build step. Also loads in Node for tests.
 */
(function (root) {
  'use strict';
  var CC = root.CC = root.CC || {};
  CC.data = CC.data || {};
  CC.data.ontime = CC.data.ontime || {};
  CC.version = '1.0.0';

  /* ---------- small utils ---------- */
  CC.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  CC.clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  CC.uniq = function (arr) { return Array.from(new Set(arr)); };
  CC.groupBy = function (arr, keyFn) {
    var m = new Map();
    arr.forEach(function (x) {
      var k = keyFn(x);
      var a = m.get(k);
      if (!a) m.set(k, a = []);
      a.push(x);
    });
    return m;
  };
  /* Deterministic 32-bit hash (FNV-1a), used by demo data and ids. */
  CC.hash = function (str) {
    var h = 0x811c9dc5;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };
  /* Seeded random generator (mulberry32). */
  CC.rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ---------- time ---------- */
  var T = CC.time = {};
  var MIN = 60000;
  T.MIN = MIN;

  /* Parse a timestamp that carries a zone ("2026-10-20 14:05Z", "2026-10-20 10:05-04:00",
     ISO with T). Returns epoch ms, or NaN when there is no zone information. */
  T.parse = function (s) {
    if (!s) return NaN;
    s = String(s).trim().replace(' ', 'T');
    s = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    if (!/(Z|[+-]\d{2}:\d{2})$/i.test(s)) return NaN;
    var ms = Date.parse(s);
    return isFinite(ms) ? ms : NaN;
  };

  /* "2026-10-20 10:05-04:00" -> { wall: "2026-10-20 10:05", offsetMin: -240 } */
  T.splitLocal = function (s) {
    if (!s) return null;
    s = String(s).trim().replace('T', ' ');
    var m = s.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
    if (!m) return null;
    var off = null;
    if (m[3]) {
      if (/z/i.test(m[3])) off = 0;
      else {
        var sign = m[3][0] === '-' ? -1 : 1;
        var hh = parseInt(m[3].slice(1, 3), 10), mm = parseInt(m[3].slice(-2), 10);
        off = sign * (hh * 60 + mm);
      }
    }
    return { wall: m[1] + ' ' + m[2], date: m[1], time: m[2], offsetMin: off };
  };

  var fmtCache = {};
  function formatter(tz) {
    var f = fmtCache[tz];
    if (!f) {
      /* hour12:false works on older phones too (some show midnight as 24, fixed below) */
      var opts = { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
      try { f = new Intl.DateTimeFormat('en-US', opts); }
      catch (e) { opts.timeZone = 'UTC'; f = new Intl.DateTimeFormat('en-US', opts); }   /* unknown zone name */
      fmtCache[tz] = f;
    }
    return f;
  }
  /* Wall-clock parts of an instant in a time zone. */
  T.zoned = function (ms, tz) {
    var p = {};
    formatter(tz || 'UTC').formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    var hour = p.hour === '24' ? '00' : p.hour;
    var date = p.year + '-' + p.month + '-' + p.day;
    var time = hour + ':' + p.minute;
    var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute);
    var floored = Math.floor(ms / MIN) * MIN;
    return { date: date, time: time, wall: date + ' ' + time, offsetMin: Math.round((asUtc - floored) / MIN) };
  };
  T.offsetAt = function (ms, tz) { return T.zoned(ms, tz).offsetMin; };

  /* Local wall time at a zone -> epoch ms. Handles DST edges. */
  T.localToUtc = function (dateStr, timeStr, tz) {
    var d = dateStr.split('-').map(Number), t = (timeStr || '00:00').split(':').map(Number);
    var guess = Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1] || 0);
    var off1 = T.offsetAt(guess - 0, tz);
    var ms = guess - off1 * MIN;
    var off2 = T.offsetAt(ms, tz);
    if (off2 !== off1) ms = guess - off2 * MIN;
    return ms;
  };

  T.addDays = function (dateStr, n) {
    var d = dateStr.split('-').map(Number);
    var ms = Date.UTC(d[0], d[1] - 1, d[2]) + n * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  };
  T.daysBetween = function (a, b) { // b - a in days
    var x = a.split('-').map(Number), y = b.split('-').map(Number);
    return Math.round((Date.UTC(y[0], y[1] - 1, y[2]) - Date.UTC(x[0], x[1] - 1, x[2])) / 86400000);
  };
  T.weekday = function (dateStr) { // 0 = Sunday
    var d = dateStr.split('-').map(Number);
    return new Date(Date.UTC(d[0], d[1] - 1, d[2])).getUTCDay();
  };
  T.month = function (dateStr) { return parseInt(dateStr.slice(5, 7), 10); };
  T.minutesOfDay = function (hhmm) {
    if (!hhmm) return NaN;
    var p = hhmm.split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  };
  T.todayIn = function (tz) { return T.zoned(Date.now(), tz || 'UTC').date; };
  T.deviceToday = function () {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  /* Formatting */
  T.fmtClock = function (hhmm, mode, lang) {
    if (!hhmm) return '--:--';
    if (mode !== '12h') return hhmm;
    var p = hhmm.split(':'), h = parseInt(p[0], 10);
    var pm = h >= 12;
    h = h % 12 || 12;
    var ap = lang === 'es' ? (pm ? 'p.\u00a0m.' : 'a.\u00a0m.') : (pm ? 'PM' : 'AM');   /* no line break inside "p. m." */
    return h + ':' + p[1] + '\u00a0' + ap;
  };
  T.fmtDur = function (min) {
    if (!isFinite(min)) return '';
    min = Math.round(min);
    var h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + 'm';
    return h + 'h ' + String(m).padStart(2, '0') + 'm';
  };
  T.fmtDate = function (dateStr, lang, opts) {
    var d = dateStr.split('-').map(Number);
    var dt = new Date(Date.UTC(d[0], d[1] - 1, d[2], 12));
    return dt.toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US',
      Object.assign({ weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }, opts || {}));
  };
})(typeof window !== 'undefined' ? window : globalThis);
