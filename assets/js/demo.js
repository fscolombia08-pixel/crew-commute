/*
 * Crew Commute: demo data.
 * Makes up a believable (but FAKE) U.S. schedule in the exact shape AeroDataBox returns,
 * so the whole site can be tried before the real data key is connected.
 */
(function (root) {
  'use strict';
  var CC = root.CC = root.CC || {};
  var T = CC.time, AP = CC.airports;
  var D = CC.demo = {};
  var MIN = 60000;

  var HUBS = {
    AA: ['DFW', 'CLT', 'MIA', 'PHL', 'ORD', 'PHX', 'DCA', 'JFK', 'LAX'],
    UA: ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX'],
    DL: ['ATL', 'DTW', 'MSP', 'SLC', 'JFK', 'LAX', 'SEA', 'BOS', 'LGA'],
    WN: ['DAL', 'HOU', 'MDW', 'BWI', 'DEN', 'LAS', 'PHX', 'BNA', 'MCO', 'OAK', 'AUS', 'STL'],
    B6: ['JFK', 'BOS', 'FLL', 'MCO'],
    AS: ['SEA', 'PDX', 'SFO', 'LAX'],
    F9: ['DEN', 'MCO', 'LAS', 'PHL', 'ATL', 'MIA']
  };
  var LEISURE = ['F9', 'WN', 'B6'];
  /* Demo flights only exist between these airports (big airports, Florida, Hawaii, Alaska and the territories). */
  var DEMO_AIRPORTS = ['ABQ', 'ALB', 'ANC', 'ATL', 'AUS', 'BDL', 'BNA', 'BOI', 'BOS', 'BQN', 'BUF', 'BUR', 'BWI', 'CHS', 'CLE',
    'CLT', 'CMH', 'COS', 'CVG', 'DAL', 'DCA', 'DEN', 'DFW', 'DTW', 'ELP', 'EWR', 'EYW', 'FAI', 'FLL', 'GEG', 'GUM', 'HNL', 'HOU',
    'HPN', 'IAD', 'IAH', 'IND', 'ISP', 'ITO', 'JAX', 'JFK', 'JNU', 'KOA', 'LAS', 'LAX', 'LGA', 'LGB', 'LIH', 'MCI', 'MCO', 'MDW',
    'MEM', 'MIA', 'MKE', 'MSP', 'MSY', 'MYR', 'OAK', 'OGG', 'OKC', 'ONT', 'ORD', 'ORF', 'PBI', 'PDX', 'PHL', 'PHX', 'PIT', 'PNS',
    'PPG', 'PSE', 'PVD', 'RDU', 'RIC', 'RNO', 'RSW', 'SAN', 'SAT', 'SAV', 'SDF', 'SEA', 'SFO', 'SJC', 'SJU', 'SLC', 'SMF', 'SNA',
    'SPN', 'SRQ', 'STL', 'STT', 'STX', 'SYR', 'TLH', 'TPA', 'TUL', 'TUS'];
  var DEMO_SET = new Set(DEMO_AIRPORTS);
  D.covers = function (code) { return DEMO_SET.has(code); };
  var CALLSIGN = { AA: 'AAL', UA: 'UAL', DL: 'DAL', WN: 'SWA', B6: 'JBU', AS: 'ASA', HA: 'HAL', F9: 'FFT', BB: 'SBS' };
  var NAMES = {
    AA: 'American Airlines', UA: 'United Airlines', DL: 'Delta Air Lines', WN: 'Southwest Airlines',
    B6: 'JetBlue Airways', AS: 'Alaska Airlines', HA: 'Hawaiian Airlines', F9: 'Frontier Airlines',
    BB: 'Seaborne Airlines'
  };
  var REGIONALS = { AA: ['ENY', 'PDT', 'JIA'], UA: ['SKW', 'RPA', 'GJS'], DL: ['EDV', 'SKW', 'RPA'], AS: ['QXE', 'SKW'] };
  var REG_SUFFIX = { AA: 'AA', UA: 'UA', DL: 'DN', WN: 'WN', B6: 'JB', AS: 'AS', HA: 'HA', F9: 'FR', BB: 'SB',
    ENY: 'NN', PDT: 'PS', JIA: 'NJ', SKW: 'SY', RPA: 'YX', GJS: 'GJ', EDV: 'PQ', QXE: 'QX' };
  var SHARES = { AA: ['BA', 'QR', 'AS'], UA: ['LH', 'AC', 'NH'], DL: ['AF', 'KL', 'KE'], AS: ['AA', 'QF'], B6: ['EI'], HA: ['JL'] };

  function r01(seed) { return CC.rng(CC.hash(seed))(); }
  function isHub(c, code) { return HUBS[c] && HUBS[c].indexOf(code) >= 0; }
  function region(code) { var a = AP.get(code); return a ? a.region : ''; }
  function inList(code, list) { return list.indexOf(code) >= 0; }

  /* Special markets: Hawaii, Alaska, Guam, Saipan, American Samoa, Puerto Rico, USVI. */
  function remote(a, b) {
    var ra = region(a), rb = region(b);
    var R = ['HI', 'AK', 'GU', 'MP', 'AS', 'PR', 'VI'];
    if (R.indexOf(ra) < 0 && R.indexOf(rb) < 0) return null;
    var pair = function (x, y) { return (a === x && b === y) || (a === y && b === x); };
    var other = R.indexOf(ra) >= 0 ? b : a, here = R.indexOf(ra) >= 0 ? a : b, rh = region(here);
    var out = [];
    var add = function (c, p) { if (r01(c + a + b + 'remote') < p) out.push(c); };
    if (ra === rb && ra === 'HI') { add('HA', 1); if (inList('HNL', [a, b])) add('WN', 0.7); return out; }
    if (pair('HNL', 'GUM')) return ['UA'];
    if (pair('GUM', 'SPN')) return ['UA'];
    if (pair('HNL', 'PPG')) return ['HA'];
    if (rh === 'GU' || rh === 'MP' || rh === 'AS') return [];
    if (rh === 'HI') {
      var big = here === 'HNL' ? 0.95 : 0.5;
      if (inList(other, ['LAX', 'SFO', 'SEA', 'PDX', 'OAK', 'SJC', 'SAN', 'SMF', 'LAS', 'PHX', 'JFK', 'BOS'])) add('HA', big);
      if (inList(other, ['SFO', 'LAX', 'DEN', 'IAH', 'ORD', 'EWR', 'IAD'])) add('UA', big);
      if (inList(other, ['SEA', 'PDX', 'SFO', 'LAX', 'SAN', 'SJC', 'ANC'])) add('AS', big);
      if (inList(other, ['DFW', 'PHX', 'LAX', 'ORD', 'CLT'])) add('AA', big);
      if (inList(other, ['ATL', 'LAX', 'SEA', 'SLC', 'MSP', 'JFK'])) add('DL', big);
      if (inList(other, ['OAK', 'SJC', 'SMF', 'LAS', 'PHX', 'SAN'])) add('WN', big * 0.8);
      return out;
    }
    if (rh === 'AK') {
      if (ra === rb) { add('AS', 1); return out; }
      if (here === 'ANC') {
        if (inList(other, ['SEA', 'PDX', 'LAX', 'SFO', 'SAN', 'ORD', 'DEN', 'LAS', 'PHX'])) add('AS', 0.95);
        if (inList(other, ['SEA', 'MSP', 'SLC', 'ATL'])) add('DL', 0.7);
        if (inList(other, ['DEN', 'ORD', 'SFO', 'IAH', 'EWR'])) add('UA', 0.7);
        if (inList(other, ['DFW', 'PHX', 'ORD'])) add('AA', 0.5);
      } else if (inList(other, ['SEA', 'PDX'])) add('AS', 0.95);
      return out;
    }
    if (rh === 'PR' || rh === 'VI') {
      if ((ra === 'PR' || ra === 'VI') && (rb === 'PR' || rb === 'VI')) {
        if (inList('SJU', [a, b]) && (rh === 'VI' || region(other) === 'VI')) add('BB', 1);
        return out;
      }
      var m = {
        SJU: { AA: ['MIA', 'CLT', 'DFW', 'PHL', 'JFK', 'ORD'], B6: ['JFK', 'BOS', 'FLL', 'MCO', 'EWR'], DL: ['ATL', 'JFK'],
          UA: ['EWR', 'IAD', 'ORD', 'IAH'], F9: ['MCO', 'MIA', 'PHL', 'ATL'], WN: ['MCO', 'BWI', 'FLL', 'TPA', 'HOU'] },
        BQN: { B6: ['JFK', 'MCO', 'FLL'], UA: ['EWR'] },
        PSE: { B6: ['JFK', 'MCO'] },
        STT: { AA: ['MIA', 'CLT', 'JFK'], DL: ['ATL', 'JFK'], UA: ['EWR'], B6: ['JFK'] },
        STX: { AA: ['MIA'], DL: ['ATL'] }
      }[here] || {};
      Object.keys(m).forEach(function (c) { if (inList(other, m[c])) add(c, here === 'SJU' ? 0.95 : 0.8); });
      return out;
    }
    return out;
  }

  var carrierCache = new Map();
  function carriersFor(a, b) {
    var k = a + b;
    if (carrierCache.has(k)) return carrierCache.get(k);
    var out = remote(a, b);
    if (!out) {
      out = [];
      var dist = AP.distanceMi(a, b);
      if (dist >= 110) {
        Object.keys(HUBS).forEach(function (c) {
          var ha = isHub(c, a), hb = isHub(c, b);
          if (!ha && !hb) return;
          var p = (ha && hb) ? 0.92 : 0.62;
          if (LEISURE.indexOf(c) >= 0) p *= 0.7;
          if (dist > 2700) p *= 0.3;
          /* use an order-free seed so A->B and B->A get the same airlines */
          var s = [a, b].sort().join('');
          if (r01(c + s) < p) out.push(c);
        });
        if (!out.length && dist > 200 && dist < 1500 && r01('WN' + [a, b].sort().join('')) < 0.15) out.push('WN');
      }
    }
    carrierCache.set(k, out);
    return out;
  }

  function model(c, dist, regional, seed) {
    var x = r01(seed + 'm');
    if (regional) return x < 0.55 ? 'Embraer 175' : (x < 0.85 ? 'Bombardier CRJ900' : 'Embraer 145');
    if (c === 'BB') return 'ATR 72';
    if (c === 'HA') return dist < 400 ? 'Boeing 717-200' : (dist > 2600 ? 'Airbus A330-200' : 'Airbus A321neo');
    if (c === 'WN') return x < 0.5 ? 'Boeing 737-700' : 'Boeing 737 MAX 8';
    if (c === 'F9') return x < 0.5 ? 'Airbus A320neo' : 'Airbus A321neo';
    if (c === 'B6') return dist < 900 && x < 0.4 ? 'Airbus A220-300' : (x < 0.7 ? 'Airbus A320' : 'Airbus A321');
    if (c === 'AS') return x < 0.5 ? 'Boeing 737-900' : 'Boeing 737 MAX 9';
    if (dist > 2400) return x < 0.5 ? 'Boeing 787-9' : 'Boeing 777-200';
    if (dist > 1300) return c === 'AA' ? 'Airbus A321' : (c === 'UA' ? 'Boeing 737-900' : 'Airbus A321');
    if (c === 'AA') return x < 0.5 ? 'Boeing 737-800' : 'Airbus A319';
    if (c === 'UA') return x < 0.5 ? 'Airbus A320' : 'Boeing 737 MAX 8';
    if (c === 'DL') return x < 0.5 ? 'Airbus A321' : 'Boeing 737-900';
    return 'Airbus A320';
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtUtc(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + 'Z';
  }
  function fmtLocal(ms, tz) {
    var z = T.zoned(ms, tz), o = z.offsetMin, s = o < 0 ? '-' : '+';
    o = Math.abs(o);
    return z.wall + s + pad(Math.floor(o / 60)) + ':' + pad(o % 60);
  }
  function apt(code) {
    var a = AP.get(code);
    return { icao: a ? a.icao : '', iata: code, name: a ? a.name : code, shortName: a ? a.city : code, countryCode: 'US', timeZone: a ? a.tz : undefined };
  }

  /* Timetable for one direction, one carrier, one local date (stable day to day). */
  var flightCache = new Map();
  D.flights = function (a, b, date) {
    var key = a + '|' + b + '|' + date;
    if (flightCache.has(key)) return flightCache.get(key);
    var out = [];
    if (!DEMO_SET.has(a) || !DEMO_SET.has(b) || !AP.get(a) || !AP.get(b)) { flightCache.set(key, out); return out; }
    var dist = AP.distanceMi(a, b);
    var tzA = AP.tz(a), tzB = AP.tz(b);
    var wd = T.weekday(date);
    carriersFor(a, b).forEach(function (c) {
      if ((a === 'PPG' || b === 'PPG') && wd !== 1 && wd !== 4) return;
      var rnd = CC.rng(CC.hash(c + a + b));
      var ha = isHub(c, a), hb = isHub(c, b);
      var n = (ha && hb) ? 5 : ((ha || hb) ? 3 : 1);
      if (dist > 2000) n = Math.max(1, n - 2);
      if (LEISURE.indexOf(c) >= 0) n = Math.max(1, n - 2);
      if (region(a) === 'HI' && region(b) === 'HI') n = 6;
      if (['GU', 'MP', 'AS'].indexOf(region(a)) >= 0 || ['GU', 'MP', 'AS'].indexOf(region(b)) >= 0) n = 1;
      n += Math.floor(rnd() * 3);
      var first = 5 * 60 + 30 + Math.floor(rnd() * 150);
      var lastDep = 20 * 60 + 30 + Math.floor(rnd() * 70);
      var step = n > 1 ? (lastDep - first) / (n - 1) : 0;
      var westToEast = (AP.get(b) || {}).lon - (AP.get(a) || {}).lon > 20 && dist > 1800 && region(a) !== 'HI';
      for (var k = 0; k < n; k++) {
        var seed = c + a + b + k;
        var depMin = Math.round((first + k * step + (r01(seed + 'j') - 0.5) * 40) / 5) * 5;
        if (westToEast && k === n - 1 && r01(seed + 'red') < 0.6) depMin = 22 * 60 + 5 * Math.floor(r01(seed + 'rt') * 18);
        if (wd === 6 && n > 2 && r01(seed + date.slice(0, 7) + 'sat') < 0.25) continue;
        depMin = CC.clamp(depMin, 5 * 60, 23 * 60 + 55);
        var regional = !!REGIONALS[c] && dist < 1000 && !(ha && hb) && r01(seed + 'reg') < 0.6;
        var opCs = regional ? REGIONALS[c][Math.floor(r01(seed + 'op') * REGIONALS[c].length)] : CALLSIGN[c];
        var num = regional ? 3000 + (CC.hash(seed + 'n') % 3999) : 100 + (CC.hash(seed + 'n') % 2899);
        var block = AP.blockMinutes(a, b) + Math.round((r01(seed + 'b') - 0.3) * 20);
        var hh = pad(Math.floor(depMin / 60)), mm = pad(depMin % 60);
        var depUtc = T.localToUtc(date, hh + ':' + mm, tzA);
        out.push({
          c: c, num: num, cs: opCs + num, opCs: opCs, regional: regional, a: a, b: b,
          depUtc: depUtc, arrUtc: depUtc + block * MIN, model: model(c, dist, regional, seed),
          seed: seed + date, tzA: tzA, tzB: tzB, share: (!regional && SHARES[c] && r01(seed + 'cs') < 0.35) ? SHARES[c][Math.floor(r01(seed + 'csw') * SHARES[c].length)] : null
        });
      }
    });
    flightCache.set(key, out);
    return out;
  };

  /* Live-looking status for flights close to now. */
  function liveInfo(f) {
    var now = Date.now();
    var r = CC.rng(CC.hash(f.seed + 'live'));
    var x = r();
    var near = Math.abs(f.depUtc - now) < 36 * 3600000;
    var info = { status: 'Expected', depRev: null, arrRev: null, reg: '', term: '', gate: '', aterm: '', agate: '' };
    if (!near) return info;
    var delay = 0;
    if (x < 0.2) delay = 10 + Math.round(r() * 90);
    if (x > 0.985) info.status = 'Canceled';
    var dep = f.depUtc + delay * MIN, arr = f.arrUtc + delay * MIN;
    if (info.status !== 'Canceled') {
      if (arr < now) info.status = 'Arrived';
      else if (dep < now) info.status = 'EnRoute';
      else if (delay >= 15) info.status = 'Delayed';
      if (delay) { info.depRev = dep; info.arrRev = arr; }
    }
    var suf = REG_SUFFIX[f.regional ? f.opCs : f.c] || 'XX';
    info.reg = 'N' + (100 + (CC.hash(f.seed + 'tail') % 900)) + suf;
    var termOf = function (code, c) { return ['A', 'B', 'C', 'D', 'E'][CC.hash(code + c) % 5]; };
    info.term = termOf(f.a, f.c); info.gate = info.term + (1 + (CC.hash(f.seed + 'g') % 40));
    info.aterm = termOf(f.b, f.c); info.agate = info.aterm + (1 + (CC.hash(f.seed + 'ag') % 40));
    return info;
  }

  function toAdb(f, opts) {
    var li = liveInfo(f);
    var live = Math.abs(f.depUtc - Date.now()) < 36 * 3600000;
    var mk = function (code, ms, tz, rev, term, gate) {
      var o = { airport: apt(code), scheduledTime: { utc: fmtUtc(ms), local: fmtLocal(ms, tz) }, quality: live ? ['Basic', 'Live'] : ['Basic'] };
      if (rev) o.revisedTime = { utc: fmtUtc(rev), local: fmtLocal(rev, tz) };
      if (term) o.terminal = term;
      if (gate) o.gate = gate;
      return o;
    };
    var item = {
      departure: mk(f.a, f.depUtc, f.tzA, li.depRev, li.term, li.gate),
      arrival: mk(f.b, f.arrUtc, f.tzB, li.arrRev, li.aterm, li.agate),
      number: f.c + ' ' + f.num,
      callSign: f.cs,
      status: li.status,
      codeshareStatus: 'IsOperator',
      isCargo: false,
      aircraft: li.reg ? { model: f.model, reg: (opts && opts.reg) || li.reg } : { model: f.model },
      airline: { name: NAMES[f.c] || f.c, iata: f.c, icao: CALLSIGN[f.c] || '' }
    };
    var items = [item];
    if (f.share) {
      var copy = JSON.parse(JSON.stringify(item));
      copy.number = f.share + ' ' + (5000 + (CC.hash(f.seed + 'cn') % 4000));
      copy.codeshareStatus = 'IsCodeshared';
      copy.airline = { name: f.share, iata: f.share };
      delete copy.callSign;
      items.push(copy);
    }
    return items;
  }

  /* One half-day airport board, like /flights/airports/iata/{code}/{from}/{to}?withLeg=true&direction=Both */
  D.board = function (airport, date, half) {
    var range = CC.engine.halfRange(airport, date, half);
    var res = { departures: [], arrivals: [] };
    DEMO_AIRPORTS.forEach(function (code) {
      var o = { iata: code };
      if (o.iata === airport) return;
      D.flights(airport, o.iata, date).forEach(function (f) {
        if (f.depUtc >= range[0] && f.depUtc <= range[1]) res.departures = res.departures.concat(toAdb(f));
      });
      [-1, 0, 1].forEach(function (dd) {
        D.flights(o.iata, airport, T.addDays(date, dd)).forEach(function (f) {
          if (f.arrUtc >= range[0] && f.arrUtc <= range[1]) res.arrivals = res.arrivals.concat(toAdb(f));
        });
      });
    });
    return res;
  };

  /* Flight status by number (uses a known leg as a hint). */
  D.flight = function (number, date, hint) {
    if (!hint) return [];
    var fl = findFlight(hint);
    return fl ? toAdb(fl).slice(0, 1) : [];
  };

  function findFlight(leg) {
    var cand = D.flights(leg.from, leg.to, leg.depDate);
    return cand.find(function (f) { return f.depUtc === leg.depUtc && f.c === leg.carrier; }) || null;
  }

  /* Aircraft rotation for the day: two earlier legs that end where our flight starts, then our flight. */
  D.aircraft = function (reg, date, hint) {
    if (!hint) return [];
    var fl = findFlight(hint);
    if (!fl) return [];
    var r = CC.rng(CC.hash(reg + date + 'rot'));
    var hubs = (HUBS[fl.c] || ['ATL', 'DFW', 'ORD']).filter(function (h) { return h !== fl.a; });
    var prev = hubs[Math.floor(r() * hubs.length)] || 'ATL';
    var turn = 35 + Math.floor(r() * 35);
    var block1 = AP.blockMinutes(prev, fl.a);
    var arr1 = fl.depUtc - turn * MIN;
    var lateBy = r() < 0.45 ? 20 + Math.floor(r() * 70) : 0;
    var num1 = fl.num > 120 ? fl.num - 7 : fl.num + 11;
    var leg1 = {
      c: fl.c, num: num1, cs: fl.opCs + num1, opCs: fl.opCs, regional: fl.regional,
      a: prev, b: fl.a, depUtc: arr1 - block1 * MIN, arrUtc: arr1, model: fl.model, seed: fl.seed + 'in1',
      tzA: AP.tz(prev), tzB: AP.tz(fl.a)
    };
    var prev2 = (HUBS[fl.c] || ['ATL']).filter(function (h) { return h !== prev; })[0] || 'DFW';
    var block0 = AP.blockMinutes(prev2, prev);
    var arr0 = leg1.depUtc - (40 + Math.floor(r() * 30)) * MIN;
    var leg0 = Object.assign({}, leg1, { a: prev2, b: prev, depUtc: arr0 - block0 * MIN, arrUtc: arr0, seed: fl.seed + 'in0', num: num1 + 300, cs: fl.opCs + (num1 + 300), tzA: AP.tz(prev2), tzB: AP.tz(prev) });
    var items = [leg0, leg1].map(function (L, idx) {
      var it = toAdb(L, { reg: reg })[0];
      it.aircraft = { model: fl.model, reg: reg };
      var delay = idx === 1 ? lateBy : Math.round(lateBy * 0.7);
      var now = Date.now();
      if (delay) {
        it.departure.revisedTime = { utc: fmtUtc(L.depUtc + delay * MIN), local: fmtLocal(L.depUtc + delay * MIN, L.tzA) };
        it.arrival.revisedTime = { utc: fmtUtc(L.arrUtc + delay * MIN), local: fmtLocal(L.arrUtc + delay * MIN, L.tzB) };
      }
      var arrAt = L.arrUtc + delay * MIN, depAt = L.depUtc + delay * MIN;
      it.status = arrAt < now ? 'Arrived' : (depAt < now ? 'EnRoute' : (delay >= 15 ? 'Delayed' : 'Expected'));
      return it;
    });
    var mine = toAdb(fl, { reg: reg })[0];
    mine.aircraft = { model: fl.model, reg: reg };
    items.push(mine);
    return items;
  };

  /* FAA airport status (same XML shape as nasstatus.faa.gov). */
  D.faa = function () {
    return '<?xml version="1.0" encoding="UTF-8"?><AIRPORT_STATUS_INFORMATION><Update_Time>' + new Date().toUTCString() +
      '</Update_Time><Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><Ground_Delay><ARPT>EWR</ARPT>' +
      '<Reason>low ceilings</Reason><Avg>45 minutes</Avg><Max>1 hour and 31 minutes</Max></Ground_Delay></Ground_Delay_List></Delay_type>' +
      '<Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List><Delay><ARPT>SFO</ARPT>' +
      '<Reason>WX:Low Ceilings</Reason><Arrival_Departure Type="Arrival"><Min>16 minutes</Min><Max>30 minutes</Max>' +
      '<Trend>Increasing</Trend></Arrival_Departure></Delay></Arrival_Departure_Delay_List></Delay_type>' +
      '<Delay_type><Name>Ground Stops</Name><Ground_Stop_List><Program><ARPT>ORD</ARPT><Reason>thunderstorms</Reason>' +
      '<End_Time>5:45 pm CDT</End_Time></Program></Ground_Stop_List></Delay_type></AIRPORT_STATUS_INFORMATION>';
  };

  /* METAR + TAF (same JSON fields as aviationweather.gov). */
  D.wx = function (icaos) {
    var now = new Date();
    var ddhhmm = pad(now.getUTCDate()) + pad(now.getUTCHours()) + '53Z';
    var metar = [], taf = [];
    icaos.forEach(function (id) {
      var bad = { KEWR: 'IFR', KSFO: 'MVFR', KORD: 'MVFR' }[id];
      var r = CC.rng(CC.hash(id + now.toISOString().slice(0, 13)));
      var wdir = Math.floor(r() * 36) * 10, wspd = 4 + Math.floor(r() * 14);
      var clouds = bad === 'IFR' ? [{ cover: 'OVC', base: 700 }] : bad === 'MVFR' ? [{ cover: 'BKN', base: 2500 }] : [{ cover: 'FEW', base: 4000 }, { cover: 'SCT', base: 25000 }];
      var vis = bad === 'IFR' ? 2 : bad === 'MVFR' ? 6 : '10+';
      var sky = clouds.map(function (c) { return c.cover + pad(Math.round(c.base / 100)).padStart(3, '0'); }).join(' ');
      var raw = id + ' ' + ddhhmm + ' ' + String(wdir).padStart(3, '0') + pad(wspd) + 'KT ' + (vis === '10+' ? '10' : vis) + 'SM ' +
        (bad === 'IFR' ? 'BR ' : '') + sky + ' 24/18 A3001';
      metar.push({ icaoId: id, rawOb: raw, reportTime: now.toISOString(), visib: vis, clouds: clouds, wspd: wspd, wdir: wdir });
      taf.push({ icaoId: id, rawTAF: 'TAF ' + id + ' ' + pad(now.getUTCDate()) + '1720Z ' + pad(now.getUTCDate()) + '18/' + pad(now.getUTCDate() + 1) + '24 ' +
        String(wdir).padStart(3, '0') + pad(wspd) + 'KT P6SM ' + sky + ' FM' + pad(now.getUTCDate()) + '2300 18008KT P6SM SCT035' });
    });
    return { metar: metar, taf: taf };
  };
})(typeof window !== 'undefined' ? window : globalThis);
