// Tests for the route engine, scoring and helpers.
// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CC = require('./load.cjs');
const { engine: E, time: T, score: S } = CC;

/* A board in the shape AeroDataBox returns with withLeg=true (fields as documented). */
function mv(airport, utc, local, extra) {
  const o = { scheduledTime: { utc, local }, quality: ['Basic'] };
  if (airport) o.airport = { icao: 'K' + airport, iata: airport, name: airport };
  return Object.assign(o, extra || {});
}
function fl(number, callSign, dep, arr, extra) {
  return Object.assign({
    departure: dep, arrival: arr, number, callSign, status: 'Expected', codeshareStatus: 'IsOperator', isCargo: false,
    aircraft: { model: 'Boeing 737-800' }, airline: { name: number.split(' ')[0], iata: number.split(' ')[0] }
  }, extra || {});
}
const D = '2026-10-20';
const MIA_BOARD = {
  departures: [
    fl('AA 1234', 'AAL1234', mv(null, `${D} 11:00Z`, `${D} 07:00-04:00`, { terminal: 'N', gate: 'D20', revisedTime: { utc: `${D} 11:20Z`, local: `${D} 07:20-04:00` } }),
      mv('DFW', `${D} 14:05Z`, `${D} 09:05-05:00`), { aircraft: { model: 'Boeing 737-800', reg: 'N901AN' } }),
    fl('BA 5678', null, mv(null, `${D} 11:00Z`, `${D} 07:00-04:00`), mv('DFW', `${D} 14:05Z`, `${D} 09:05-05:00`), { codeshareStatus: 'IsCodeshared' }),
    fl('QR 2001', null, mv(null, `${D} 11:00Z`, `${D} 07:00-04:00`), mv('DFW', `${D} 14:05Z`, `${D} 09:05-05:00`), { codeshareStatus: 'Unknown' }),
    fl('UA 5432', 'SKW5432', mv(null, `${D} 12:00Z`, `${D} 08:00-04:00`), mv('IAH', `${D} 14:40Z`, `${D} 09:40-05:00`), { aircraft: { model: 'Embraer 175' } }),
    fl('F9 101', 'FFT101', mv(null, `${D} 13:00Z`, `${D} 09:00-04:00`), mv('DEN', `${D} 17:15Z`, `${D} 11:15-06:00`)),
    fl('G4 77', 'AAY77', mv(null, `${D} 15:00Z`, `${D} 11:00-04:00`), mv('DFW', `${D} 18:00Z`, `${D} 13:00-05:00`), { status: 'Canceled' })
  ],
  arrivals: []
};
const DEN_BOARD = {
  departures: [],
  arrivals: [
    fl('AA 2001', 'AAL2001', mv('DFW', `${D} 14:30Z`, `${D} 09:30-05:00`), mv(null, `${D} 16:30Z`, `${D} 10:30-06:00`)),
    fl('AA 2003', 'AAL2003', mv('DFW', `${D} 14:45Z`, `${D} 09:45-05:00`), mv(null, `${D} 16:45Z`, `${D} 10:45-06:00`)),
    fl('UA 2100', 'UAL2100', mv('DFW', `${D} 15:30Z`, `${D} 10:30-05:00`), mv(null, `${D} 17:30Z`, `${D} 11:30-06:00`)),
    fl('UA 2102', 'UAL2102', mv('DFW', `${D} 21:00Z`, `${D} 16:00-05:00`), mv(null, `${D} 23:00Z`, `${D} 17:00-06:00`)),
    fl('UA 1500', 'UAL1500', mv('IAH', `${D} 15:20Z`, `${D} 10:20-05:00`), mv(null, `${D} 17:50Z`, `${D} 11:50-06:00`)),
    fl('F9 101', 'FFT101', mv('MIA', `${D} 13:00Z`, `${D} 09:00-04:00`), mv(null, `${D} 17:15Z`, `${D} 11:15-06:00`, { gate: 'A44' }))
  ]
};

