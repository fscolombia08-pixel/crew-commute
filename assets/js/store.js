/* Crew Commute: settings and saved trips (kept in this browser only), and the access code. */
(function (root) {
  'use strict';
  var CC = root.CC = root.CC || {};
  var KEY = 'crew-commute-v1';
  var mem = null;

  var DEFAULTS = {
    lang: (typeof navigator !== 'undefined' && /^es/i.test(navigator.language || '')) ? 'es' : 'en',
    timeFmt: '24h',
    theme: 'auto',          /* auto (same as the device), light or dark */
    rememberDevice: false,  /* last choice of "Remember me on this device" (the code itself is kept apart, below) */
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
    if (Object.prototype.hasOwnProperty.call(mem, 'groupCode')) { delete mem.groupCode; save(); }   /* older versions kept the code here */
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
    reset: function () { mem = {}; save(); CC.store.forgetCode(); CC.store.setExploring(false); },
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

  /*
   * The access code (called groupCode inside the code; the helper calls it ACCESS_CODE).
   * "Remember me on this device" keeps it in localStorage. Otherwise it lives in sessionStorage,
   * so it disappears when the browser tab is closed (good for shared or public computers).
   * Either way the site asks for it again CODE_DAYS days after it was typed.
   */
  var CODE_KEY = 'crew-commute-code';
  var DEMO_KEY = 'crew-commute-demo';
  var CODE_DAYS = 5;
  var DAY = 86400000;
  var memSlot = { code: null, demo: false };   /* used when the browser blocks storage */

  function readJson(area, key) {
    try { var s = root[area]; return s ? JSON.parse(s.getItem(key) || 'null') : null; } catch (e) { return null; }
  }
  function writeJson(area, key, val) {
    try {
      var s = root[area];
      if (!s) return false;
      if (val == null) s.removeItem(key); else s.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) { return false; }
  }
  function validSlot(v) { return v && typeof v.code === 'string' && v.code && isFinite(v.at) ? v : null; }
  function currentSlot() {
    return validSlot(readJson('sessionStorage', CODE_KEY)) || validSlot(memSlot.code) || validSlot(readJson('localStorage', CODE_KEY));
  }
  function isOld(v, now) { return now - v.at > CODE_DAYS * DAY || v.at - now > DAY; }   /* also catches a clock set far ahead */

  CC.store.CODE_DAYS = CODE_DAYS;
  /* The code to send to the helper, or '' when there is none or it is more than CODE_DAYS days old. */
  CC.store.code = function () {
    var v = currentSlot();
    if (!v) return '';
    if (isOld(v, Date.now())) {
      CC.store.forgetCode();
      CC.store.set('codeExpired', true);   /* so the pop-up can say why it is asking again */
      return '';
    }
    return v.code;
  };
  /* { remembered, askAgainAt } for Settings, or null. */
  CC.store.codeInfo = function () {
    if (!CC.store.code()) return null;
    var v = currentSlot();
    return { remembered: !!v.remember, askAgainAt: v.at + CODE_DAYS * DAY };
  };
  CC.store.codeExpired = function () { CC.store.code(); return CC.store.get('codeExpired') === true; };
  CC.store.saveCode = function (code, remember) {
    var val = { code: String(code), at: Date.now(), remember: !!remember };
    CC.store.forgetCode();
    if (!writeJson(remember ? 'localStorage' : 'sessionStorage', CODE_KEY, val)) memSlot.code = val;
    CC.store.set('rememberDevice', !!remember);
    CC.store.set('codeExpired', false);
  };
  CC.store.forgetCode = function () {
    writeJson('localStorage', CODE_KEY, null);
    writeJson('sessionStorage', CODE_KEY, null);
    memSlot.code = null;
  };

  /* "Explore with demo flights": made-up data for this visit only (never calls the helper). */
  CC.store.exploring = function () {
    var v = readJson('sessionStorage', DEMO_KEY);
    return v === true || memSlot.demo === true;
  };
  CC.store.setExploring = function (on) {
    memSlot.demo = false;
    if (!writeJson('sessionStorage', DEMO_KEY, on ? true : null) && on) memSlot.demo = true;
  };
})(typeof window !== 'undefined' ? window : globalThis);
