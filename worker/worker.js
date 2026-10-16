/**
 * Crew Commute helper (Cloudflare Worker, free plan).
 *
 * What it does:
 *  - Keeps your flight-data key secret (the website never sees it).
 *  - Only answers people who send the right group code.
 *  - Saves answers for a while (Workers KV), so friends who search the same airports
 *    share one lookup and you spend fewer data units.
 *  - Stops before your monthly data limit, so you never pay by surprise.
 *
 * Settings in Cloudflare (Worker > Settings > Variables and Secrets):
 *   ACCESS_CODE      secret   The group code your friends type in the site.
 *   ADB_KEY          secret   Your AeroDataBox key (RapidAPI "X-RapidAPI-Key").
 *   ALLOWED_ORIGINS  text     Your site address, e.g. https://yourname.github.io (comma-separated list allowed).
 *   MONTHLY_UNITS    text     Your plan's monthly units, e.g. 400 (free plan) or 5000 (Pro).
 *   ADB_BASE         text     Optional. Default: https://aerodatabox.p.rapidapi.com
 *   ADB_KEY_HEADER   text     Optional. Default: X-RapidAPI-Key
 *   ADB_RPS          text     Optional. Requests per second your plan allows. Default: 1
 * Binding (Worker > Settings > Bindings > KV namespace):
 *   CACHE            A KV namespace. Optional, but strongly recommended.
 */

const VERSION = '1.0.0';
const UNIT_COST = 2;            // AeroDataBox "Tier 2" endpoints cost 2 units per call
const UA = 'CrewCommute/1.0 (free crew commuting tool)';
const inflight = new Map();     // joins identical requests that arrive at the same time
const memCache = new Map();     // small per-instance cache for weather
const fails = new Map();        // wrong group codes per visitor (slows down guessing)
let queue = Promise.resolve();  // one AeroDataBox call at a time (plans allow ~1 per second)
let lastCall = 0;
const localUsed = new WeakMap();           // this instance's own count per KV namespace (KV can lag a little)
const NO_KV = {};
let providerLeft = null;        // units left on the plan, when the provider tells us

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request.headers.get('Origin') || '');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'method', message: 'Only GET is allowed' }, 405, cors);
    if (url.pathname === '/' || url.pathname === '') {
      return new Response('Crew Commute helper is running. Version ' + VERSION, { headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    if (!url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404, cors);
    if (!env.ACCESS_CODE) return json({ error: 'setup', message: 'ACCESS_CODE is not set in Cloudflare' }, 500, cors);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const f = fails.get(ip);
    if (f && f.n >= 8 && f.until > Date.now()) {
      return json({ error: 'slow_down', message: 'Too many wrong codes. Try again in 15 minutes.' }, 429, cors);
    }
    if (!(await codeOk(request.headers.get('X-Crew-Code') || '', env.ACCESS_CODE))) {
      const g = f && f.until > Date.now() ? f : { n: 0, until: 0 };
      g.n += 1;
      g.until = Date.now() + 15 * 60000;
      fails.set(ip, g);
      if (fails.size > 5000) fails.clear();
      return json({ error: 'bad_code', message: 'Wrong or missing group code' }, 401, cors);
    }
    if (f) fails.delete(ip);
    try {
      switch (url.pathname) {
        case '/api/ping': return json({ ok: true, version: VERSION, kv: !!env.CACHE, key: !!env.ADB_KEY }, 200, cors);
        case '/api/usage': return json(await usage(env), 200, cors);
        case '/api/board': return await board(url, env, ctx, cors);
        case '/api/flight': return await flightStatus(url, env, ctx, cors, 'number');
        case '/api/aircraft': return await flightStatus(url, env, ctx, cors, 'reg');
        case '/api/faa': return await faa(env, ctx, cors);
        case '/api/wx': return await weather(url, env, ctx, cors);
        default: return json({ error: 'not_found' }, 404, cors);
      }
    } catch (e) {
      return json({ error: e.code || 'server', message: e.message || 'Server error' }, e.status || 500, cors);
    }
  }
};

/* ---------------- helpers ---------------- */

function err(code, message, status) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  return e;
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function corsHeaders(env, origin) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  let allow = '*';
  if (allowed.length) {
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    allow = allowed.includes(origin) || local ? origin : allowed[0];
  }
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'X-Crew-Code, Content-Type',
    'Access-Control-Expose-Headers': 'X-Cache',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

/* Compare the group code in constant time (spaces and capital letters don't matter). */
async function codeOk(given, real) {
  const norm = (s) => String(s).trim().toLowerCase();
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(norm(given))),
    crypto.subtle.digest('SHA-256', enc.encode(norm(real)))
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0 && norm(given).length > 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayUtc = () => new Date().toISOString().slice(0, 10);
const monthKey = () => 'usage:' + new Date().toISOString().slice(0, 7);
function daysFromToday(date) {
  return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(todayUtc() + 'T00:00:00Z')) / 86400000);
}

