/*
 * Crew Commute: data access.
 * Live mode talks to your Cloudflare helper (worker/worker.js), which holds the secret keys.
 * Demo mode makes up flights in the browser (no account needed).
 */
(function (root) {
  'use strict';
  var CC = root.CC = root.CC || {};
  var api = CC.api = {};
  var memo = new Map();
  var demoUnits = 0;

  function cfg() { return (root.CREW_CONFIG || {}); }
  function setting(k) { return CC.store ? CC.store.get(k) : null; }

  api.base = function () {
    var b = setting('apiBase') || cfg().apiBase || '';
    return String(b).trim().replace(/\/+$/, '');
  };
  api.isDemo = function () { return !api.base() || setting('forceDemo') === true; };

  function ApiError(code, message, status) {
    var e = new Error(message || code);
    e.code = code; e.status = status || 0;
    return e;
  }
  api.ApiError = ApiError;

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ttlMs: how long this answer stays fresh in the page (the helper has its own, longer cache). */
  async function getJson(path, params, asText, ttlMs) {
    var url = new URL(api.base() + path);
    Object.keys(params || {}).forEach(function (k) { if (params[k] != null) url.searchParams.set(k, params[k]); });
    var key = url.toString();
    var hit = memo.get(key);
    if (hit && hit.until > Date.now()) return hit.p;
    var p = (async function () {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 25000) : null;
      var res;
      try {
        res = await fetch(key, { headers: { 'X-Crew-Code': setting('groupCode') || '' }, signal: ctrl ? ctrl.signal : undefined });
      } catch (err) {
        throw ApiError('network', 'Network error');
      } finally {
        if (timer) clearTimeout(timer);
      }
      var body = await res.text();
      var data = null;
      if (!asText || !res.ok) { try { data = body ? JSON.parse(body) : null; } catch (e) { data = null; } }
      if (!res.ok) {
        var code = (data && data.error) || ({ 401: 'bad_code', 429: 'limit', 404: 'not_found' }[res.status]) || 'server';
        throw ApiError(code, (data && data.message) || ('HTTP ' + res.status), res.status);
      }
      var used = res.headers.get('X-Units-Used'), limit = res.headers.get('X-Units-Limit');
      if (used != null) api.lastUsage = { used: +used, limit: limit ? +limit : null };
      return asText ? body : data;
    })();
    memo.set(key, { p: p, until: Date.now() + (ttlMs || 5 * 60000) });
    p.catch(function () { memo.delete(key); });
    return p;
  }
  function boardTtl(date) {
    var days = CC.time.daysBetween(CC.time.deviceToday(), date);
    return days <= 0 ? 10 * 60000 : (days === 1 ? 30 * 60000 : 3 * 3600000);
  }

  /* Half-day airport board (2 data units in live mode when not cached by the helper). */
  api.board = async function (airport, date, half) {
    if (api.isDemo()) {
      var k = 'demo|' + airport + date + half;
      if (!memo.has(k)) { demoUnits += 2; memo.set(k, { p: wait(120).then(function () { return CC.demo.board(airport, date, half); }), until: Infinity }); }
      return memo.get(k).p;
    }
    return getJson('/api/board', { airport: airport, date: date, half: half }, false, boardTtl(date));
  };

  /* Flight status by flight number for a local date. */
  api.flight = async function (number, date, hint) {
    if (api.isDemo()) { demoUnits += 2; await wait(200); return CC.demo.flight(number, date, hint); }
    return getJson('/api/flight', { number: String(number).replace(/\s/g, ''), date: date }, false, 4 * 60000);
  };

  /* All flights of one aircraft (tail number) on a local date. */
  api.aircraft = async function (reg, date, hint) {
    if (api.isDemo()) { demoUnits += 2; await wait(250); return CC.demo.aircraft(reg, date, hint); }
    return getJson('/api/aircraft', { reg: reg, date: date }, false, 4 * 60000);
  };

  /* FAA airport status XML (free, cached by the helper). */
  api.faa = async function () {
    if (api.isDemo()) return CC.demo.faa();
    return getJson('/api/faa', {}, true, 5 * 60000);
  };

  /* METAR + TAF for a list of ICAO codes (free, cached by the helper). */
  api.wx = async function (icaos) {
    icaos = CC.uniq(icaos.filter(Boolean)).slice(0, 12);
    if (!icaos.length) return { metar: [], taf: [] };
    if (api.isDemo()) return CC.demo.wx(icaos);
    return getJson('/api/wx', { ids: icaos.join(',') }, false, 10 * 60000);
  };

  /* Data used this month. */
  api.usage = async function () {
    if (api.isDemo()) return { used: demoUnits, limit: 400, demo: true };
    var u = await getJson('/api/usage', { t: Math.floor(Date.now() / 60000) }, false, 60000);
    api.lastUsage = u;
    return u;
  };

  /* Check the helper address and group code. */
  api.ping = async function () {
    if (api.isDemo()) return { ok: true, demo: true };
    memo.forEach(function (v, k) { if (k.indexOf('/api/usage') >= 0 || k.indexOf('/api/ping') >= 0) memo.delete(k); });
    return getJson('/api/ping', { t: Date.now() }, false, 1000);
  };

  api.clearCache = function () { memo.clear(); };
})(typeof window !== 'undefined' ? window : globalThis);
