/*
 * Crew Commute: route engine.
 * 1. Normalizes AeroDataBox airport boards (FIDS) and flight-status answers.
 * 2. Merges codeshares and duplicates into one record per real flight.
 * 3. Builds one-way itineraries: nonstop, 1 stop and 2 stops, any airline mix.
 * 4. Plans which boards (airport + date + half day) a search needs, to save data units.
 */
(function (root) {
  'use strict';
  var CC = root.CC = root.CC || {};
  var T = CC.time, AP = CC.airports, AL = CC.airlines;
  var E = CC.engine = {};
  var MIN = 60000;
  /* Airlines that actually operate U.S. domestic flights (others are codeshare sellers). */
  var US_OPERATORS = new Set(['AA', 'UA', 'DL', 'WN', 'B6', 'AS', 'HA', 'F9', 'G4', 'SY', 'MX', 'XP',
    '9K', '9X', 'LF', '7H', '4B', 'KS', '3M', 'MW', 'BB', 'OO', 'YX', 'MQ', 'OH', 'PT', '9E', 'YV', 'G7',
    'QX', 'ZW', 'C5', 'CP', 'GQ', '8V', 'Z3', 'DH', '2E']);
  E.US_OPERATORS = US_OPERATORS;

  /* ---------------- normalization ---------------- */

  var STATUSES = ['Unknown', 'Expected', 'EnRoute', 'CheckIn', 'Boarding', 'GateClosed', 'Departed', 'Delayed',
    'Approaching', 'Arrived', 'Canceled', 'Diverted', 'CanceledUncertain'];
  function clean(v, re) {
    v = String(v == null ? '' : v).toUpperCase().replace(/\s+/g, '');
    return re.test(v) ? v : '';
  }
  function text(v, max) { return String(v == null ? '' : v).slice(0, max || 40); }

  /* Airport code from an AeroDataBox airport object. Also learns its time zone and country. */
  function airportCode(a) {
    if (!a) return null;
    var code = clean(a.iata, /^[A-Z0-9]{3}$/);
    if (!code) {
      var icao = clean(a.icao, /^[A-Z0-9]{4}$/);
      code = icao ? (AP.icaoToIata(icao) || icao) : '';
    }
    if (!code) return null;
    if (!AP.get(code) && (a.timeZone || a.countryCode)) AP.learn(code, { tz: a.timeZone, country: a.countryCode });
    return code;
  }

  /* One end of a flight (departure or arrival) in a stable shape. */
  function movement(mv, fallbackAirport) {
    mv = mv || {};
    var code = airportCode(mv.airport) || fallbackAirport || null;
    var sch = mv.scheduledTime || {};
    var schUtc = T.parse(sch.utc || mv.scheduledTimeUtc);
    var schLocalRaw = sch.local || mv.scheduledTimeLocal || '';
    var revObj = mv.revisedTime || mv.predictedTime || null;
    var revUtc = T.parse((revObj && revObj.utc) || mv.actualTimeUtc);
    var runUtc = T.parse((mv.runwayTime && mv.runwayTime.utc) || mv.runwayTimeUtc);
    var local = T.splitLocal(schLocalRaw);
    if ((!local || local.offsetMin == null) && isFinite(schUtc) && code) {
      local = T.zoned(schUtc, AP.tz(code));
    }
    if (!isFinite(schUtc) && local && local.offsetMin != null) {
      schUtc = Date.parse(local.date + 'T' + local.time + ':00Z') - local.offsetMin * MIN;
    }
    return {
      airport: code,
      schUtc: isFinite(schUtc) ? schUtc : NaN,
      date: local ? local.date : '',
      time: local ? local.time : '',
      estUtc: isFinite(runUtc) ? runUtc : (isFinite(revUtc) ? revUtc : NaN),
      terminal: text(mv.terminal, 8),
      gate: text(mv.gate, 8),
      live: Array.isArray(mv.quality) && mv.quality.indexOf('Live') >= 0
    };
  }

  /* Turn one raw AeroDataBox flight object into our flight record (untrusted data is cleaned here). */
  E.normalizeItem = function (it, ctx) {
    if (!it || it.isCargo) return null;
    var dep, arr;
    if (it.departure || it.arrival) {
      dep = movement(it.departure, ctx.list === 'departures' ? ctx.airport : null);
      arr = movement(it.arrival, ctx.list === 'arrivals' ? ctx.airport : null);
    } else if (it.movement) {
      var mv = movement(it.movement, null);
      if (ctx.list === 'departures') {
        dep = Object.assign({}, mv, { airport: ctx.airport });
        arr = { airport: mv.airport, schUtc: NaN, date: '', time: '', estUtc: NaN, terminal: '', gate: '' };
      } else {
        arr = Object.assign({}, mv, { airport: ctx.airport });
        dep = { airport: mv.airport, schUtc: NaN, date: '', time: '', estUtc: NaN, terminal: '', gate: '' };
      }
    } else {
      return null;
    }
    if (!dep.airport || !arr.airport || dep.airport === arr.airport) return null;
    if (!isFinite(dep.schUtc)) return null;

    var split = AL.splitNumber(it.number);
    var carrier = clean(it.airline && it.airline.iata, /^[A-Z0-9]{2}$/) || clean(split.carrier, /^[A-Z0-9]{2,3}$/);
    var num = clean(split.num, /^\d{1,5}[A-Z]?$/);
    if (!carrier || !num) return null;
    var callSign = clean(it.callSign, /^[A-Z0-9]{3,8}$/);
    var op = AL.operatorFromCallsign(callSign);
    var status = STATUSES.indexOf(it.status) >= 0 ? it.status : 'Unknown';
    var aircraft = it.aircraft || {};
    var f = {
      carrier: carrier,
      num: num,
      flight: carrier + ' ' + num,
      airlineName: text((it.airline && it.airline.name) || AL.name(carrier), 40),
      callSign: callSign,
      opIata: op ? op.iata : null,
      opName: op ? op.name : null,
      share: it.codeshareStatus === 'IsCodeshared' || it.codeshareStatus === 'IsOperator' ? it.codeshareStatus : 'Unknown',
      codeshares: [],
      from: dep.airport,
      to: arr.airport,
      depUtc: dep.schUtc,
      arrUtc: arr.schUtc,
      depEst: dep.estUtc,
      arrEst: arr.estUtc,
      depDate: dep.date, depTime: dep.time,
      arrDate: arr.date, arrTime: arr.time,
      depTerminal: dep.terminal, depGate: dep.gate,
      arrTerminal: arr.terminal, arrGate: arr.gate,
      live: !!(dep.live || arr.live),
      status: status,
      canceled: /^Canceled/.test(status),
      model: text(aircraft.model, 48),
      reg: clean(aircraft.reg, /^[A-Z0-9-]{2,10}$/),
      modeS: clean(aircraft.modeS, /^[A-F0-9]{6}$/)
    };
    if (!f.arrDate && isFinite(f.arrUtc)) {
      var z = T.zoned(f.arrUtc, AP.tz(f.to));
      f.arrDate = z.date; f.arrTime = z.time;
    }
    /* Operator: from call sign; same as marketing carrier when the call sign is the mainline one. */
    if (f.opIata && f.opIata === f.carrier) { f.opName = null; }
    f.id = f.from + '-' + f.to + '-' + f.depUtc + '-' + f.carrier + f.num;
    return f;
  };

  /* Merge codeshare copies of the same physical flight into the operating record. */
  E.mergeCodeshares = function (flights) {
    var groups = CC.groupBy(flights, function (f) { return f.from + '|' + f.to + '|' + f.depUtc; });
    var out = [];
    groups.forEach(function (g) {
      if (g.length === 1) { out.push(g[0]); return; }
      var ops = g.filter(function (f) { return f.share !== 'IsCodeshared'; });
      var shares = g.filter(function (f) { return f.share === 'IsCodeshared'; });
      /* A foreign airline on a U.S. domestic leg is a codeshare copy, even when not marked. */
      if (ops.some(function (o) { return US_OPERATORS.has(o.carrier); })) {
        ops = ops.filter(function (o) {
          if (US_OPERATORS.has(o.carrier)) return true;
          shares.push(o);
          return false;
        });
      }
      /* Two "operating" records with the same call sign or tail number are one flight. */
      ops = ops.filter(function (o, i) {
        var twin = ops.slice(0, i).find(function (p) {
          return (o.callSign && p.callSign === o.callSign) || (o.reg && p.reg === o.reg);
        });
        if (twin) { shares.push(o); return false; }
        return true;
      });
      if (!ops.length) { ops = [shares.shift()]; }
      shares.forEach(function (s) {
        var target = null;
        if (ops.length === 1) target = ops[0];
        else {
          target = ops.find(function (o) { return s.callSign && o.callSign === s.callSign; }) ||
            ops.find(function (o) { return s.reg && o.reg === s.reg; }) ||
            ops.find(function (o) { return isFinite(s.arrUtc) && o.arrUtc === s.arrUtc && s.opIata && s.opIata === o.opIata; });
        }
        if (target) {
          if (target.codeshares.indexOf(s.flight) < 0 && s.flight !== target.flight) target.codeshares.push(s.flight);
          fillGaps(target, s);
        }
        /* An unmatched codeshare is dropped: it is a copy of one of the operating flights. */
      });
      ops.forEach(function (o) { out.push(o); });
    });
    return out;
  };

  function fillGaps(t, s) {
    ['depTerminal', 'depGate', 'arrTerminal', 'arrGate', 'model', 'reg', 'modeS', 'callSign', 'opIata', 'opName'].forEach(function (k) {
      if (!t[k] && s[k]) t[k] = s[k];
    });
    if (!isFinite(t.arrUtc) && isFinite(s.arrUtc)) { t.arrUtc = s.arrUtc; t.arrDate = s.arrDate; t.arrTime = s.arrTime; }
    if (!isFinite(t.depEst) && isFinite(s.depEst)) t.depEst = s.depEst;
    if (!isFinite(t.arrEst) && isFinite(s.arrEst)) t.arrEst = s.arrEst;
    if (s.live) t.live = true;
    if ((t.status === 'Unknown' || t.status === 'Expected') && s.status && s.status !== 'Unknown') {
      t.status = s.status; t.canceled = s.canceled;
    }
    (s.codeshares || []).forEach(function (c) { if (t.codeshares.indexOf(c) < 0 && c !== t.flight) t.codeshares.push(c); });
  }

  /* Normalize a whole FIDS board for one airport. */
  E.normalizeBoard = function (raw, airport) {
    raw = raw || {};
    var out = [];
    ['departures', 'arrivals'].forEach(function (list) {
      (raw[list] || []).forEach(function (it) {
        var f = E.normalizeItem(it, { list: list, airport: airport });
        if (f) out.push(f);
      });
    });
    return E.mergeCodeshares(out);
  };

  /* Normalize a flight-status answer (array of flights), e.g. /flights/reg/{reg}/{date}. */
  E.normalizeStatus = function (raw) {
    var arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    return arr.map(function (it) { return E.normalizeItem(it, { list: 'status', airport: null }); })
      .filter(Boolean);
  };

  /* ---------------- flight pool (de-duplicates across boards) ---------------- */

  function numbersOf(f) { return [f.flight].concat(f.codeshares || []); }
  function sameFlight(a, b) {
    if (a.callSign && b.callSign) return a.callSign === b.callSign;
    if (a.reg && b.reg && a.reg !== b.reg) return false;
    var na = numbersOf(a);
    return numbersOf(b).some(function (n) { return na.indexOf(n) >= 0; });
  }

  E.Pool = function () {
    this.byPhys = new Map();
    this.all = [];
  };
  E.Pool.prototype.add = function (flights) {
    var self = this;
    flights.forEach(function (f) {
      var k = f.from + '|' + f.to + '|' + f.depUtc;
      var arr = self.byPhys.get(k);
      if (!arr) { self.byPhys.set(k, arr = []); }
      var hit = arr.find(function (g) { return sameFlight(f, g); });
      if (hit) {
        /* Prefer the operating record as the main one. */
        if (hit.share === 'IsCodeshared' && f.share !== 'IsCodeshared') {
          var keep = Object.assign({}, f, { codeshares: f.codeshares.slice() });
          fillGaps(keep, hit);
          if (keep.codeshares.indexOf(hit.flight) < 0 && hit.flight !== keep.flight) keep.codeshares.push(hit.flight);
          Object.keys(keep).forEach(function (key) { hit[key] = keep[key]; });
        } else {
          fillGaps(hit, f);
          if (f.flight !== hit.flight && hit.codeshares.indexOf(f.flight) < 0 && f.share === 'IsCodeshared') hit.codeshares.push(f.flight);
        }
        /* Fresh live info wins. */
        if (f.live && f.status && f.status !== 'Unknown') { hit.status = f.status; hit.canceled = f.canceled; }
        if (isFinite(f.depEst)) hit.depEst = f.depEst;
        if (isFinite(f.arrEst)) hit.arrEst = f.arrEst;
      } else {
        arr.push(f);
        self.all.push(f);
      }
    });
    return this;
  };
  E.Pool.prototype.departures = function (codes, dates) {
    return this.all.filter(function (f) {
      return codes.has(f.from) && (!dates || dates.has(f.depDate));
    });
  };
  E.Pool.prototype.arrivals = function (codes) {
    return this.all.filter(function (f) { return codes.has(f.to); });
  };

  /* ---------------- itineraries ---------------- */

  function family(f) { return f.carrier; }
  /* Same airline = same marketing carrier (mainline + its Express/Connection flights). */
  E.sameAirline = function (a, b) { return a.carrier === b.carrier; };

  function makeItin(legs) {
    var first = legs[0], last = legs[legs.length - 1];
    var conns = [];
    for (var i = 1; i < legs.length; i++) {
      conns.push({
        at: legs[i].from,
        min: Math.round((legs[i].depUtc - legs[i - 1].arrUtc) / MIN),
        same: E.sameAirline(legs[i - 1], legs[i]),
        overnight: legs[i].depDate !== legs[i - 1].arrDate
      });
    }
    var carriers = CC.uniq(legs.map(family));
    return {
      id: legs.map(function (l) { return l.id; }).join('>'),
      legs: legs,
      from: first.from, to: last.to,
      depUtc: first.depUtc, arrUtc: last.arrUtc,
      depDate: first.depDate, depTime: first.depTime,
      arrDate: last.arrDate, arrTime: last.arrTime,
      durMin: Math.round((last.arrUtc - first.depUtc) / MIN),
      stops: legs.length - 1,
      conns: conns,
      carriers: carriers,
      /* same airlines AND same connection airports = same "routing" */
      sig: legs.map(function (l) { return family(l) + ':' + l.from; }).join('>') + '>' + last.to
    };
  }

  function connOk(a, b, q) {
    if (!isFinite(a.arrUtc) || !isFinite(b.depUtc)) return 0;
    var c = (b.depUtc - a.arrUtc) / MIN;
    var minC = E.sameAirline(a, b) ? q.minConnSame : q.minConnOther;
    if (c < minC) return -1;          // too short
    if (c > q.maxConn) return 1;      // too long
    return 2;                         // ok
  }

  /*
   * Build itineraries.
   * q = { origins:[...], dests:[...], depDates:[...], minConnSame, minConnOther, maxConn,
   *       maxStops (0|1|2), hubs:[...] (airports whose boards were loaded for 2-stop) }
   */
  E.build = function (pool, q) {
    var O = new Set(q.origins), D = new Set(q.dests);
    var dates = q.depDates ? new Set(q.depDates) : null;
    var perCarrier = q.perCarrier || 2;
    var out = new Map();
    function push(legs) {
      if (legs.some(function (l) { return l.canceled && !q.keepCanceled; })) return;
      for (var i = 0; i < legs.length; i++) if (!isFinite(legs[i].arrUtc)) return;
      var it = makeItin(legs);
      if (!out.has(it.id)) out.set(it.id, it);
    }
    var firstLegs = pool.departures(O, dates).filter(function (f) { return !O.has(f.to); });
    var lastLegs = pool.arrivals(D).filter(function (f) { return !D.has(f.from); });
    var lastByFrom = CC.groupBy(lastLegs, function (f) { return f.from; });
    lastByFrom.forEach(function (arr) { arr.sort(function (a, b) { return a.depUtc - b.depUtc; }); });

    /* Nonstop */
    firstLegs.forEach(function (f) { if (D.has(f.to)) push([f]); });

    /* 1 stop */
    if (q.maxStops >= 1) {
      firstLegs.forEach(function (f1) {
        if (D.has(f1.to) || !isFinite(f1.arrUtc) || !AP.isDomestic(f1.to)) return;
        var cands = lastByFrom.get(f1.to);
        if (!cands) return;
        var kept = {};
        for (var i = 0; i < cands.length; i++) {
          var f2 = cands[i];
          if (f2.depUtc <= f1.arrUtc) continue;
          var ok = connOk(f1, f2, q);
          if (ok === 1) break;
          if (ok !== 2) continue;
          var fam = family(f2);
          kept[fam] = (kept[fam] || 0) + 1;
          if (kept[fam] > perCarrier) continue;
          push([f1, f2]);
        }
      });
    }

    /* 2 stops (only through hub boards we loaded) */
    if (q.maxStops >= 2 && q.hubs && q.hubs.length) {
      var H = new Set(q.hubs);
      var mids = pool.departures(H).filter(function (f) { return !O.has(f.to) && !D.has(f.to); });
      var midByFrom = CC.groupBy(mids, function (f) { return f.from; });
      midByFrom.forEach(function (arr) { arr.sort(function (a, b) { return a.depUtc - b.depUtc; }); });
      firstLegs.forEach(function (f1) {
        var X = f1.to;
        if (!H.has(X) || D.has(X) || !isFinite(f1.arrUtc) || !AP.isDomestic(X)) return;
        var midC = midByFrom.get(X);
        if (!midC) return;
        var kept = {};
        for (var i = 0; i < midC.length; i++) {
          var f2 = midC[i];
          if (f2.depUtc <= f1.arrUtc) continue;
          var ok = connOk(f1, f2, q);
          if (ok === 1) break;
          if (ok !== 2) continue;
          var Y = f2.to;
          if (Y === X || O.has(Y) || D.has(Y) || !isFinite(f2.arrUtc) || !AP.isDomestic(Y)) continue;
          var last = lastByFrom.get(Y);
          if (!last) continue;
          for (var j = 0; j < last.length; j++) {
            var f3 = last[j];
            if (f3.depUtc <= f2.arrUtc) continue;
            var ok2 = connOk(f2, f3, q);
            if (ok2 === 1) break;
            if (ok2 !== 2) continue;
            var fam = family(f2) + '+' + family(f3);
            kept[fam] = (kept[fam] || 0) + 1;
            if (kept[fam] > 1) break;
            push([f1, f2, f3]);
            break;
          }
        }
      });
    }
    var all = Array.from(out.values());
    all.sort(function (a, b) { return a.stops - b.stops || a.arrUtc - b.arrUtc; });
    return all.slice(0, q.cap || 5000);
  };

  /* Remove options that are clearly worse on the same routing (same airlines, same connection
     airports): they leave no later and arrive no earlier. Different routings are always kept,
     because a non-rev may prefer a slower routing with better loads. */
  E.prune = function (itins, q) {
    var bySig = CC.groupBy(itins, function (i) { return i.sig; });
    var keep = [];
    bySig.forEach(function (arr) {
      arr.sort(function (a, b) { return a.arrUtc - b.arrUtc || b.depUtc - a.depUtc; });
      var kept = [];
      arr.forEach(function (it) {
        var dominated = kept.some(function (k) {
          return k.depUtc >= it.depUtc && k.arrUtc <= it.arrUtc && (k.depUtc > it.depUtc || k.arrUtc < it.arrUtc);
        });
        if (!dominated) kept.push(it);
      });
      kept.forEach(function (k) { keep.push(k); });
    });
    var cap = (q && q.cap) || 1500;
    keep.sort(function (a, b) { return a.stops - b.stops || a.arrUtc - b.arrUtc; });
    return keep.slice(0, cap);
  };

  /* ---------------- filters, sorting, backups ---------------- */

  E.isRedeye = function (leg) {
    if (!leg.depDate || !leg.arrDate) return false;
    var dm = T.minutesOfDay(leg.depTime), am = T.minutesOfDay(leg.arrTime);
    return leg.arrDate > leg.depDate && am <= 10 * 60 && (dm >= 20 * 60 || dm <= 2 * 60 || (leg.arrUtc - leg.depUtc) / MIN >= 240);
  };

  /* Days between departure and arrival as a traveller feels it: calendar days minus the
     day jump from crossing many time zones (so Honolulu -> Guam is not "next day"). */
  E.nextDay = function (it) {
    if (!it.depDate || !it.arrDate) return 0;
    var cal = T.daysBetween(it.depDate, it.arrDate);
    var offO = T.offsetAt(it.depUtc, AP.tz(it.from)), offD = T.offsetAt(it.depUtc, AP.tz(it.to));
    return cal - Math.round((offD - offO) / 1440);
  };

  /*
   * f = { departAfter, departBefore, arriveAfter, arriveBefore ("HH:MM" local, optional),
   *       arriveByUtc, maxStops, include:[carriers], exclude:[carriers], noRedeye, maxDurMin }
   */
  E.filter = function (itins, f) {
    f = f || {};
    var inc = f.include && f.include.length ? new Set(f.include) : null;
    var exc = f.exclude && f.exclude.length ? new Set(f.exclude) : null;
    var dA = T.minutesOfDay(f.departAfter), dB = T.minutesOfDay(f.departBefore);
    var aA = T.minutesOfDay(f.arriveAfter), aB = T.minutesOfDay(f.arriveBefore);
    return itins.filter(function (it) {
      if (f.maxStops != null && it.stops > f.maxStops) return false;
      var dm = T.minutesOfDay(it.depTime), am = T.minutesOfDay(it.arrTime);
      if (isFinite(dA) && dm < dA) return false;
      if (isFinite(dB) && dm > dB) return false;
      var arrNextDay = E.nextDay(it) > 0;
      if (isFinite(aA) && !arrNextDay && am < aA) return false;
      if (isFinite(aB) && (arrNextDay || am > aB)) return false;
      if (f.arriveByUtc && it.arrUtc > f.arriveByUtc) return false;
      if (f.maxDurMin && it.durMin > f.maxDurMin) return false;
      if (f.noRedeye && it.legs.some(E.isRedeye)) return false;
      if (inc && !it.legs.every(function (l) {
        return inc.has(l.carrier) || (l.codeshares || []).some(function (c) { return inc.has(c.split(' ')[0]); });
      })) return false;
      if (exc && it.legs.some(function (l) { return exc.has(l.carrier) || (l.opIata && exc.has(l.opIata)); })) return false;
      return true;
    });
  };

  E.sort = function (itins, key) {
    var cmp = {
      arrive: function (a, b) { return a.arrUtc - b.arrUtc || b.depUtc - a.depUtc; },
      depart: function (a, b) { return a.depUtc - b.depUtc || a.arrUtc - b.arrUtc; },
      late: function (a, b) { return b.depUtc - a.depUtc || a.arrUtc - b.arrUtc; },
      duration: function (a, b) { return a.durMin - b.durMin || a.arrUtc - b.arrUtc; },
      stops: function (a, b) { return a.stops - b.stops || a.arrUtc - b.arrUtc; }
    }[key] || null;
    return cmp ? itins.slice().sort(cmp) : itins.slice();
  };

  /* For every option: how many other first flights (in options with max 1 stop) leave later and still work. */
  E.backups = function (itins) {
    var firsts = new Map();
    itins.forEach(function (i) { if (i.stops <= 1) firsts.set((i.legs && i.legs[0] && i.legs[0].id) || i.id, i.depUtc); });
    var deps = Array.from(firsts.values()).sort(function (a, b) { return a - b; });
    itins.forEach(function (it) {
      var lo = 0, hi = deps.length;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (deps[mid] <= it.depUtc) lo = mid + 1; else hi = mid; }
      it.backups = deps.length - lo;
    });
    return itins;
  };

  /* Commute plan: Plan A = the latest option that still has `wanted` backups after it. */
  E.commutePlan = function (itins, wanted) {
    var list = E.sort(itins, 'depart');
    E.backups(list);
    var planA = null, short = false;
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].backups >= wanted) { planA = list[i]; break; }
    }
    if (!planA && list.length) { planA = list[0]; short = true; }
    list.forEach(function (it) {
      it.role = null;
      if (!planA) return;
      if (it === planA) it.role = 'planA';
      else if (it.depUtc > planA.depUtc) it.role = it.backups === 0 ? 'last' : 'backup';
    });
    return { list: list, planA: planA, short: short };
  };

  /* ---------------- board planning ---------------- */

  /* UTC range of a half-day board in an airport's local time. */
  E.halfRange = function (airport, date, half) {
    var tz = AP.tz(airport);
    var start = T.localToUtc(date, half ? '12:00' : '00:00', tz);
    var end = T.localToUtc(date, half ? '23:59' : '11:59', tz) + 59999;
    return [start, end];
  };

  /* All half-day boards of `airport` that overlap [fromUtc, toUtc]. */
  E.halvesOverlapping = function (airport, fromUtc, toUtc, cap) {
    var tz = AP.tz(airport), out = [];
    var d = T.zoned(fromUtc, tz).date, last = T.zoned(toUtc, tz).date;
    var guard = 0;
    while (d <= last && guard++ < 10) {
      for (var h = 0; h < 2; h++) {
        var r = E.halfRange(airport, d, h);
        if (r[1] >= fromUtc && r[0] <= toUtc) out.push({ airport: airport, date: d, half: h });
      }
      d = T.addDays(d, 1);
    }
    return cap ? out.slice(0, cap) : out;
  };

  /*
   * Which boards a search needs.
   * s = { origins, dests, dates:[origin-local dates], departAfter, departBefore, arriveByUtc, maxConn, maxStops }
   */
  E.planBoards = function (s) {
    var reqs = [], seen = new Set();
    function add(r) {
      var k = r.airport + '|' + r.date + '|' + r.half;
      if (!seen.has(k)) { seen.add(k); reqs.push(r); }
    }
    var dA = T.minutesOfDay(s.departAfter), dB = T.minutesOfDay(s.departBefore);
    var winStart = Infinity, winEnd = -Infinity;
    s.origins.forEach(function (o) {
      /* fastest possible trip from this origin (used to skip boards that can't make the deadline) */
      var fastest = Infinity;
      s.dests.forEach(function (d) { fastest = Math.min(fastest, AP.blockMinutes(o, d) * 0.85); });
      if (!isFinite(fastest)) fastest = 45;
      var pmOnly = s.earlyDatesPmOnly && fastest < 240;
      s.dates.forEach(function (date) {
        [0, 1].forEach(function (h) {
          if (h === 0 && pmOnly && date !== s.dates[s.dates.length - 1]) return;
          if (h === 0 && isFinite(dA) && dA >= 12 * 60) return;
          if (h === 1 && isFinite(dB) && dB < 12 * 60) return;
          var r = E.halfRange(o, date, h);
          if (s.arriveByUtc && r[0] + fastest * MIN > s.arriveByUtc) return;
          add({ airport: o, date: date, half: h, role: 'origin' });
          winStart = Math.min(winStart, r[0]);
          winEnd = Math.max(winEnd, r[1]);
        });
      });
    });
    if (!isFinite(winStart) || s.maxStops === 0) return reqs;   /* nonstops come from the origin boards */
    s.dests.forEach(function (d) {
      var minTrip = Infinity;
      s.origins.forEach(function (o) { minTrip = Math.min(minTrip, AP.blockMinutes(o, d)); });
      if (!isFinite(minTrip)) minTrip = 120;
      var maxTrip = minTrip * 1.7 + (s.maxStops >= 1 ? s.maxConn : 0) * Math.max(1, s.maxStops) + 90;
      var from = winStart + Math.max(30, minTrip - 30) * MIN;
      var to = winEnd + maxTrip * MIN;
      if (s.arriveByUtc) to = Math.min(to, s.arriveByUtc);
      var cap = s.arriveByUtc ? 4 : 3 + (s.dates.length - 1) * 2;
      E.halvesOverlapping(d, from, to, cap).forEach(function (r) { r.role = 'dest'; add(r); });
    });
    return reqs;
  };

  /*
   * Choose up to `k` hub airports for 2-stop searches and the boards needed there.
   * Uses BTS route history when loaded, otherwise the list of major hubs.
   */
  E.planHubs = function (pool, s, k) {
    k = k || 3;
    var O = new Set(s.origins), D = new Set(s.dests);
    var dates = s.dates ? new Set(s.dates) : null;
    var first = pool.departures(O, dates).filter(function (f) { return !O.has(f.to) && !D.has(f.to) && isFinite(f.arrUtc) && AP.isDomestic(f.to); });
    var lastFrom = new Set(pool.arrivals(D).map(function (f) { return f.from; }));
    var routes = CC.data.routes && CC.data.routes.r;
    var score = new Map();
    first.forEach(function (f) {
      var X = f.to, sc = 1;
      if (AP.MAJOR_HUBS.indexOf(X) >= 0) sc += 2;
      if (routes) {
        var reach = 0;
        lastFrom.forEach(function (Y) { if (Y !== X && routes[X + '-' + Y]) reach++; });
        sc += reach * 2;
      } else if (lastFrom.has(X)) {
        sc -= 2;   /* already a 1-stop point; 2-stop search should look elsewhere */
      }
      score.set(X, (score.get(X) || 0) + sc);
    });
    var hubs = Array.from(score.entries()).sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, k).map(function (e) { return e[0]; });
    var reqs = [];
    hubs.forEach(function (X) {
      var arrs = first.filter(function (f) { return f.to === X; }).map(function (f) { return f.arrUtc; });
      if (!arrs.length) return;
      var from = Math.min.apply(null, arrs), to = Math.max.apply(null, arrs) + s.maxConn * MIN;
      E.halvesOverlapping(X, from, to, 2).forEach(function (r) { r.role = 'hub'; reqs.push(r); });
    });
    return { hubs: hubs, boards: reqs };
  };
})(typeof window !== 'undefined' ? window : globalThis);
