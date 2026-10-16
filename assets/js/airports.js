/* Crew Commute: airport lookup, search and distances. */
(function (root) {
  'use strict';
  var CC = root.CC = root.CC || {};
  var A = CC.airports = {};
  var byIata = new Map(), byIcao = new Map(), list = [];

  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  /* Major connecting airports. Used to pick 2-stop hubs when no route history is loaded. */
  A.MAJOR_HUBS = ['ATL', 'DFW', 'DEN', 'ORD', 'CLT', 'IAH', 'LAX', 'PHX', 'LAS', 'MSP', 'DTW', 'SEA',
    'SFO', 'EWR', 'JFK', 'BOS', 'MIA', 'FLL', 'MCO', 'SLC', 'PHL', 'IAD', 'BWI', 'MDW', 'DAL', 'HOU',
    'AUS', 'BNA', 'SAN', 'PDX', 'HNL', 'ANC', 'SJU', 'LGA', 'DCA', 'TPA', 'STL', 'MCI', 'OAK', 'SJC'];

  A.init = function () {
    byIata.clear(); byIcao.clear(); list = [];
    (CC.data.airports || []).forEach(function (r) {
      var a = {
        iata: r[0], icao: r[1] || '', name: r[2] || '', city: r[3] || '', region: r[4] || '',
        lat: +r[5], lon: +r[6], tz: r[7] || 'America/New_York'
      };
      a._s = fold(a.iata + ' ' + a.city + ' ' + a.name + ' ' + a.icao);
      a._city = fold(a.city);
      list.push(a);
      byIata.set(a.iata, a);
      if (a.icao) byIcao.set(a.icao, a);
    });
    return list.length;
  };
  A.all = function () { return list; };
  A.get = function (code) {
    if (!code) return null;
    code = String(code).toUpperCase();
    return byIata.get(code) || byIcao.get(code) || null;
  };
  A.icaoToIata = function (icao) {
    var a = icao && byIcao.get(String(icao).toUpperCase());
    return a ? a.iata : null;
  };
  /* Airports we only know from flight data (not in our list): remember their time zone and country. */
  var extra = new Map();
  var DOMESTIC = { US: 1, PR: 1, VI: 1, GU: 1, MP: 1, AS: 1 };
  A.learn = function (code, info) {
    if (!code || byIata.has(code) || byIcao.has(code)) return;
    var tz = info && info.tz && /^[A-Za-z_]+(\/[A-Za-z_+\-0-9]+){1,2}$/.test(info.tz) ? info.tz : null;
    var country = info && info.country ? String(info.country).toUpperCase().slice(0, 2) : null;
    var old = extra.get(code) || {};
    extra.set(code, { tz: tz || old.tz || null, country: country || old.country || null });
  };
  A.tz = function (code) {
    var a = A.get(code);
    if (a) return a.tz;
    var x = extra.get(code);
    return (x && x.tz) || 'America/New_York';
  };
  /* Inside the U.S. (50 states + territories)? Connections are only allowed at these airports. */
  A.isDomestic = function (code) {
    if (A.get(code)) return true;
    var x = extra.get(code);
    return !!(x && x.country && DOMESTIC[x.country]);
  };
  A.icao = function (code) {
    var a = A.get(code);
    if (a && a.icao) return a.icao;
    return code && code.length === 3 ? 'K' + code : code;
  };
  A.label = function (code) {
    var a = A.get(code);
    return a ? a.city + ' (' + a.iata + ')' : code;
  };

  /* Autocomplete search: exact code first, then city, then name. */
  A.search = function (q, limit) {
    limit = limit || 8;
    q = fold(q).trim();
    if (!q) return [];
    var up = q.toUpperCase(), out = [];
    list.forEach(function (a) {
      var rank = -1;
      if (a.iata === up) rank = 0;
      else if (a.icao === up) rank = 1;
      else if (a.iata.indexOf(up) === 0) rank = 2;
      else if (a._city.indexOf(q) === 0) rank = 3;
      else if (a._s.indexOf(q) >= 0) rank = 4;
      if (rank >= 0) out.push({ a: a, rank: rank });
    });
    out.sort(function (x, y) {
      return x.rank - y.rank || (A.MAJOR_HUBS.indexOf(y.a.iata) >= 0) - (A.MAJOR_HUBS.indexOf(x.a.iata) >= 0) ||
        x.a.iata.localeCompare(y.a.iata);
    });
    return out.slice(0, limit).map(function (x) { return x.a; });
  };

  A.distanceMi = function (c1, c2) {
    var a = A.get(c1), b = A.get(c2);
    if (!a || !b) return NaN;
    var R = 3958.8, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  /* Airports within `miles` of an airport (for "nearby airport" suggestions). */
  A.nearby = function (code, miles) {
    miles = miles || 60;
    var src = A.get(code);
    if (!src) return [];
    return list.filter(function (a) {
      return a.iata !== src.iata && A.distanceMi(src.iata, a.iata) <= miles;
    }).sort(function (x, y) { return A.distanceMi(src.iata, x.iata) - A.distanceMi(src.iata, y.iata); });
  };

  /* Rough scheduled block time in minutes for a nonstop between two airports. */
  A.blockMinutes = function (c1, c2) {
    var d = A.distanceMi(c1, c2);
    if (!isFinite(d)) return 180;
    return Math.round(35 + d / 7.6);
  };

  A.init();
})(typeof window !== 'undefined' ? window : globalThis);
