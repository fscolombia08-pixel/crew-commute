/* Crew Commute: busy travel periods in the U.S. (they make standby harder). */
(function (root) {
  'use strict';
  var CC = root.CC = root.CC || {};
  var T = CC.time;
  var H = CC.holidays = {};

  function nthWeekday(year, month, weekday, n) { // month 1-12, weekday 0=Sun, n>=1
    var first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    var day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }
  function lastWeekday(year, month, weekday) {
    var last = new Date(Date.UTC(year, month, 0));
    var diff = (last.getUTCDay() - weekday + 7) % 7;
    return new Date(Date.UTC(year, month - 1, last.getUTCDate() - diff)).toISOString().slice(0, 10);
  }
  function easter(year) { // Anonymous Gregorian algorithm
    var a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
    var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }
  function within(date, start, end) { return date >= start && date <= end; }

  /* Returns { key, impact } for the busiest period that contains `date`, or null. */
  H.check = function (date) {
    var y = +date.slice(0, 4), md = date.slice(5);
    var best = null;
    function hit(key, impact) { if (!best || impact > best.impact) best = { key: key, impact: impact }; }

    var tg = nthWeekday(y, 11, 4, 4);
    if (within(date, T.addDays(tg, -3), T.addDays(tg, 4))) {
      hit('thanksgiving', (date === T.addDays(tg, -1) || date === T.addDays(tg, 3)) ? 20 : 13);
    }
    if (md >= '12-18' || md <= '01-04') {
      var peak = (md >= '12-20' && md <= '12-23') || md === '12-26' || md === '12-27' || (md >= '01-01' && md <= '01-03');
      hit('winter_holidays', peak ? 18 : 12);
    }
    var j4 = y + '-07-04';
    if (within(date, T.addDays(j4, -3), T.addDays(j4, 3))) hit('july4', 10);
    var mem = lastWeekday(y, 5, 1);
    if (within(date, T.addDays(mem, -3), mem)) hit('memorial', 10);
    var lab = nthWeekday(y, 9, 1, 1);
    if (within(date, T.addDays(lab, -3), lab)) hit('labor', 10);
    var mlk = nthWeekday(y, 1, 1, 3), pres = nthWeekday(y, 2, 1, 3);
    if (within(date, T.addDays(mlk, -3), mlk)) hit('long_weekend', 6);
    if (within(date, T.addDays(pres, -3), pres)) hit('long_weekend', 6);
    var ea = easter(y);
    if (within(date, T.addDays(ea, -2), T.addDays(ea, 1))) hit('easter', 7);
    if (md >= '03-07' && md <= '04-12') hit('spring_break', 6);
    if (md >= '06-15' && md <= '08-15') hit('summer', 5);
    return best;
  };
})(typeof window !== 'undefined' ? window : globalThis);