/* Shared cache: edge cache (fast, per data center) -> KV (shared) -> producer. */
async function cached(ctx, env, key, ttlSec, useKv, producer) {
  const edge = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const cacheUrl = 'https://crew-commute-cache.internal/' + encodeURIComponent(key);
  if (edge) {
    try {
      const hit = await edge.match(cacheUrl);
      if (hit) return { body: await hit.text(), src: 'edge' };
    } catch (e) { /* edge cache not available: fine */ }
  }
  if (!useKv) {
    const m = memCache.get(key);
    if (m && m.until > Date.now()) return { body: m.body, src: 'mem' };
  }
  if (useKv && env.CACHE) {
    const v = await env.CACHE.get(key);
    if (v !== null && v !== undefined) {
      if (edge) ctx.waitUntil(edgePut(edge, cacheUrl, v, Math.min(ttlSec, 600)));
      return { body: v, src: 'kv' };
    }
  }
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const body = await producer();
    if (useKv && env.CACHE) ctx.waitUntil(env.CACHE.put(key, body, { expirationTtl: Math.max(60, ttlSec) }).catch(() => {}));
    if (!useKv) {
      memCache.set(key, { body, until: Date.now() + ttlSec * 1000 });
      if (memCache.size > 200) memCache.delete(memCache.keys().next().value);
    }
    if (edge) ctx.waitUntil(edgePut(edge, cacheUrl, body, ttlSec));
    return { body, src: 'miss' };
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}
async function edgePut(edge, url, body, ttl) {
  try {
    await edge.put(url, new Response(body, { headers: { 'Cache-Control': 'public, max-age=' + Math.max(60, ttl) } }));
  } catch (e) { /* ignore */ }
}