test('time helpers handle zones and DST', () => {
  assert.equal(T.parse('2026-10-20 14:05Z'), Date.UTC(2026, 9, 20, 14, 5));
  assert.equal(T.parse('2026-10-20 10:05-04:00'), Date.UTC(2026, 9, 20, 14, 5));
  assert.ok(Number.isNaN(T.parse('2026-10-20 10:05')));
  assert.equal(T.localToUtc('2026-11-01', '12:00', 'America/New_York'), Date.UTC(2026, 10, 1, 17, 0));
  assert.equal(T.localToUtc('2026-03-08', '12:00', 'America/New_York'), Date.UTC(2026, 2, 8, 16, 0));
  assert.equal(T.localToUtc('2026-10-20', '06:00', 'Pacific/Guam'), Date.UTC(2026, 9, 19, 20, 0));
  assert.equal(T.zoned(Date.UTC(2026, 9, 20, 14, 5), 'America/Phoenix').time, '07:05');
  assert.equal(T.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(T.fmtClock('14:05', '12h'), '2:05\u00a0PM');
  assert.equal(T.fmtClock('13:05', '12h', 'es'), '1:05\u00a0p.\u00a0m.');
  assert.equal(T.fmtDur(125), '2h 05m');
});

test('flight numbers and operators', () => {
  assert.deepEqual(CC.airlines.splitNumber('UA 1234'), { carrier: 'UA', num: '1234' });
  assert.deepEqual(CC.airlines.splitNumber('B6123'), { carrier: 'B6', num: '123' });
  assert.deepEqual(CC.airlines.splitNumber('SKW5432'), { carrier: 'SKW', num: '5432' });
  assert.equal(CC.airlines.operatorFromCallsign('SKW5432').name, 'SkyWest');
  assert.equal(CC.airlines.aircraft('Embraer 175').size, 'regional');
  assert.equal(CC.airlines.aircraft('Boeing 737 MAX 8').seats, 172);
});

test('normalizes a board, merges codeshares, finds the operator', () => {
  const f = E.normalizeBoard(MIA_BOARD, 'MIA');
  const aa = f.find(x => x.flight === 'AA 1234');
  assert.ok(aa, 'AA 1234 present');
  assert.equal(aa.from, 'MIA');
  assert.equal(aa.to, 'DFW');
  assert.equal(aa.depTime, '07:00');
  assert.equal(aa.arrTime, '09:05');
  assert.equal(aa.depGate, 'D20');
  assert.equal(aa.depEst, Date.UTC(2026, 9, 20, 11, 20));
  assert.deepEqual(aa.codeshares.sort(), ['BA 5678', 'QR 2001']);
  assert.equal(aa.opName, null);
  assert.equal(f.filter(x => x.to === 'DFW' && x.depUtc === aa.depUtc).length, 1, 'codeshares are not separate flights');
  const ua = f.find(x => x.flight === 'UA 5432');
  assert.equal(ua.opName, 'SkyWest');
  assert.equal(ua.opIata, 'OO');
  assert.ok(f.find(x => x.flight === 'G4 77').canceled);
});

test('accepts the older AeroDataBox time fields and "movement" boards', () => {
  const raw = { departures: [{ movement: { airport: { iata: 'ATL' }, scheduledTimeLocal: '2026-10-20 07:00-04:00', scheduledTimeUtc: '2026-10-20 11:00Z' }, number: 'DL 100', status: 'Expected', codeshareStatus: 'IsOperator' }] };
  const f = E.normalizeBoard(raw, 'MIA');
  assert.equal(f.length, 1);
  assert.equal(f[0].from, 'MIA');
  assert.equal(f[0].to, 'ATL');
  assert.ok(Number.isNaN(f[0].arrUtc));
});

test('pool merges the same flight seen on two boards', () => {
  const pool = new E.Pool();
  pool.add(E.normalizeBoard(MIA_BOARD, 'MIA'));
  pool.add(E.normalizeBoard(DEN_BOARD, 'DEN'));
  const f9 = pool.all.filter(x => x.flight === 'F9 101');
  assert.equal(f9.length, 1);
  assert.equal(f9[0].arrGate, 'A44');
});

test('builds nonstop and 1-stop itineraries with connection rules', () => {
  const pool = new E.Pool();
  pool.add(E.normalizeBoard(MIA_BOARD, 'MIA'));
  pool.add(E.normalizeBoard(DEN_BOARD, 'DEN'));
  const it = E.build(pool, { origins: ['MIA'], dests: ['DEN'], depDates: [D], minConnSame: 35, minConnOther: 60, maxConn: 360, maxStops: 1 });
  const ids = it.map(i => i.legs.map(l => l.flight).join('+')).sort();
  assert.ok(ids.includes('F9 101'), 'nonstop');
  assert.ok(ids.includes('AA 1234+AA 2003'), 'same airline 40 min ok');
  assert.ok(!ids.includes('AA 1234+AA 2001'), '25 min too short');
  assert.ok(ids.includes('AA 1234+UA 2100'), 'other airline 85 min ok');
  assert.ok(ids.includes('UA 5432+UA 1500'), 'regional + mainline, same airline 40 min');
  assert.ok(!ids.some(x => x.startsWith('G4 77')), 'canceled flights dropped');
  const aaua = it.find(i => i.legs.map(l => l.flight).join('+') === 'AA 1234+UA 2100');
  assert.equal(aaua.conns[0].min, 85);
  assert.equal(aaua.conns[0].same, false);
  assert.equal(aaua.durMin, 6 * 60 + 30);
});

test('prune keeps different routings but drops dominated same-routing options', () => {
  const mk = (dep, arr, via) => ({ id: dep + via, sig: 'AA:MIA>AA:' + via + '>DEN', depUtc: dep, arrUtc: arr, stops: 1 });
  const out = E.prune([mk(100, 500, 'DFW'), mk(200, 500, 'DFW'), mk(100, 600, 'CLT')], {});
  assert.equal(out.length, 2);
  assert.ok(out.find(i => i.id === '200DFW'));
  assert.ok(out.find(i => i.id === '100CLT'));
});

test('filters by time windows, airlines and red-eyes', () => {
  const pool = new E.Pool();
  pool.add(E.normalizeBoard(MIA_BOARD, 'MIA'));
  pool.add(E.normalizeBoard(DEN_BOARD, 'DEN'));
  const it = E.build(pool, { origins: ['MIA'], dests: ['DEN'], depDates: [D], minConnSame: 35, minConnOther: 60, maxConn: 360, maxStops: 1 });
  assert.ok(E.filter(it, { departAfter: '08:30' }).every(i => i.depTime >= '08:30'));
  assert.ok(E.filter(it, { arriveBefore: '11:00' }).every(i => i.arrTime <= '11:00'));
  assert.ok(E.filter(it, { include: ['AA'] }).every(i => i.legs.every(l => l.carrier === 'AA')));
  assert.ok(E.filter(it, { include: ['BA', 'UA'] }).some(i => i.legs[0].flight === 'AA 1234'), 'codeshare numbers count for the airline filter');
  assert.ok(E.filter(it, { maxStops: 0 }).every(i => i.stops === 0));
  const red = { depDate: '2026-10-20', depTime: '23:10', arrDate: '2026-10-21', arrTime: '07:05', depUtc: 0, arrUtc: 5 * 3600000 };
  assert.equal(E.isRedeye(red), true);
});

test('hidden airlines are left out (by seller or operator), and Spirit is gone', () => {
  const pool = new E.Pool();
  pool.add(E.normalizeBoard(MIA_BOARD, 'MIA'));
  pool.add(E.normalizeBoard(DEN_BOARD, 'DEN'));
  const it = E.build(pool, { origins: ['MIA'], dests: ['DEN'], depDates: [D], minConnSame: 35, minConnOther: 60, maxConn: 360, maxStops: 1 });
  const noF9 = E.filter(it, { exclude: ['F9'] });
  assert.ok(noF9.length > 0 && noF9.every(i => i.legs.every(l => l.carrier !== 'F9')));
  assert.ok(it.some(i => i.legs[0].flight === 'UA 5432'), 'fixture has the SkyWest-operated flight');
  assert.ok(!E.filter(it, { exclude: ['OO'] }).some(i => i.legs.some(l => l.flight === 'UA 5432')), 'operator counts too');
  assert.equal(E.US_OPERATORS.has('NK'), false);
  assert.equal(CC.airlines.operatorFromCallsign('NKS123').iata, null, 'Spirit call signs are no longer mapped');
  ['FLL', 'MCO', 'SJU', 'BQN', 'LAS'].forEach(a => [0, 1].forEach(h => {
    const b = CC.demo.board(a, D, h);
    const all = (b.departures || []).concat(b.arrivals || []);
    assert.ok(all.length > 0 && all.every(f => !/^NK /.test(f.number)), 'no Spirit flights in demo data at ' + a);
  }));
});

test('commute plan picks Plan A with a backup after it', () => {
  const its = [1, 2, 3, 4].map(h => ({ id: 'x' + h, depUtc: h * 3600000, arrUtc: h * 3600000 + 7200000, stops: 0, legs: [] }));
  const p = E.commutePlan(its, 1);
  assert.equal(p.planA.id, 'x3');
  assert.equal(its.find(i => i.id === 'x4').role, 'last');
  const p2 = E.commutePlan(its, 0);
  assert.equal(p2.planA.id, 'x4');
});

test('plans the right half-day boards (and handles the date line)', () => {
  const plan = E.planBoards({ origins: ['MIA'], dests: ['DEN'], dates: [D], maxConn: 360, maxStops: 1 });
  const key = r => `${r.airport}:${r.date}:${r.half}`;
  assert.deepEqual(plan.filter(r => r.role === 'origin').map(key), [`MIA:${D}:0`, `MIA:${D}:1`]);
  assert.deepEqual(plan.filter(r => r.role === 'dest').map(key), [`DEN:${D}:0`, `DEN:${D}:1`, `DEN:2026-10-21:0`]);
  const pm = E.planBoards({ origins: ['MIA'], dests: ['DEN'], dates: [D], departAfter: '13:00', maxConn: 360, maxStops: 1 });
  assert.deepEqual(pm.filter(r => r.role === 'origin').map(key), [`MIA:${D}:1`]);
  const gum = E.planBoards({ origins: ['HNL'], dests: ['GUM'], dates: [D], maxConn: 360, maxStops: 1 });
  assert.ok(gum.filter(r => r.role === 'dest').every(r => r.date >= '2026-10-21'), 'Guam is a day ahead');
  const com = E.planBoards({ origins: ['FLL'], dests: ['EWR'], dates: ['2026-10-19', D], arriveByUtc: Date.UTC(2026, 9, 20, 17), maxConn: 360, maxStops: 1, earlyDatesPmOnly: true });
  assert.ok(!com.some(r => r.airport === 'FLL' && r.date === '2026-10-19' && r.half === 0), 'night before: afternoon only');
  assert.ok(!com.some(r => r.airport === 'FLL' && r.date === D && r.half === 1), 'nothing after the deadline');
});

test('warnings point out risks without guessing loads', () => {
  const pool = new E.Pool();
  pool.add(E.normalizeBoard(MIA_BOARD, 'MIA'));
  pool.add(E.normalizeBoard(DEN_BOARD, 'DEN'));
  const it = E.build(pool, { origins: ['MIA'], dests: ['DEN'], depDates: [D], minConnSame: 35, minConnOther: 60, maxConn: 360, maxStops: 1, keepCanceled: true });
  const ctx = { faa: { DFW: [{ type: 'GS', reason: 'thunderstorms' }] }, wx: {}, inbound: {}, minConnSame: 35, minConnOther: 60, fastestMin: 135 };
  const viaDfw = it.find(i => i.legs.map(l => l.flight).join('+') === 'AA 1234+UA 2100');
  const f = S.flags(viaDfw, ctx);
  assert.ok(f.some(x => x.t === 'f_faa_GS' && x.level === 'high'));
  assert.ok(f.some(x => x.t === 'f_change'));
  assert.equal(S.level(f), 'high');
  const nonstop = it.find(i => i.stops === 0);
  assert.equal(S.level(S.flags(nonstop, ctx)), 'ok');
  const tight = it.find(i => i.legs.map(l => l.flight).join('+') === 'AA 1234+AA 2003');
  assert.ok(S.flags(tight, ctx).some(x => x.t === 'f_tight'));
  /* nothing about loads */
  assert.ok(!S.flags(viaDfw, ctx).some(x => /load|full|seat/i.test(x.t)));
  assert.equal(typeof S.rate, 'undefined');
});

test('on-time history lookup (flight, then airline on the route)', () => {
  const saved = CC.data.ontime.ZZZ;
  CC.data.ontime.ZZZ = { months: 'Jun 2026', f: { 'UA5432-DEN': [30, 65, 9, 13.3, 'OO'] }, c: { 'UA-DEN': [60, 80, 5, 1.0] } };
  const leg = { carrier: 'UA', num: '5432', from: 'ZZZ', to: 'DEN', opIata: 'OO' };
  assert.equal(S.onTime(leg).ot, 65);
  assert.equal(S.onTime(leg).src, 'flight');
  assert.equal(S.onTime(Object.assign({}, leg, { num: '1' })).src, 'route');
  CC.data.ontime.ZZZ = saved;
});

test('connections only at U.S. airports, never abroad', () => {
  const board = { departures: [fl('AA 900', 'AAL900', mv(null, `${D} 11:00Z`, `${D} 07:00-04:00`), Object.assign(mv(null, `${D} 14:00Z`, `${D} 10:00-04:00`), { airport: { iata: 'YYZ', icao: 'CYYZ', countryCode: 'CA', timeZone: 'America/Toronto' } }))], arrivals: [] };
  const den = { departures: [], arrivals: [fl('AC 100', 'ACA100', Object.assign(mv(null, `${D} 16:00Z`, `${D} 12:00-04:00`), { airport: { iata: 'YYZ', icao: 'CYYZ', countryCode: 'CA' } }), mv(null, `${D} 20:00Z`, `${D} 14:00-06:00`))] };
  const pool = new E.Pool();
  pool.add(E.normalizeBoard(board, 'MIA'));
  pool.add(E.normalizeBoard(den, 'DEN'));
  const it = E.build(pool, { origins: ['MIA'], dests: ['DEN'], depDates: [D], minConnSame: 35, minConnOther: 60, maxConn: 360, maxStops: 1 });
  assert.equal(it.length, 0);
});

test('arrival filters ignore the date line jump (Honolulu to Guam)', () => {
  const it = { stops: 0, legs: [], depDate: '2026-10-20', depTime: '11:00', arrDate: '2026-10-21', arrTime: '14:30',
    depUtc: Date.UTC(2026, 9, 20, 21), arrUtc: Date.UTC(2026, 9, 21, 4, 30), from: 'HNL', to: 'GUM' };
  assert.equal(E.nextDay(it), 0);
  assert.equal(E.filter([it], { arriveBefore: '18:00' }).length, 1);
  assert.equal(E.filter([it], { arriveAfter: '15:00' }).length, 0);
});

test('prune after filters keeps the earlier same-routing option when the later one is filtered out', () => {
  const mk = (id, dep, arr) => ({ id, sig: 'AA:MIA>AA:DFW>DEN', depUtc: dep, arrUtc: arr, stops: 1, legs: [], depTime: id, arrTime: '12:00', depDate: D, arrDate: D });
  const early = mk('07:30', 1, 10), late = mk('08:30', 2, 10);
  const filtered = E.filter([early, late], { departBefore: '08:00' });
  assert.deepEqual(E.prune(filtered, {}).map(i => i.id), ['07:30']);
});

test('backups count different first flights, not combinations', () => {
  const leg = (id) => ({ id });
  const its = [
    { id: 'a', depUtc: 1, stops: 1, legs: [leg('AA100')] },
    { id: 'b', depUtc: 2, stops: 1, legs: [leg('AA102')] },
    { id: 'c', depUtc: 2, stops: 1, legs: [leg('AA102')] }
  ];
  E.backups(its);
  assert.equal(its[0].backups, 1);
});

test('commute plan falls back to the earliest option when there are not enough backups', () => {
  const its = [1, 2].map(h => ({ id: 'x' + h, depUtc: h, arrUtc: h + 5, stops: 0, legs: [{ id: 'L' + h }] }));
  const p = E.commutePlan(its, 3);
  assert.equal(p.planA.id, 'x1');
  assert.equal(p.short, true);
});

test('untrusted API text is cleaned', () => {
  const bad = { departures: [fl('AA 1<img src=x onerror=alert(1)>', 'AAL1', mv(null, `${D} 11:00Z`, `${D} 07:00-04:00`), Object.assign(mv(null, `${D} 14:00Z`, `${D} 10:00-04:00`), { airport: { iata: '<b>X', icao: 'KJFK' } }))] };
  const f = E.normalizeBoard(bad, 'MIA');
  assert.equal(f.length, 0, 'bad flight number is dropped');
  const ok = { departures: [fl('AA 12', 'AAL12', mv(null, `${D} 11:00Z`, `${D} 07:00-04:00`, { gate: '<script>' }), Object.assign(mv(null, `${D} 14:00Z`, `${D} 10:00-04:00`), { airport: { iata: '<b>', icao: 'KJFK' } }))] };
  const g = E.normalizeBoard(ok, 'MIA');
  assert.equal(g[0].to, 'JFK');
  assert.equal(CC.esc(g[0].depGate), '&lt;script&gt;');
});

test('weather flight categories and FAA parsing', () => {
  const C = CC.conditions;
  assert.equal(C.flightCategory({ visib: 2, clouds: [{ cover: 'OVC', base: 700 }] }), 'IFR');
  assert.equal(C.flightCategory({ visib: '10+', clouds: [{ cover: 'BKN', base: 2500 }] }), 'MVFR');
  assert.equal(C.flightCategory({ visib: '10+', clouds: [{ cover: 'SCT', base: 2500 }] }), 'VFR');
  assert.equal(C.flightCategory({ visib: '1/2', clouds: [] }), 'LIFR');
  const faa = C.parseFaa('<AIRPORT_STATUS_INFORMATION><Delay_type><Airport_Closure_List><Airport><ARPT>BOS</ARPT><Reason>!BOS 10/123 BOS AD AP CLSD</Reason><Start>Oct 20 at 04:00 UTC.</Start><Reopen>Oct 20 at 10:00 UTC.</Reopen></Airport></Airport_Closure_List></Delay_type></AIRPORT_STATUS_INFORMATION>');
  assert.equal(faa.BOS[0].type, 'CLOSED');
  assert.equal(C.faaLevel(faa.BOS), 3);
});

test('demo data looks like the real API and builds results', () => {
  const pool = new E.Pool();
  ['MIA', 'DEN'].forEach(a => [0, 1].forEach(h => pool.add(E.normalizeBoard(CC.demo.board(a, D, h), a))));
  pool.add(E.normalizeBoard(CC.demo.board('DEN', '2026-10-21', 0), 'DEN'));
  const it = E.build(pool, { origins: ['MIA'], dests: ['DEN'], depDates: [D], minConnSame: 35, minConnOther: 60, maxConn: 360, maxStops: 1 });
  assert.ok(it.some(i => i.stops === 0));
  assert.ok(it.some(i => i.stops === 1));
  assert.ok(it.every(i => i.legs.every(l => !l.canceled)));
  assert.ok(it.every(i => i.conns.every(c => c.min >= (c.same ? 35 : 60) && c.min <= 360)));
});
