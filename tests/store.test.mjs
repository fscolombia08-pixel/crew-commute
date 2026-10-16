// Tests for the access code: remember on this device or only this visit, the 5-day check,
// and "Explore with demo flights" (which must never call the helper).
// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

/* Browser storage stand-ins (each test file runs in its own process). */
function fakeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(),
    has: k => m.has(k)
  };
}
globalThis.localStorage = fakeStorage();
globalThis.sessionStorage = fakeStorage();
/* settings saved by an older version, with the code inside */
localStorage.setItem('crew-commute-v1', JSON.stringify({ lang: 'en', groupCode: 'old-code' }));
globalThis.CREW_CONFIG = { apiBase: 'https://helper.example' };
const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), code: opts && opts.headers && opts.headers['X-Crew-Code'] });
  return { ok: true, status: 200, text: async () => '{"ok":true}', headers: { get: () => null } };
};
const CC = require('./load.cjs');
const ST = CC.store, api = CC.api;
const DAY = 86400000;
const KEY = 'crew-commute-code';
const slot = (area) => JSON.parse(area.getItem(KEY) || 'null');

test('an access code kept by an older version is removed', () => {
  ST.get('lang');
  assert.equal(JSON.parse(localStorage.getItem('crew-commute-v1')).groupCode, undefined);
  assert.equal(ST.code(), '');
});

test('"Remember me" keeps the code on the device; otherwise only for this visit', () => {
  ST.saveCode('Mango-Runway', true);
  assert.equal(ST.code(), 'Mango-Runway');
  assert.ok(slot(localStorage), 'saved on the device');
  assert.equal(slot(sessionStorage), null);
  assert.equal(ST.get('rememberDevice'), true);
  const info = ST.codeInfo();
  assert.equal(info.remembered, true);
  assert.ok(Math.abs(info.askAgainAt - (Date.now() + 5 * DAY)) < 5000, 'asks again in 5 days');

  ST.saveCode('Mango-Runway', false);
  assert.equal(ST.code(), 'Mango-Runway');
  assert.equal(slot(localStorage), null, 'nothing left on the device');
  assert.ok(slot(sessionStorage), 'kept for this visit only');
  assert.equal(ST.get('rememberDevice'), false);
  assert.equal(ST.codeInfo().remembered, false);

  ST.forgetCode();
  assert.equal(ST.code(), '');
  assert.equal(slot(localStorage), null);
  assert.equal(slot(sessionStorage), null);
});

test('the code is asked for again after 5 days, and the old one is deleted', () => {
  ST.saveCode('abc', true);
  const v = slot(localStorage);
  v.at = Date.now() - 5 * DAY + 60000;                 /* 1 minute before the limit */
  localStorage.setItem(KEY, JSON.stringify(v));
  assert.equal(ST.code(), 'abc');
  assert.equal(ST.codeExpired(), false);
  v.at = Date.now() - 5 * DAY - 60000;                 /* 1 minute after */
  localStorage.setItem(KEY, JSON.stringify(v));
  assert.equal(ST.code(), '');
  assert.equal(slot(localStorage), null, 'expired code removed from the device');
  assert.equal(ST.codeExpired(), true, 'the pop-up can say why it asks again');
  ST.saveCode('abc', true);
  assert.equal(ST.codeExpired(), false);
  /* a clock set days ahead when the code was saved doesn't keep it forever */
  const w = slot(localStorage);
  w.at = Date.now() + 3 * DAY;
  localStorage.setItem(KEY, JSON.stringify(w));
  assert.equal(ST.code(), '');
  ST.forgetCode();
});

test('the typed code is checked before it is saved, and searches send the saved one', async () => {
  calls.length = 0;
  await api.ping('typed-code');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].code, 'typed-code');
  assert.equal(ST.code(), '', 'checking does not save it');
  ST.saveCode('typed-code', false);
  await api.board('MIA', '2026-10-20', 0);
  assert.equal(calls[1].code, 'typed-code');
  assert.ok(calls[1].url.startsWith('https://helper.example/api/board'));
  ST.forgetCode();
  api.clearCache();
});

test('"Explore with demo flights" uses made-up data and never calls the helper', async () => {
  calls.length = 0;
  assert.equal(api.isDemo(), false);
  ST.setExploring(true);
  assert.equal(api.isDemo(), true);
  assert.equal(sessionStorage.getItem('crew-commute-demo'), 'true', 'for this visit only');
  assert.equal(localStorage.getItem('crew-commute-demo'), null);
  const board = await api.board('MIA', '2026-10-20', 0);
  assert.ok(board.departures.length > 0, 'demo flights');
  await api.flight('AA 1234', '2026-10-20');
  await api.faa();
  await api.wx(['KMIA']);
  await api.usage();
  await api.ping();
  assert.equal(calls.length, 0, 'no calls to the helper while exploring');
  ST.setExploring(false);
  assert.equal(api.isDemo(), false);
  api.clearCache();
});

test('"Clear my saved settings" also forgets the code and demo mode', () => {
  ST.saveCode('abc', true);
  ST.setExploring(true);
  ST.reset();
  assert.equal(ST.code(), '');
  assert.equal(ST.exploring(), false);
});

test('works when the browser blocks storage (code kept in memory for the visit)', () => {
  const ls = globalThis.localStorage, ss = globalThis.sessionStorage;
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  globalThis.localStorage = broken;
  globalThis.sessionStorage = broken;
  try {
    ST.saveCode('abc', true);
    assert.equal(ST.code(), 'abc');
    ST.setExploring(true);
    assert.equal(ST.exploring(), true);
    ST.setExploring(false);
    ST.forgetCode();
    assert.equal(ST.code(), '');
  } finally {
    globalThis.localStorage = ls;
    globalThis.sessionStorage = ss;
  }
});