function sendCached(r, cors, type) {
  return new Response(r.body, {
    status: 200,
    headers: { ...cors, 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Cache': r.src }
  });
}

/* ---------------- data budget ---------------- */

function currentMonth() { return new Date().toISOString().slice(0, 7); }
async function readUsed(env) {
  const m = currentMonth();
  let kv = 0;
  if (env.CACHE) kv = parseInt((await env.CACHE.get(monthKey())) || '0', 10) || 0;
  const mine = localUsed.get(env.CACHE || NO_KV);
  const local = mine && mine.month === m ? mine.units : 0;
  return Math.max(kv, local);
}
async function usage(env) {
  const limit = parseInt(env.MONTHLY_UNITS || '0', 10) || null;
  const used = env.CACHE ? await readUsed(env) : null;
  return { month: currentMonth(), used, limit, kv: !!env.CACHE, providerLeft };
}
/* Reserve the units BEFORE calling the provider. Keeps a small safety margin because
   Workers KV is not a strict counter. The provider's own plan limit is the final stop. */
async function reserve(env, cost) {
  const limit = parseInt(env.MONTHLY_UNITS || '0', 10);
  if (providerLeft !== null && providerLeft < cost) throw err('limit', 'The flight data plan has no units left this month', 429);
  if (!limit) return;
  const used = await readUsed(env);
  const margin = limit >= 100 ? Math.max(cost, Math.round(limit * 0.02)) : 0;
  if (used + cost > limit - margin) throw err('limit', 'This month\'s data limit (' + limit + ' units) is used up', 429);
  const m = currentMonth();
  localUsed.set(env.CACHE || NO_KV, { month: m, units: used + cost });
  if (env.CACHE) {
    try { await env.CACHE.put(monthKey(), String(used + cost), { expirationTtl: 40 * 86400 }); } catch (e) { /* see localUsed */ }
  }
}
/* Run provider calls one at a time, spaced to the plan's requests-per-second. */
function queued(env, fn) {
  const rps = Math.max(0.2, parseFloat(env.ADB_RPS || '1') || 1);
  const gap = Math.ceil(1000 / rps) + 50;
  const run = queue.then(async () => {
    const wait = lastCall + gap - Date.now();
    if (wait > 0) await sleep(wait);
    try { return await fn(); } finally { lastCall = Date.now(); }
  });
  queue = run.catch(() => {});
  return run;
}

/* ---------------- AeroDataBox ---------------- */

async function adb(env, path) {
  if (!env.ADB_KEY) throw err('provider_auth', 'The flight data key (ADB_KEY) is not set in Cloudflare', 500);
  const base = String(env.ADB_BASE || 'https://aerodatabox.p.rapidapi.com').replace(/\/+$/, '');
  const headers = { Accept: 'application/json', 'User-Agent': UA };
  headers[env.ADB_KEY_HEADER || 'X-RapidAPI-Key'] = env.ADB_KEY;
  if (/rapidapi\.com$/i.test(new URL(base).host)) headers['X-RapidAPI-Host'] = new URL(base).host;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(base + path, { headers });
    noteProviderQuota(res.headers);
    if (res.status === 204) return { body: '{}', billed: true };
    const text = await res.text();
    if (res.ok) return { body: text || '{}', billed: true };
    if (res.status === 429) {
      if (/quota|exceeded|limit for/i.test(text) || attempt === 2) throw err('provider_limit', 'The flight data plan limit was reached', 429);
      await sleep(1100 * (attempt + 1)); /* small plans allow about 1 request per second */
      continue;
    }
    if (res.status === 401 || res.status === 403) throw err('provider_auth', 'The flight data key was refused. Check ADB_KEY and your plan subscription.', 502);
    if (res.status === 400 || res.status === 404) throw err('provider_bad_request', shortMessage(text) || 'Not available for this airport or date', 400);
    if (attempt < 2 && res.status >= 500) { await sleep(800); continue; }
    throw err('provider', 'Flight data service error ' + res.status, 502);
  }
  throw err('provider', 'Flight data service did not answer', 502);
}
/* RapidAPI and similar marketplaces send "...remaining" headers; keep the smallest one we see. */
function noteProviderQuota(h) {
  if (!h || typeof h.forEach !== 'function') return;
  let left = null;
  h.forEach((value, name) => {
    if (/ratelimit.*(units|requests|objects).*remaining|remaining.*(units|requests)/i.test(name) && !/second|minute|hour/i.test(name)) {
      const n = parseInt(value, 10);
      if (Number.isFinite(n)) left = left === null ? n : Math.min(left, n);
    }
  });
  if (left !== null) providerLeft = left;
}

function shortMessage(text) {
  try {
    const j = JSON.parse(text);
    return String(j.message || j.error || j.title || '').slice(0, 200);
  } catch (e) {
    return String(text || '').slice(0, 200);
  }
}

function boardTtl(date) {
  const d = daysFromToday(date);
  if (d < -1) return 3 * 86400;  // past days hardly change
  if (d <= 0) return 15 * 60;    // today: live times and gates
  if (d === 1) return 60 * 60;   // tomorrow
  if (d <= 3) return 4 * 3600;
  return 12 * 3600;              // schedules further out
}

async function billed(env, ctx, path) {
  return queued(env, async () => {
    await reserve(env, UNIT_COST);
    const r = await adb(env, path);
    return r.body;
  });
}

