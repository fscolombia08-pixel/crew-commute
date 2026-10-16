// Tests for the Cloudflare helper (worker/worker.js) with a fake KV and fake upstream APIs.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import worker from '../worker/worker.js';

const require = createRequire(import.meta.url);
const CC = require('./load.cjs');

function kv() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, String(v)); }
  };
}
function ctx() {
  const jobs = [];
  return { waitUntil: (p) => jobs.push(Promise.resolve(p).catch(() => {})), flush: () => Promise.all(jobs) };
}
const ENV = (over) => Object.assign({ ACCESS_CODE: 'Mango Runway', ADB_KEY: 'k123', MONTHLY_UNITS: '400', ADB_RPS: '50', CACHE: kv() }, over || {});

let calls = [];
let plan = [];   // queue of fake upstream answers: { status, body }
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  url = String(url);
  calls.push({ url, headers: (init && init.headers) || {} });
  if (plan.length) { const p = plan.shift(); return new Response(p.body, { status: p.status }); }
  if (url.includes('aerodatabox')) {
    const m = url.match(/airports\/iata\/([A-Z]{3})\/(\d{4}-\d{2}-\d{2})T(\d\d)/);
    if (m) return new Response(JSON.stringify(CC.demo.board(m[1], m[2], m[3] === '00' ? 0 : 1)), { status: 200 });
    return new Response('[]', { status: 200 });
  }
  if (url.includes('aviationweather.gov')) {
    return new Response(JSON.stringify(url.includes('/metar') ? [{ icaoId: 'KMIA', rawOb: 'KMIA 161753Z 09012KT 10SM FEW030 31/22 A3001', visib: '10+', clouds: [] }] : [{ icaoId: 'KMIA', rawTAF: 'TAF KMIA ...' }]), { status: 200 });
  }
  if (url.includes('nasstatus.faa.gov')) return new Response(CC.demo.faa(), { status: 200 });
  return new Response('nope', { status: 404 });
};

async function call(path, env, headers) {
  const c = ctx();
  const res = await worker.fetch(new Request('https://helper.example' + path, { headers: Object.assign({ 'X-Crew-Code': 'mango runway', Origin: 'https://simon.github.io' }, headers || {}) }), env, c);
  await c.flush();
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { body = text; }
  return { res, body, text };
}
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test('rejects missing or wrong group code', async () => {
  const env = ENV();
  let r = await call('/api/ping', env, { 'X-Crew-Code': '' });
  assert.equal(r.res.status, 401);
  r = await call('/api/ping', env, { 'X-Crew-Code': 'banana' });
  assert.equal(r.res.status, 401);
  assert.equal(r.body.error, 'bad_code');
});

test('accepts the code with different capitals and spaces', async () => {
  const r = await call('/api/ping', ENV(), { 'X-Crew-Code': '  MANGO runway ' });
  assert.equal(r.res.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.kv, true);
});

test('board: calls AeroDataBox once, then serves from KV and counts units', async () => {
  calls = [];
  const env = ENV();
  const date = day(2);
  const r1 = await call(`/api/board?airport=MIA&date=${date}&half=0`, env);
  assert.equal(r1.res.status, 200);
  assert.equal(r1.res.headers.get('X-Cache'), 'miss');
  assert.ok(Array.isArray(r1.body.departures) && r1.body.departures.length > 10);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, new RegExp(`/flights/airports/iata/MIA/${date}T00:00/${date}T11:59\\?withLeg=true&direction=Both`));
  assert.equal(calls[0].headers['X-RapidAPI-Key'], 'k123');
  assert.equal(calls[0].headers['X-RapidAPI-Host'], 'aerodatabox.p.rapidapi.com');
  const r2 = await call(`/api/board?airport=MIA&date=${date}&half=0`, env);
  assert.equal(r2.res.headers.get('X-Cache'), 'kv');
  assert.equal(calls.length, 1);
  const u = await call('/api/usage', env);
  assert.equal(u.body.used, 2);
  assert.equal(u.body.limit, 400);
});

test('board: identical requests at the same time share one upstream call', async () => {
  calls = [];
  const env = ENV();
  const date = day(3);
  await Promise.all([1, 2, 3].map(() => call(`/api/board?airport=ATL&date=${date}&half=1`, env)));
  assert.equal(calls.length, 1);
});

test('board: stops at the monthly limit', async () => {
  calls = [];
  const env = ENV({ MONTHLY_UNITS: '2' });
  const r1 = await call(`/api/board?airport=DEN&date=${day(4)}&half=0`, env);
  assert.equal(r1.res.status, 200);
  const r2 = await call(`/api/board?airport=DEN&date=${day(4)}&half=1`, env);
  assert.equal(r2.res.status, 429);
  assert.equal(r2.body.error, 'limit');
  assert.equal(calls.length, 1);
});

test('board: the monthly limit holds even with many requests at once', async () => {
  calls = [];
  const env = ENV({ MONTHLY_UNITS: '8' });
  const rs = await Promise.all(['MIA', 'ATL', 'DEN', 'ORD', 'DFW', 'LAX'].map(a => call(`/api/board?airport=${a}&date=${day(9)}&half=0`, env)));
  const okCount = rs.filter(r => r.res.status === 200).length;
  assert.ok(calls.length <= 4, 'at most 4 calls of 2 units fit in 8 units, got ' + calls.length);
  assert.equal(okCount, calls.length);
  assert.ok(rs.some(r => r.res.status === 429));
});

