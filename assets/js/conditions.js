/* Crew Commute: FAA airport status (ground stops, delay programs) and METAR/TAF weather. */
(function (root) {
  'use strict';
  var CC = root.CC = root.CC || {};
  var C = CC.conditions = {};

  function decode(s) {
    return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
  }
  function all(xml, tag) {
    var re = new RegExp('<' + tag + '\\b([^>]*)>([\\s\\S]*?)</' + tag + '>', 'g'), out = [], m;
    while ((m = re.exec(xml))) out.push({ attrs: m[1], body: m[2] });
    return out;
  }
  function one(xml, tag) {
    var m = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>').exec(xml);
    return m ? decode(m[1]) : '';
  }

  /* nasstatus.faa.gov/api/airport-status-information (XML) -> { "EWR": [ {type, reason, ...} ] } */
  C.parseFaa = function (xml) {
    var out = {};
    if (!xml || typeof xml !== 'string') return out;
    function add(code, ev) {
      code = (code || '').toUpperCase().trim();
      if (!code) return;
      (out[code] = out[code] || []).push(ev);
    }
    all(xml, 'Ground_Delay_List').forEach(function (list) {
      all(list.body, 'Ground_Delay').forEach(function (g) {
        add(one(g.body, 'ARPT'), { type: 'GDP', reason: one(g.body, 'Reason'), avg: one(g.body, 'Avg'), max: one(g.body, 'Max') });
      });
    });
    all(xml, 'Ground_Stop_List').forEach(function (list) {
      all(list.body, 'Program').forEach(function (p) {
        add(one(p.body, 'ARPT'), { type: 'GS', reason: one(p.body, 'Reason'), end: one(p.body, 'End_Time') });
      });
    });
    all(xml, 'Arrival_Departure_Delay_List').forEach(function (list) {
      all(list.body, 'Delay').forEach(function (d) {
        var code = one(d.body, 'ARPT'), reason = one(d.body, 'Reason');
        var parts = all(d.body, 'Arrival_Departure');
        if (!parts.length) add(code, { type: 'DLY', reason: reason });
        parts.forEach(function (p) {
          var dir = (/Type="([^"]+)"/.exec(p.attrs) || [])[1] || '';
          add(code, { type: 'DLY', dir: dir, reason: reason, min: one(p.body, 'Min'), max: one(p.body, 'Max'), trend: one(p.body, 'Trend') });
        });
      });
    });
    all(xml, 'Airport_Closure_List').forEach(function (list) {
      all(list.body, 'Airport').forEach(function (a) {
        add(one(a.body, 'ARPT'), { type: 'CLOSED', reason: one(a.body, 'Reason'), start: one(a.body, 'Start'), reopen: one(a.body, 'Reopen') });
      });
    });
    return out;
  };

  function parseVis(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    v = String(v).replace('+', '').replace(/SM$/i, '').trim();
    if (/^\d+\s+\d+\/\d+$/.test(v)) { var p = v.split(/\s+/); var f = p[1].split('/'); return +p[0] + f[0] / f[1]; }
    if (/^\d+\/\d+$/.test(v)) { var q = v.split('/'); return q[0] / q[1]; }
    return parseFloat(v);
  }

  /* VFR / MVFR / IFR / LIFR from a METAR object (aviationweather.gov JSON). */
  var CATS = ['VFR', 'MVFR', 'IFR', 'LIFR'];
  C.flightCategory = function (m) {
    if (!m) return null;
    if (CATS.indexOf(m.fltCat) >= 0) return m.fltCat;
    var vis = parseVis(m.visib);
    var ceil = Infinity;
    (m.clouds || []).forEach(function (c) {
      if (/BKN|OVC|OVX|VV/i.test(c.cover || '') && c.base != null) ceil = Math.min(ceil, +c.base);
    });
    if (m.vertVis != null) ceil = Math.min(ceil, +m.vertVis * (m.vertVis < 100 ? 100 : 1));
    if (ceil < 500 || vis < 1) return 'LIFR';
    if (ceil < 1000 || vis < 3) return 'IFR';
    if (ceil <= 3000 || vis <= 5) return 'MVFR';
    return 'VFR';
  };

  /* { metar:[...], taf:[...] } -> { ICAO: { cat, raw, taf, wind } } */
  C.parseWx = function (wx) {
    var out = {};
    if (!wx) return out;
    (wx.metar || []).forEach(function (m) {
      var id = (m.icaoId || m.stationId || '').toUpperCase();
      if (!id) return;
      out[id] = { cat: C.flightCategory(m), raw: m.rawOb || m.rawText || '', time: m.reportTime || '', taf: '' };
    });
    (wx.taf || []).forEach(function (t) {
      var id = (t.icaoId || t.stationId || '').toUpperCase();
      if (!id) return;
      out[id] = out[id] || { cat: null, raw: '', time: '' };
      out[id].taf = t.rawTAF || t.rawText || '';
    });
    return out;
  };

  /* Short "impact" level of FAA events at an airport: 0 none, 1 minor, 2 major, 3 closed. */
  C.faaLevel = function (events) {
    if (!events || !events.length) return 0;
    var lvl = 0;
    events.forEach(function (e) {
      if (e.type === 'CLOSED') lvl = Math.max(lvl, 3);
      else if (e.type === 'GS') lvl = Math.max(lvl, 2);
      else if (e.type === 'GDP') lvl = Math.max(lvl, 2);
      else lvl = Math.max(lvl, 1);
    });
    return lvl;
  };
})(typeof window !== 'undefined' ? window : globalThis);
