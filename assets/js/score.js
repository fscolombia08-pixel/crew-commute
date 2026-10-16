/*
 * Crew Commute: on-time history and trip warnings.
 * The site does NOT estimate loads or open seats (no public source has them).
 * It only points out facts that can make a trip fail: tight connections, airline changes,
 * delays right now, FAA ground stops, bad weather, flights that are often late, a late inbound plane.
 */
(function (root) {
  'use strict';
  var CC = root.CC = root.CC || {};
  var S = CC.score = {};
  var MIN = 60000;

  /* On-time history for this flight number (or this airline on the route), from BTS. */
  S.onTime = function (leg) {
    var o = CC.data.ontime && CC.data.ontime[leg.from];
    if (!o) return null;
    var row = o.f && (o.f[leg.carrier + leg.num + '-' + leg.to] || (leg.opIata && o.f[leg.opIata + leg.num + '-' + leg.to]));
    var src = 'flight';
    if (!row) { row = o.c && (o.c[leg.carrier + '-' + leg.to] || (leg.opIata && o.c[leg.opIata + '-' + leg.to])); src = 'route'; }
    if (!row || !(row[0] >= 8) || row[1] == null) return null;
    return { n: row[0], ot: row[1], avgDelay: row[2], cxl: row[3], op: row[4] || null, src: src, months: o.months || '' };
  };

  /*
   * Warnings for one itinerary. ctx = { faa, wx, inbound, minConnSame, minConnOther, fastestMin }
   * Returns [{ t: text key, p: params, level: 'high' | 'warn' | 'info' }]
   */
  S.flags = function (it, ctx) {
    ctx = ctx || {};
    var out = [];
    function add(level, t, p) { out.push({ level: level, t: t, p: p || {} }); }

    if (it.legs.some(function (l) { return l.canceled; })) add('high', 'f_canceled');

    it.legs.forEach(function (leg) {
      var late = isFinite(leg.depEst) ? Math.round((leg.depEst - leg.depUtc) / MIN) : 0;
      if (late >= 15) add('warn', 'f_late_now', { f: leg.flight, n: late });
      var ib = ctx.inbound && ctx.inbound[leg.id];
      if (ib && ib.state === 'late') add('warn', 'f_inbound_late', { f: leg.flight, n: ib.depDelay });
      if (ib && ib.state === 'prev_canceled') add('warn', 'f_inbound_canceled', { f: leg.flight });
      var ot = S.onTime(leg);
      if (ot && ot.src === 'flight' && (ot.ot < 65 || ot.cxl >= 4)) add('info', 'f_often_late', { f: leg.flight, ot: ot.ot, cxl: ot.cxl });
    });

    it.conns.forEach(function (c, i) {
      var need = c.same ? ctx.minConnSame : ctx.minConnOther;
      var slack = c.min - (need || 0);
      if (slack < 15) add('warn', 'f_tight', { a: c.at, n: c.min });
      if (!c.same) add('info', 'f_change', { a: c.at });
      if (c.overnight) add('info', 'f_overnight', { a: c.at });
      var prev = it.legs[i];
      if (isFinite(prev.arrEst) && prev.arrEst - prev.arrUtc > slack * MIN) add('high', 'f_conn_live', { f: prev.flight, a: c.at });
      else {
        var ot = S.onTime(prev);
        if (ot && ot.src === 'flight' && ot.avgDelay > slack && slack < 60) add('info', 'f_conn_hist', { f: prev.flight, n: Math.round(ot.avgDelay) });
      }
    });

    var airports = [it.from].concat(it.conns.map(function (c) { return c.at; }), [it.to]);
    var faa = ctx.faa || {}, wx = ctx.wx || {};
    airports.forEach(function (a) {
      (faa[a] || []).forEach(function (ev) {
        add(ev.type === 'GS' || ev.type === 'CLOSED' ? 'high' : 'warn', 'f_faa_' + ev.type, { a: a });
      });
      var w = wx[CC.airports.icao(a)];
      if (w && (w.cat === 'IFR' || w.cat === 'LIFR')) add('info', 'f_wx', { a: a, c: w.cat });
    });

    if (ctx.fastestMin && it.durMin > ctx.fastestMin * 1.8 && it.durMin > ctx.fastestMin + 180) {
      add('info', 'f_long_trip', { d: CC.time.fmtDur(it.durMin) });
    }

    /* no duplicates; most serious first */
    var seen = new Set(), order = { high: 0, warn: 1, info: 2 };
    return out.filter(function (f) {
      var k = f.t + JSON.stringify(f.p);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort(function (a, b) { return order[a.level] - order[b.level]; });
  };

  /* Worst level among the flags (for the card's colored edge). */
  S.level = function (flags) {
    if (flags.some(function (f) { return f.level === 'high'; })) return 'high';
    if (flags.some(function (f) { return f.level === 'warn'; })) return 'warn';
    return 'ok';
  };
})(typeof window !== 'undefined' ? window : globalThis);
