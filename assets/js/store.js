/* Crew Commute: settings and saved trips (kept in this browser only). */
(function (root) {
  'use strict';
  var CC = root.CC = root.CC || {};
  var KEY = 'crew-commute-v1';
  var mem = null;

  var DEFAULTS = {
    lang: (typeof navigator !== 'undefined' && /^es/i.test(navigator.language || '')) ? 'es' : 'en',
    timeFmt: '24h',
    groupCode: '',
    apiBase: '',
    forceDemo: false,
    minConnSame: 35,
    minConnOther: 60,
    maxConn: 360,
    maxStops: 1,
    backupsWanted: 1,
    commuteBuffer: 60,
    nightBefore: true,
    noRedeye: false,
    myAirlines: [],
    onlyMine: false,
    sort: 'best',
    trips: []
  };

  function load() {
    if (mem) return mem;
    mem = {};
    try {
      var raw = root.localStorage && root.localStorage.getItem(KEY);
      if (raw) mem = JSON.parse(raw) || {};
    } catch (e) { mem = {}; }
    return mem;
  }
  function save() {
    try { if (root.localStorage) root.localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* private mode: keep in memory */ }
  }

  CC.store = {
    defaults: DEFAULTS,
    get: function (k) {
      var s = load();
      return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : DEFAULTS[k];
    },
    set: function (k, v) { load()[k] = v; save(); },
    reset: function () { mem = {}; save(); },
    trips: function () { return (CC.store.get('trips') || []).slice(); },
    addTrip: function (trip) {
      var list = CC.store.trips().filter(function (t) { return t.name !== trip.name; });
      list.unshift(trip);
      CC.store.set('trips', list.slice(0, 12));
    },
    removeTrip: function (name) {
      CC.store.set('trips', CC.store.trips().filter(function (t) { return t.name !== name; }));
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