/* Half-day airport board: departures and arrivals, both ends of each flight. */
async function board(url, env, ctx, cors) {
  const airport = String(url.searchParams.get('airport') || '').toUpperCase();
  const date = url.searchParams.get('date') || '';
  const half = url.searchParams.get('half') || '';
  if (!/^[A-Z0-9]{3,4}$/.test(airport) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[01]$/.test(half)) {
    throw err('bad_request', 'Use airport=MIA&date=YYYY-MM-DD&half=0|1', 400);
  }
  const d = daysFromToday(date);
  if (!(d >= -7 && d <= 365)) throw err('bad_request', 'Date is out of range', 400);
  const type = airport.length === 4 ? 'icao' : 'iata';
  const from = date + (half === '0' ? 'T00:00' : 'T12:00');
  const to = date + (half === '0' ? 'T11:59' : 'T23:59');
  const path = `/flights/airports/${type}/${airport}/${from}/${to}` +
    '?withLeg=true&direction=Both&withCancelled=true&withCodeshared=true&withCargo=false&withPrivate=false&withLocation=false';
  const r = await cached(ctx, env, `b1:${airport}:${date}:${half}`, boardTtl(date), true, () => billed(env, ctx, path));
  return sendCached(r, cors);
}

/* Flight status by number, or all flights of one aircraft (tail number) on a date. */
async function flightStatus(url, env, ctx, cors, by) {
  const date = url.searchParams.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw err('bad_request', 'Use date=YYYY-MM-DD', 400);
  const d = daysFromToday(date);
  if (!(d >= -2 && d <= 365)) throw err('bad_request', 'Date is out of range', 400);
  let value;
  if (by === 'number') {
    value = String(url.searchParams.get('number') || '').toUpperCase().replace(/\s/g, '');
    if (!/^[A-Z0-9]{2,3}\d{1,5}[A-Z]?$/.test(value)) throw err('bad_request', 'Use number=UA1234', 400);
  } else {
    value = String(url.searchParams.get('reg') || '').toUpperCase().replace(/\s/g, '');
    if (!/^[A-Z0-9-]{3,10}$/.test(value)) throw err('bad_request', 'Use reg=N12345', 400);
  }
  const path = `/flights/${by}/${encodeURIComponent(value)}/${date}?withAircraftImage=false&withLocation=true`;
  const ttl = d <= 1 ? 10 * 60 : 6 * 3600;
  const r = await cached(ctx, env, `${by === 'number' ? 'f1' : 'a1'}:${value}:${date}`, ttl, true, async () => {
    try {
      return await billed(env, ctx, path);
    } catch (e) {
      if (e.code === 'provider_bad_request') return '[]';   /* not found: no flights */
      throw e;
    }
  });
  return sendCached(r, cors);
}

/* FAA airport status (ground stops, delay programs, closures). Free. */
async function faa(env, ctx, cors) {
  const r = await cached(ctx, env, 'faa1', 300, false, async () => {
    const res = await fetch('https://nasstatus.faa.gov/api/airport-status-information', {
      headers: { Accept: 'application/xml, text/xml', 'User-Agent': UA }
    });
    if (!res.ok) throw err('upstream', 'FAA status is not available right now', 502);
    return await res.text();
  });
  return sendCached(r, cors, 'application/xml; charset=utf-8');
}

/* METAR + TAF from the NOAA Aviation Weather Center. Free. */
async function weather(url, env, ctx, cors) {
  const ids = String(url.searchParams.get('ids') || '').toUpperCase().split(',')
    .map((s) => s.trim()).filter((s) => /^[A-Z0-9]{3,4}$/.test(s)).slice(0, 12).sort();
  if (!ids.length) throw err('bad_request', 'Use ids=KMIA,KDEN', 400);
  const r = await cached(ctx, env, 'wx1:' + ids.join(','), 600, false, async () => {
    const q = encodeURIComponent(ids.join(','));
    const get = async (kind) => {
      try {
        const res = await fetch(`https://aviationweather.gov/api/data/${kind}?ids=${q}&format=json`, { headers: { 'User-Agent': UA } });
        if (!res.ok || res.status === 204) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      } catch (e) {
        return [];
      }
    };
    const [metar, taf] = await Promise.all([get('metar'), get('taf')]);
    return JSON.stringify({ metar, taf });
  });
  return sendCached(r, cors);
}
