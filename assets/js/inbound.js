/*
 * Crew Commute: inbound aircraft check.
 * Finds the plane (tail number) that will fly your flight, looks at its earlier flights today,
 * and estimates whether your departure will be late.
 */
(function (root) {
  'use strict';
  var CC = root.CC = root.CC || {};
  var E = CC.engine, AL = CC.airlines;
  var I = CC.inbound = {};
  var MIN = 60000;

  function match(list, leg) {
    return list.find(function (f) {
      return f.from === leg.from && f.to === leg.to && Math.abs(f.depUtc - leg.depUtc) < 3 * 3600000;
    }) || null;
  }

  /* Returns { state, reg, prev, lateIn, depDelay, eta, rotation }.
     state: unassigned | unknown | first | ok | tight | late | prev_canceled | error */
  I.check = async function (leg) {
    var reg = leg.reg;
    if (!reg) {
      var st = E.normalizeStatus(await CC.api.flight(leg.carrier + leg.num, leg.depDate, leg));
      var me = match(st, leg);
      if (me && me.reg) reg = me.reg;
    }
    if (!reg) return { state: 'unassigned' };

    var rot = E.normalizeStatus(await CC.api.aircraft(reg, leg.depDate, leg))
      .sort(function (a, b) { return a.depUtc - b.depUtc; });
    var mine = match(rot, leg);
    if (!mine) return { state: 'unknown', reg: reg, rotation: rot };
    var before = rot.filter(function (f) {
      return f !== mine && f.to === leg.from && isFinite(f.arrUtc) && f.arrUtc <= leg.depUtc + 30 * MIN;
    }).sort(function (a, b) { return b.arrUtc - a.arrUtc; });
    var prev = before[0] || null;
    if (!prev) return { state: 'first', reg: reg, rotation: rot };
    if (prev.canceled) return { state: 'prev_canceled', reg: reg, prev: prev, rotation: rot };

    var eta = isFinite(prev.arrEst) ? prev.arrEst : prev.arrUtc;
    var turn = (AL.aircraft(leg.model || prev.model) || { turnMin: 35 }).turnMin;
    var ready = eta + turn * MIN;
    var depDelay = Math.max(0, Math.round((ready - leg.depUtc) / MIN));
    var lateIn = Math.round((eta - prev.arrUtc) / MIN);
    var state = depDelay >= 15 ? 'late' : (lateIn >= 15 || depDelay > 0 ? 'tight' : 'ok');
    return { state: state, reg: reg, prev: prev, eta: eta, lateIn: lateIn, depDelay: depDelay, turn: turn, rotation: rot };
  };
})(typeof window !== 'undefined' ? window : globalThis);