test('wrong codes are slowed down per visitor', async () => {
  const env = ENV();
  let last;
  for (let i = 0; i < 9; i++) last = await call('/api/ping', env, { 'X-Crew-Code': 'guess' + i, 'CF-Connecting-IP': '203.0.113.9' });
  assert.equal(last.res.status, 429);
  assert.equal(last.body.error, 'slow_down');
  const other = await call('/api/ping', env, { 'CF-Connecting-IP': '203.0.113.10' });
  assert.equal(other.res.status, 200);
});

test('board: retries a short rate limit, reports quota and key problems', async () => {
  calls = [];
  plan = [{ status: 429, body: '{"message":"Too many requests"}' }];
  let r = await call(`/api/board?airport=SEA&date=${day(5)}&half=0`, ENV());
  assert.equal(r.res.status, 200);
  assert.equal(calls.length, 2);

  plan = [{ status: 429, body: '{"message":"You have exceeded the MONTHLY quota for Units on your current plan"}' }];
  r = await call(`/api/board?airport=SEA&date=${day(6)}&half=0`, ENV());
  assert.equal(r.res.status, 429);
  assert.equal(r.body.error, 'provider_limit');

  plan = [{ status: 403, body: '{"message":"You are not subscribed to this API."}' }];
  r = await call(`/api/board?airport=SEA&date=${day(7)}&half=0`, ENV());
  assert.equal(r.res.status, 502);
  assert.equal(r.body.error, 'provider_auth');
  plan = [];
});

test('board: validates input', async () => {
  for (const q of ['airport=MI&date=2026-10-20&half=0', 'airport=MIA&date=20261020&half=0', 'airport=MIA&date=2026-10-20&half=3', 'airport=MIA%2F..&date=2026-10-20&half=0']) {
    const r = await call('/api/board?' + q, ENV());
    assert.equal(r.res.status, 400, q);
  }
  const far = await call(`/api/board?airport=MIA&date=${day(400)}&half=0`, ENV());
  assert.equal(far.res.status, 400);
});

test('flight and aircraft lookups use the right paths', async () => {
  calls = [];
  const env = ENV();
  let r = await call(`/api/flight?number=ua%201234&date=${day(0)}`, env);
  assert.equal(r.res.status, 200);
  assert.match(calls[0].url, new RegExp(`/flights/number/UA1234/${day(0)}\\?withAircraftImage=false`));
  r = await call(`/api/aircraft?reg=n123ua&date=${day(0)}`, env);
  assert.equal(r.res.status, 200);
  assert.match(calls[1].url, new RegExp(`/flights/reg/N123UA/${day(0)}`));
  r = await call(`/api/aircraft?reg=${encodeURIComponent('N1/../x')}&date=${day(0)}`, env);
  assert.equal(r.res.status, 400);
});

test('weather and FAA are proxied and cached', async () => {
  calls = [];
  const env = ENV();
  let r = await call('/api/wx?ids=KMIA,kden', env);
  assert.equal(r.res.status, 200);
  assert.equal(r.body.metar[0].icaoId, 'KMIA');
  assert.equal(calls.filter(c => c.url.includes('aviationweather')).length, 2);
  r = await call('/api/wx?ids=KDEN,KMIA', env);
  assert.equal(r.res.headers.get('X-Cache'), 'mem');
  r = await call('/api/faa', env);
  assert.equal(r.res.status, 200);
  assert.match(r.text, /AIRPORT_STATUS_INFORMATION/);
  const parsed = CC.conditions.parseFaa(r.text);
  assert.equal(parsed.EWR[0].type, 'GDP');
  assert.equal(parsed.ORD[0].type, 'GS');
  assert.equal(parsed.SFO[0].type, 'DLY');
});

test('CORS: allowed origin is echoed, preflight works', async () => {
  const env = ENV({ ALLOWED_ORIGINS: 'https://simon.github.io, https://other.example' });
  let r = await call('/api/ping', env);
  assert.equal(r.res.headers.get('Access-Control-Allow-Origin'), 'https://simon.github.io');
  r = await call('/api/ping', env, { Origin: 'https://evil.example' });
  assert.equal(r.res.headers.get('Access-Control-Allow-Origin'), 'https://simon.github.io');
  const c = ctx();
  const pre = await worker.fetch(new Request('https://helper.example/api/board', { method: 'OPTIONS', headers: { Origin: 'https://simon.github.io' } }), env, c);
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /X-Crew-Code/);
});

test('works without KV (no cache, no budget)', async () => {
  calls = [];
  const env = ENV({ CACHE: undefined });
  const r = await call(`/api/board?airport=MIA&date=${day(8)}&half=1`, env);
  assert.equal(r.res.status, 200);
  const u = await call('/api/usage', env);
  assert.equal(u.body.used, null);
});

test.after(() => { globalThis.fetch = realFetch; });
