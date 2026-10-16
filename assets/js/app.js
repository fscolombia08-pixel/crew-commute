/* Crew Commute: the app (search form, results, settings). */
(function (root) {
  'use strict';
  const CC = root.CC;
  const T = CC.time, AP = CC.airports, AL = CC.airlines, E = CC.engine, S = CC.score, ST = CC.store;
  const MIN = 60000;
  const t = (k, p) => CC.i18n.t(k, p);
  const esc = CC.esc;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  const MY_AIRLINE_CHOICES = ['AA', 'UA', 'DL', 'WN', 'B6', 'AS', 'HA', 'F9', 'G4', 'SY', 'MX', 'XP'];
  /* Airlines that are never shown (config.js hideAirlines; Spirit/NK stopped flying in May 2026). */
  function hiddenAirlines() {
    const list = (root.CREW_CONFIG && root.CREW_CONFIG.hideAirlines) || [];
    return list.map(c => String(c).toUpperCase());
  }
  function cleanMyAirlines() {
    const mine = ST.get('myAirlines') || [];
    const keep = mine.filter(c => hiddenAirlines().indexOf(c) < 0);
    if (keep.length !== mine.length) ST.set('myAirlines', keep);
  }

  const st = {
    mode: 'find',
    from: [], to: [],
    run: null,
    view: [],
    shown: 25,
    include: [],
    sort: null,
    faa: {}, faaAt: 0,
    wx: {}, wxAt: {},
    inbound: {}, inboundBusy: {},
    otLoading: {},
    condAirports: [],
    seq: 0,
    busy: false,
    status: null
  };

  /* ================= helpers ================= */
  const fmt = (hhmm) => esc(T.fmtClock(hhmm, ST.get('timeFmt'), CC.i18n.lang()));
  /* Same as fmt, but the AM/PM part is smaller (keeps big times readable on phones). */
  const clock = (hhmm) => {
    const s = T.fmtClock(hhmm, ST.get('timeFmt'), CC.i18n.lang());
    const m = s.match(/^(\d{1,2}:\d{2})[\s\u00a0]+(.+)$/);
    return m ? `${esc(m[1])}<small class="ampm">${esc(m[2])}</small>` : esc(s);
  };
  const lang = () => CC.i18n.lang();
  function nearTerm(date) {
    const today = T.deviceToday();
    const d = T.daysBetween(today, date);
    return d >= -1 && d <= 1;
  }
  function plural(n, one, many) { return n === 1 ? t(one, { n }) : t(many, { n }); }
  let renderTimer = null;
  let drawQuick = () => {};
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 60);
  }

  /* ================= init ================= */
  function init() {
    setupTheme();
    cleanMyAirlines();
    fillSelects();
    restoreDefaults();
    setupPicker('from');
    setupPicker('to');
    setupForm();
    setupSettings();
    setupCodeDialog();
    setupResultsEvents();
    setupLogos();
    applyLang();
    renderTrips();
    updateDemoBanner();
    const fromHash = readHash();
    if (!fromHash) {
      $('#dateInput').value = T.deviceToday();
    }
    const shared = fromHash && st.from.length && st.to.length;
    if (needsCode()) {
      if (shared) afterCode = () => search();
      openCodeDialog();
    } else if (shared) search();
    refreshUsage();
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    const meta = CC.data.meta;
    if (meta && meta.built) {
      $('#dataVersion').textContent = t('history') + ': ' + [meta.t100, meta.ontime].filter(Boolean).join(' · ');
    }
  }

  function option(value, label, selected) {
    return `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
  }
  function fillSelect(sel, values, label, stored) {
    const el = $(sel);
    const cur = el.value ? +el.value : stored;
    const list = values.indexOf(cur) >= 0 ? values : values.concat(cur).sort((a, b) => a - b);
    el.innerHTML = list.map(n => option(n, label(n), n === cur)).join('');
  }
  function fillSelects() {
    fillSelect('#bufferInput', [30, 45, 60, 75, 90, 120, 180], n => t('buffer_opt', { n }), ST.get('commuteBuffer'));
    fillSelect('#minSame', [20, 25, 30, 35, 40, 45, 60, 75, 90], n => n + ' min', ST.get('minConnSame'));
    fillSelect('#minOther', [30, 45, 60, 75, 90, 120, 150, 180], n => n + ' min', ST.get('minConnOther'));
    fillSelect('#maxConn', [120, 180, 240, 300, 360, 480, 600, 720, 960], n => T.fmtDur(n), ST.get('maxConn'));
  }
  function restoreDefaults() {
    const stops = String(ST.get('maxStops'));
    $$('input[name=stops]').forEach(r => { r.checked = r.value === stops; });
    $('#noRedeye').checked = !!ST.get('noRedeye');
    $('#onlyMine').checked = !!ST.get('onlyMine');
    $('#nightBefore').checked = ST.get('nightBefore') !== false;
  }

  function applyLang() {
    CC.i18n.apply();
    drawQuick();
    $('#langBtn').textContent = lang() === 'es' ? 'EN' : 'ES';
    $('#toLabel').textContent = st.mode === 'commute' ? t('to_base') : t('to');
    $('#dateLabel').textContent = st.mode === 'commute' ? t('report_date') : t('date');
    fillSelects();
    drawChips('from');   /* placeholders, "Nearby" and the remove buttons in the new language */
    drawChips('to');
    drawCodeTexts();
    drawCodeStatus();
    renderTrips();
    render();
    refreshUsage(true);
  }

  function updateDemoBanner() {
    const demo = CC.api.isDemo();
    $('#demoBanner').hidden = !demo;
    /* visitors exploring the demo can switch to real data with a code */
    $('#demoExit').hidden = !(demo && CC.api.base() && !ST.get('forceDemo'));
  }

  /* ================= airport pickers ================= */
  function setupPicker(side) {
    const field = $(`.ap-field[data-side="${side}"]`);
    const input = $('.ap-input', field), list = $('.ap-list', field);
    let items = [], active = -1;

    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; }
    function show() {
      items = AP.search(input.value, 8).filter(a => st[side].indexOf(a.iata) < 0);
      if (!items.length) { close(); return; }
      list.innerHTML = items.map((a, i) =>
        `<li role="option" id="${side}-opt-${i}" class="ap-opt${i === active ? ' active' : ''}" data-code="${esc(a.iata)}">
           <span class="ap-code">${esc(a.iata)}</span><span class="ap-name">${esc(a.city)}<small>${esc(a.name)}${a.region ? ', ' + esc(a.region) : ''}</small></span></li>`).join('');
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-activedescendant', active >= 0 ? `${side}-opt-${active}` : '');
    }
    input.addEventListener('input', () => { active = 0; show(); });
    input.addEventListener('focus', () => { if (input.value) show(); });
    input.addEventListener('blur', () => setTimeout(close, 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); show(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); show(); }
      else if (e.key === 'Enter') {
        if (!list.hidden && items[active]) { e.preventDefault(); pick(items[active].iata); }
        else if (input.value.trim().length === 3 && AP.get(input.value.trim())) { e.preventDefault(); pick(input.value.trim().toUpperCase()); }
      } else if (e.key === 'Escape') { close(); }
      else if (e.key === 'Backspace' && !input.value && st[side].length) { removeCode(side, st[side][st[side].length - 1]); }
    });
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('.ap-opt');
      if (li) { e.preventDefault(); pick(li.dataset.code); }
    });
    field.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { removeCode(side, rm.dataset.rm); return; }
      const add = e.target.closest('[data-add]');
      if (add) { addCode(side, add.dataset.add); return; }
      if (e.target.closest('.ap-box')) input.focus();
    });
    function pick(code) {
      addCode(side, code);
      input.value = '';
      close();
    }
  }
  function addCode(side, code) {
    code = code.toUpperCase();
    if (st[side].indexOf(code) >= 0 || st[side].length >= 3 || !AP.get(code)) return;
    st[side].push(code);
    drawChips(side);
  }
  function removeCode(side, code) {
    st[side] = st[side].filter(c => c !== code);
    drawChips(side);
  }
  function drawChips(side) {
    const field = $(`.ap-field[data-side="${side}"]`);
    $('.ap-chips', field).innerHTML = st[side].map(c => {
      const a = AP.get(c);
      return `<span class="ap-chip" title="${esc(a ? a.name : c)}"><b>${esc(c)}</b><span class="ap-chip-city">${esc(a ? a.city : '')}</span>
        <button type="button" class="ap-chip-x" data-rm="${esc(c)}" aria-label="${esc(t('remove') + ' ' + c)}">×</button></span>`;
    }).join('');
    const input = $('.ap-input', field);
    input.placeholder = st[side].length ? t('add_airport_ph') : t('airport_ph');
    input.hidden = st[side].length >= 3;
    const near = [];
    st[side].forEach(c => AP.nearby(c, 60).forEach(a => {
      if (st[side].indexOf(a.iata) < 0 && near.indexOf(a.iata) < 0 && near.length < 3) near.push(a.iata);
    }));
    $('.ap-nearby', field).innerHTML = near.length && st[side].length < 3
      ? `<span class="muted small">${t('nearby')}</span> ` + near.map(c => `<button type="button" class="mini-btn" data-add="${esc(c)}">+ ${esc(c)}</button>`).join(' ')
      : '';
  }

  /* ================= form ================= */
  function setMode(mode) {
    st.mode = mode;
    document.body.dataset.mode = mode;
    $$('.seg-btn').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    $('#toLabel').textContent = mode === 'commute' ? t('to_base') : t('to');
    $('#dateLabel').textContent = mode === 'commute' ? t('report_date') : t('date');
  }

  function setupForm() {
    setMode('find');
    $$('.seg-btn').forEach(b => b.addEventListener('click', () => {
      setMode(b.dataset.mode);
      st.sort = null;
      if (st.run) search();
    }));
    $('#swapBtn').addEventListener('click', () => {
      const f = st.from; st.from = st.to; st.to = f;
      drawChips('from'); drawChips('to');
    });
    $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); search(true); });
    $('#langBtn').addEventListener('click', () => { ST.set('lang', lang() === 'es' ? 'en' : 'es'); applyLang(); });

    /* quick date buttons */
    const dateField = $('#dateInput').parentElement;
    const quick = document.createElement('div');
    quick.className = 'quick-dates';
    dateField.appendChild(quick);
    drawQuick = () => {
      const today = T.deviceToday();
      const labels = lang() === 'es' ? ['Hoy', 'Mañana'] : ['Today', 'Tomorrow'];
      quick.innerHTML = [0, 1].map(i => `<button type="button" class="mini-btn" data-day="${i}">${labels[i]}</button>`).join('');
      quick.onclick = (e) => {
        const b = e.target.closest('[data-day]');
        if (b) { $('#dateInput').value = T.addDays(today, +b.dataset.day); }
      };
    };
    drawQuick();

    /* remember defaults */
    const remember = () => {
      ST.set('minConnSame', +$('#minSame').value);
      ST.set('minConnOther', +$('#minOther').value);
      ST.set('maxConn', +$('#maxConn').value);
      ST.set('maxStops', +(($('input[name=stops]:checked') || {}).value || 1));
      ST.set('noRedeye', $('#noRedeye').checked);
      ST.set('onlyMine', $('#onlyMine').checked);
      ST.set('commuteBuffer', +$('#bufferInput').value);
      ST.set('nightBefore', $('#nightBefore').checked);
      updateFilterCount();
    };
    ['#minSame', '#minOther', '#maxConn', '#bufferInput'].forEach(s => $(s).addEventListener('change', () => { remember(); if (st.run) search(); }));
    $$('input[name=stops]').forEach(r => r.addEventListener('change', () => { remember(); if (st.run) search(); }));
    const applyFilters = () => {
      if (!st.run) return;
      const f = readForm();
      Object.assign(st.run.q, { noRedeye: f.noRedeye, onlyMine: f.onlyMine, arriveAfter: f.arriveAfter, arriveBefore: f.arriveBefore });
      render();
    };
    ['#noRedeye', '#onlyMine'].forEach(s => $(s).addEventListener('change', () => { remember(); applyFilters(); }));
    $('#nightBefore').addEventListener('change', () => { remember(); if (st.run) search(); });
    ['#depAfter', '#depBefore'].forEach(s => $(s).addEventListener('change', () => { updateFilterCount(); if (st.run) search(); }));
    ['#arrAfter', '#arrBefore'].forEach(s => $(s).addEventListener('change', () => { updateFilterCount(); applyFilters(); }));
    updateFilterCount();
  }

  function updateFilterCount() {
    let n = 0;
    ['#depAfter', '#depBefore', '#arrAfter', '#arrBefore'].forEach(s => { if ($(s).value) n++; });
    if ($('#noRedeye').checked) n++;
    if ($('#onlyMine').checked) n++;
    if (String(($('input[name=stops]:checked') || {}).value) !== '1') n++;
    $('#filterCount').textContent = n ? ' · ' + n : '';
  }

  function readForm() {
    return {
      mode: st.mode,
      from: st.from.slice(), to: st.to.slice(),
      date: $('#dateInput').value,
      maxStops: +(($('input[name=stops]:checked') || {}).value || 1),
      minConnSame: +$('#minSame').value,
      minConnOther: +$('#minOther').value,
      maxConn: +$('#maxConn').value,
      departAfter: $('#depAfter').value,
      departBefore: $('#depBefore').value,
      arriveAfter: st.mode === 'find' ? $('#arrAfter').value : '',
      arriveBefore: st.mode === 'find' ? $('#arrBefore').value : '',
      noRedeye: $('#noRedeye').checked,
      onlyMine: $('#onlyMine').checked,
      report: $('#reportInput').value,
      buffer: +$('#bufferInput').value,
      nightBefore: $('#nightBefore').checked
    };
  }

  /* URL hash keeps the search, so a link can be shared or bookmarked. */
  function writeHash(q) {
    const p = new URLSearchParams();
    p.set('m', q.mode); p.set('o', q.from.join(',')); p.set('d', q.to.join(',')); p.set('dt', q.date);
    if (q.mode === 'commute') { p.set('rt', q.report); p.set('b', String(q.buffer)); }
    try { history.replaceState(null, '', '#' + p.toString()); } catch (e) { /* ignore */ }
  }
  function readHash() {
    const h = location.hash.replace(/^#/, '');
    if (!h) return false;
    const p = new URLSearchParams(h);
    const codes = (s) => (s || '').split(',').map(x => x.trim().toUpperCase()).filter(c => AP.get(c)).slice(0, 3);
    st.from = codes(p.get('o')); st.to = codes(p.get('d'));
    drawChips('from'); drawChips('to');
    setMode(p.get('m') === 'commute' ? 'commute' : 'find');
    const dt = p.get('dt');
    $('#dateInput').value = /^\d{4}-\d{2}-\d{2}$/.test(dt || '') ? dt : T.deviceToday();
    if (p.get('rt')) $('#reportInput').value = p.get('rt');
    const b = parseInt(p.get('b'), 10);
    if (b >= 0 && b <= 600) { if (!$(`#bufferInput option[value="${b}"]`)) $('#bufferInput').insertAdjacentHTML('beforeend', option(b, t('buffer_opt', { n: b }), false)); $('#bufferInput').value = String(b); }
    return true;
  }

  /* ================= search ================= */
  function setStatus(kind, html) {
    st.status = kind ? { kind, html } : null;
    const el = $('#status');
    el.innerHTML = kind ? `<div class="status-box status-${kind}">${html}</div>` : '';
  }
  function progressHtml(label, done, total) {
    const pct = total ? Math.round(done / total * 100) : 0;
    return `<div class="progress-label">${esc(label)}</div><div class="progress"><span style="width:${pct}%"></span></div>`;
  }
  function errorText(e) {
    if (!e) return '';
    if (e.code === 'bad_code') return t('err_bad_code');
    if (e.code === 'limit' || e.code === 'provider_limit') return t('err_limit');
    if (e.code === 'network') return t('err_network');
    if (e.code === 'slow_down') return t('err_slow_down');
    return t('err_server', { m: e.message || e.code });
  }

  async function loadBoards(reqs, pool, errors, seq, label) {
    let i = 0, done = 0, fatal = null;
    const total = reqs.length;
    const work = async () => {
      while (i < reqs.length && !fatal) {
        const r = reqs[i++];
        try {
          const raw = await CC.api.board(r.airport, r.date, r.half);
          pool.add(E.normalizeBoard(raw, r.airport));
        } catch (e) {
          errors.push({ r, e });
          if (e.code === 'bad_code' || e.code === 'limit' || e.code === 'provider_limit' || e.code === 'provider_auth') fatal = e;
        }
        done++;
        if (seq === st.seq) setStatus('loading', progressHtml(label === 'hubs' ? t('loading_hubs') : t('loading_boards', { i: done, n: total }), done, total));
      }
    };
    await Promise.all([work(), work()]);
    return fatal;
  }

  async function search(userStarted, opts) {
    const q = readForm();
    if (opts && opts.twoStop && q.maxStops < 2) q.maxStops = 2;
    if (!q.from.length || !q.to.length) { setStatus('error', esc(t('err_need_airports'))); return; }
    if (q.from.some(c => q.to.indexOf(c) >= 0)) { setStatus('error', esc(t('err_same_airport'))); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date)) { $('#dateInput').value = q.date = T.deviceToday(); }
    if (q.mode === 'commute' && !q.report) { setStatus('error', esc(t('err_need_time'))); return; }
    if (needsCode()) { afterCode = () => search(userStarted, opts); openCodeDialog(); return; }

    const seq = ++st.seq;
    st.busy = true;
    $('#searchBtn').classList.add('busy');
    $('#searchBtn').disabled = true;
    setStatus('loading', progressHtml(t('searching'), 0, 1));

    let dates, arriveByUtc = null, reportUtc = null;
    if (q.mode === 'commute') {
      reportUtc = T.localToUtc(q.date, q.report, AP.tz(q.to[0]));
      arriveByUtc = reportUtc - q.buffer * MIN;
      /* the last day you could leave, on the origin's calendar (Guam and Saipan are a day ahead) */
      const last = q.from.map(o => T.zoned(arriveByUtc, AP.tz(o)).date).sort().pop();
      dates = q.nightBefore ? [T.addDays(last, -1), last] : [last];
    } else {
      dates = [q.date];
    }
    const plan = E.planBoards({
      origins: q.from, dests: q.to, dates, departAfter: q.departAfter, departBefore: q.departBefore,
      arriveByUtc, maxConn: q.maxConn, maxStops: q.maxStops, earlyDatesPmOnly: q.mode === 'commute'
    });
    const pool = new E.Pool();
    const errors = [];
    let fatal = await loadBoards(plan, pool, errors, seq, 'boards');
    if (seq !== st.seq) return;

    const base = { origins: q.from, dests: q.to, depDates: dates, minConnSame: q.minConnSame, minConnOther: q.minConnOther, maxConn: q.maxConn };
    let itins = fatal ? [] : E.build(pool, Object.assign({}, base, { maxStops: Math.min(1, q.maxStops) }));
    let hubs = [], twoStopLoaded = false;
    const autoTwo = q.maxStops >= 1 && !itins.some(i => i.stops <= 1) && !fatal;
    if (!fatal && (q.maxStops >= 2 || autoTwo)) {
      const hp = E.planHubs(pool, { origins: q.from, dests: q.to, dates, maxConn: q.maxConn }, 3);
      hubs = hp.hubs;
      if (hp.boards.length) {
        setStatus('loading', progressHtml(t('loading_hubs'), 0, hp.boards.length));
        fatal = await loadBoards(hp.boards, pool, errors, seq, 'hubs');
        if (seq !== st.seq) return;
      }
      itins = E.build(pool, Object.assign({}, base, { maxStops: 2, hubs }));
      twoStopLoaded = true;
    }

    st.run = { q, pool, itins, errors, plan, hubs, dates, arriveByUtc, reportUtc, twoStopLoaded, fatal, total: plan.length, demo: CC.api.isDemo() };
    st.shown = 25;
    st.include = [];
    st.busy = false;
    $('#searchBtn').classList.remove('busy');
    $('#searchBtn').disabled = false;
    writeHash(q);
    if (fatal) {
      setStatus('error', esc(errorText(fatal)));
      if (fatal.code === 'bad_code') { ST.forgetCode(); openCodeDialog('code_wrong'); }
    } else if (errors.length) {
      setStatus('warn', esc(t('err_partial', { n: errors.length, total: plan.length })) + '<br><small>' + esc(errorText(errors[0].e)) + '</small>');
    } else {
      setStatus(null);
    }
    render();
    if (!fatal && userStarted) {
      const target = $('#plan').innerHTML ? $('#plan') : $('#toolbar');
      const top = target.getBoundingClientRect().top;
      if (top > window.innerHeight * 0.6) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (!fatal) {
      loadConditions();
      refreshUsage();
    }
  }

  async function loadConditions() {
    const r = st.run;
    if (!r) return;
    const q = r.q;
    const counts = new Map();
    r.itins.slice(0, 80).forEach(it => it.conns.forEach(c => counts.set(c.at, (counts.get(c.at) || 0) + 1)));
    const conn = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4).map(e => e[0]);
    const airports = CC.uniq(q.from.concat(q.to, conn));
    st.condAirports = airports;
    const jobs = [];
    if (Date.now() - st.faaAt > 5 * MIN) {
      jobs.push(CC.api.faa().then(x => { st.faa = CC.conditions.parseFaa(x); st.faaAt = Date.now(); }).catch(() => {}));
    }
    const icaos = airports.map(a => AP.icao(a)).filter(i => !st.wxAt[i] || Date.now() - st.wxAt[i] > 10 * MIN);
    if (icaos.length) {
      jobs.push(CC.api.wx(icaos).then(w => {
        Object.assign(st.wx, CC.conditions.parseWx(w));
        icaos.forEach(i => { st.wxAt[i] = Date.now(); });
      }).catch(() => {}));
    }
    await Promise.all(jobs);
    scheduleRender();
  }

  /* On-time history loads on demand: one small file per first letter of the airport code. */
  function ensureOntime(codes) {
    const meta = CC.data.meta;
    if (!meta || !meta.ontimeAirports) return;
    const avail = new Set(meta.ontimeAirports);
    codes.forEach(code => {
      if (!avail.has(code) || CC.data.ontime[code]) return;
      const letter = code[0];
      if (!/^[A-Z0-9]$/.test(letter) || st.otLoading[letter]) return;
      st.otLoading[letter] = true;
      const s = document.createElement('script');
      s.src = 'data/ontime/' + letter + '.js?v=' + encodeURIComponent(meta.built || '');
      s.onload = scheduleRender;
      document.head.appendChild(s);
    });
  }

  async function refreshUsage(quiet) {
    const el = $('#usageLine');
    if (needsCode()) { el.textContent = ''; return; }   /* never call the helper without a code */
    try {
      const u = await CC.api.usage();
      el.textContent = (u && u.limit && !u.demo) ? t('data_used', { u: u.used, l: u.limit }) : '';
    } catch (e) {
      if (!quiet) el.textContent = '';
      /* the saved code stopped working (for example the owner changed it): ask right away */
      if (e && e.code === 'bad_code') { ST.forgetCode(); openCodeDialog('code_wrong'); }
    }
  }

  /* ================= view ================= */
  function effectiveStops(r) {
    if (r.q.maxStops === 0) return 0;
    return r.twoStopLoaded ? 2 : r.q.maxStops;
  }

  function computeView() {
    const r = st.run;
    if (!r) return [];
    const q = r.q;
    const mine = ST.get('myAirlines') || [];
    const include = st.include.length ? st.include : (q.onlyMine && mine.length ? mine : []);
    const now = Date.now();
    let list = E.filter(r.itins.filter(it => {
      const l = it.legs[0];
      return (isFinite(l.depEst) ? l.depEst : l.depUtc) > now - 5 * MIN;   /* already gone */
    }), {
      departAfter: q.departAfter, departBefore: q.departBefore,
      arriveAfter: q.arriveAfter, arriveBefore: q.arriveBefore,
      arriveByUtc: r.arriveByUtc, maxStops: effectiveStops(r), include, noRedeye: q.noRedeye,
      exclude: hiddenAirlines()
    });
    list = E.prune(list, {});
    if (q.mode === 'commute') {
      const p = E.commutePlan(list, +ST.get('backupsWanted'));
      r.planA = p.planA;
      r.planShort = p.short;
      list = p.list;
    } else {
      E.backups(list);
      r.planA = null;
    }
    const near = nearTerm(r.dates[r.dates.length - 1]);
    const ctx = {
      faa: near ? st.faa : {}, wx: near ? st.wx : {}, inbound: st.inbound,
      minConnSame: q.minConnSame, minConnOther: q.minConnOther,
      fastestMin: list.reduce((m, it) => Math.min(m, it.durMin), Infinity)
    };
    r.flagCtx = ctx;
    list.forEach(it => { it.flags = S.flags(it, ctx); });
    const sortKey = currentSort();
    if (sortKey === 'plan') return planOrder(list, r.planA);
    return E.sort(list, sortKey);
  }

  function currentSort() {
    const r = st.run;
    if (st.sort) return st.sort;
    const saved = ST.get('sort');
    return r && r.q.mode === 'commute' ? 'plan' : (saved && saved !== 'best' ? saved : 'depart');
  }

  /* Commute order: Plan A, then its backups (in time order), then earlier options (latest first). */
  function planOrder(list, planA) {
    if (!planA) return E.sort(list, 'late');
    const after = list.filter(i => i !== planA && i.depUtc > planA.depUtc).sort((a, b) => a.depUtc - b.depUtc);
    const before = list.filter(i => i !== planA && i.depUtc <= planA.depUtc).sort((a, b) => b.depUtc - a.depUtc || a.arrUtc - b.arrUtc);
    after.forEach(i => { i.section = 'plan'; });
    before.forEach(i => { i.section = 'earlier'; });
    planA.section = 'plan';
    return [planA].concat(after, before);
  }

  function render() {
    const r = st.run;
    if (!r) { $('#plan').innerHTML = ''; $('#conditions').innerHTML = ''; $('#toolbar').innerHTML = ''; $('#results').innerHTML = ''; return; }
    const open = new Set($$('#results details[open], #conditions details[open]').map(d => d.dataset.key));
    st.view = computeView();
    ensureOntime(CC.uniq(st.view.slice(0, st.shown).flatMap(it => it.legs.map(l => l.from))));
    renderPlan();
    renderConditions();
    renderToolbar();
    renderResults();
    $$('#results details[data-key], #conditions details[data-key]').forEach(d => { if (open.has(d.dataset.key)) d.open = true; });
  }

  function renderPlan() {
    const r = st.run, el = $('#plan');
    if (r.q.mode !== 'commute' || r.fatal) { el.innerHTML = ''; return; }
    const tz = AP.tz(r.q.to[0]);
    const dl = T.zoned(r.arriveByUtc, tz);
    let deadline = t('plan_deadline', { t: fmt(dl.time), d: T.fmtDate(dl.date, lang()), r: fmt(r.q.report), b: r.q.buffer });
    const tzO = AP.tz(r.q.from[0]);
    if (T.offsetAt(r.arriveByUtc, tzO) !== T.offsetAt(r.arriveByUtc, tz)) {
      const dlo = T.zoned(r.arriveByUtc, tzO);
      deadline += ' ' + t('plan_deadline_origin', { t: fmt(dlo.time), a: r.q.from[0] });
    }
    const p = r.planA;
    let body;
    if (!p) {
      body = `<p class="plan-none">${esc(t('plan_none'))}</p>`;
    } else {
      const first = p.legs[0], last = p.legs[p.legs.length - 1];
      const text = t('plan_text', {
        f: p.legs.map(l => l.flight).join(' + '), from: AP.label(p.from), dep: fmt(first.depTime) + (first.depDate !== r.q.date ? ' (' + T.fmtDate(first.depDate, lang()) + ')' : ''),
        to: AP.label(p.to), arr: fmt(last.arrTime) + (last.arrDate !== r.q.date ? ' (' + T.fmtDate(last.arrDate, lang()) + ')' : '')
      });
      const b = p.backups;
      let backups = b ? plural(b, 'plan_backups_1', 'plan_backups_n') : t('plan_no_backup');
      if (r.planShort) backups += ' ' + t('plan_short', { n: +ST.get('backupsWanted') });
      body = `<p class="plan-main"><span class="role role-planA">${esc(t('role_planA'))}</span> ${esc(text)}</p>
              <p class="${b ? 'muted' : 'warn-text'}">${esc(backups)}</p>`;
    }
    const tips = ['tip_1', 'tip_2', 'tip_3', 'tip_4'].map(k => `<li>${esc(t(k))}</li>`).join('');
    el.innerHTML = `<div class="card plan-card"><h2>${esc(t('plan_title'))}</h2>${body}<p class="muted small">${esc(deadline)}</p>
      <details class="tips" data-key="tips"><summary>${esc(t('tips_title'))}</summary><ul>${tips}</ul></details></div>`;
  }

  function faaText(ev) {
    let s = t('faa_' + ev.type);
    if (ev.type === 'GS' && ev.end) s += ' ' + t('faa_until', { x: ev.end });
    if (ev.type === 'GDP' && ev.avg) s += ' · ' + t('faa_avg', { x: ev.avg });
    if (ev.type === 'DLY' && (ev.min || ev.max)) s += ' ' + [ev.min, ev.max].filter(Boolean).join('–') + (ev.dir ? ' (' + ev.dir.toLowerCase() + ')' : '');
    if (ev.reason) s += ' · ' + ev.reason;
    return s;
  }

  function renderConditions() {
    const r = st.run, el = $('#conditions');
    if (!st.condAirports.length || r.fatal) { el.innerHTML = ''; return; }
    let worst = 0;
    const chips = st.condAirports.map(code => {
      const w = st.wx[AP.icao(code)];
      const lvl = CC.conditions.faaLevel(st.faa[code] || []);
      worst = Math.max(worst, lvl, w && (w.cat === 'IFR' || w.cat === 'LIFR') ? 1 : 0);
      return `<span class="cchip faa-${lvl}"><b>${esc(code)}</b>${w && w.cat ? `<span class="cat cat-${esc(w.cat)}">${esc(w.cat)}</span>` : ''}${lvl ? '<span class="cflag">!</span>' : ''}</span>`;
    }).join('');
    const items = st.condAirports.map(code => {
      const w = st.wx[AP.icao(code)];
      const faa = st.faa[code] || [];
      const lvl = CC.conditions.faaLevel(faa);
      const cat = w && w.cat ? w.cat : '';
      const faaLine = faa.length ? faa.map(faaText).join(' / ') : t('no_delays');
      return `<details class="cond-item faa-${lvl}" data-key="cond:${esc(code)}">
        <summary><b>${esc(code)}</b>${cat ? `<span class="cat cat-${esc(cat)}">${esc(cat)}</span>` : ''}<span class="cond-faa">${esc(faaLine)}</span></summary>
        <div class="cond-body">${w && w.raw ? `<div class="raw"><span class="lbl">${t('metar')}</span><code>${esc(w.raw)}</code></div>` : `<p class="muted small">${esc(t('wx_none'))}</p>`}
        ${w && w.taf ? `<div class="raw"><span class="lbl">${t('taf')}</span><code>${esc(w.taf)}</code></div>` : ''}</div>
      </details>`;
    }).join('');
    el.innerHTML = `<details class="card cond-card${worst ? ' cond-alert' : ''}" data-key="cond-all">
      <summary><span class="cond-title">${esc(t('conditions'))}</span><span class="cchips">${chips}</span></summary>
      <div class="cond-list">${items}</div></details>`;
  }

  function renderToolbar() {
    const r = st.run, el = $('#toolbar');
    if (r.fatal) { el.innerHTML = ''; return; }
    const v = st.view;
    const a = v.filter(i => i.stops === 0).length, b = v.filter(i => i.stops === 1).length, c = v.filter(i => i.stops === 2).length;
    const sortKey = currentSort();
    const sorts = (r.q.mode === 'commute' ? ['plan'] : []).concat(['depart', 'arrive', 'late', 'duration', 'stops']);
    /* airline chips from all (unfiltered by airline) options */
    const counts = new Map();
    const base = E.filter(r.itins, { departAfter: r.q.departAfter, departBefore: r.q.departBefore, arriveAfter: r.q.arriveAfter, arriveBefore: r.q.arriveBefore, arriveByUtc: r.arriveByUtc, maxStops: effectiveStops(r), noRedeye: r.q.noRedeye, exclude: hiddenAirlines() });
    E.prune(base, {}).forEach(it => it.carriers.forEach(cc => counts.set(cc, (counts.get(cc) || 0) + 1)));
    const mine = new Set(ST.get('myAirlines') || []);
    const chips = Array.from(counts.entries()).sort((x, y) => y[1] - x[1]).map(([code, n]) =>
      `<button type="button" class="al-chip${st.include.indexOf(code) >= 0 ? ' on' : ''}${mine.has(code) ? ' mine' : ''}" data-act="al" data-al="${esc(code)}" title="${esc(AL.name(code))}">${logo(code)}${esc(code)} <small>${n}</small></button>`).join('');
    const showTwo = !r.twoStopLoaded && r.q.maxStops < 2;
    el.innerHTML = `<div class="toolbar">
      <div class="counts"><b>${esc(v.length === 1 ? t('found_1') : t('found', { n: v.length }))}</b>
        <span class="muted">${esc(t('found_breakdown', { a, b, c }))}</span></div>
      <p class="loads-note"><span aria-hidden="true">ⓘ</span> ${esc(t('loads_note'))}</p>
      <div class="tools">
        <label class="sort"><span class="muted small">${esc(t('sort_by'))}</span>
          <select id="sortSel">${sorts.map(s => option(s, t('sort_' + s), s === sortKey)).join('')}</select></label>
        <button type="button" class="ghost sm" data-act="save-trip">☆ ${esc(t('save_trip'))}</button>
        <button type="button" class="ghost sm" data-act="share-search">${esc(t('share'))}</button>
      </div>
      ${chips ? `<div class="al-chips"><span class="muted small">${esc(t('airlines'))}:</span>
        <button type="button" class="al-chip${st.include.length ? '' : ' on'}" data-act="al" data-al="">${esc(t('all_airlines'))}</button>${chips}</div>` : ''}
      ${showTwo ? `<button type="button" class="ghost two-stop" data-act="two-stop">${esc(t('try_two_stops'))} <small class="muted">(${esc(t('two_stop_cost', { n: 12 }))})</small></button>` : ''}
    </div>`;
    $('#sortSel').addEventListener('change', (e) => {
      st.sort = e.target.value;
      if (r.q.mode === 'find') ST.set('sort', st.sort);
      render();
    });
  }

  function renderResults() {
    const r = st.run, el = $('#results');
    if (r.fatal) { el.innerHTML = ''; return; }
    const v = st.view;
    if (!v.length) {
      el.innerHTML = `<div class="card empty"><p><b>${esc(t('no_results'))}</b></p><p class="muted">${esc(t('no_results_tips'))}</p></div>`;
      return;
    }
    const sortKey = currentSort();
    const groupByDay = r.q.mode === 'commute' && (sortKey === 'depart' || sortKey === 'late') && r.dates.length > 1;
    let html = '', lastDay = null, lastSec = null;
    v.slice(0, st.shown).forEach(it => {
      if (sortKey === 'plan' && r.planA && it.section !== lastSec) {
        lastSec = it.section;
        html += `<h3 class="day-hdr">${esc(t(it.section === 'plan' ? 'sec_plan' : 'sec_earlier'))}</h3>`;
      }
      if (groupByDay && it.depDate !== lastDay) {
        lastDay = it.depDate;
        const key = it.depDate < r.q.date ? 'night_before_hdr' : 'report_day_hdr';
        html += `<h3 class="day-hdr">${esc(t(key, { d: T.fmtDate(it.depDate, lang()) }))}</h3>`;
      }
      html += itinHtml(it);
    });
    if (v.length > st.shown) {
      html += `<button type="button" class="ghost more" data-act="more">${esc(t('show_more', { n: v.length - st.shown }))}</button>`;
    }
    el.innerHTML = html;
  }

  function statusChip(leg) {
    const s = leg.status;
    if (!s || s === 'Unknown' || s === 'Expected') return '';
    const cls = /Cancel|Divert/.test(s) ? 'bad' : (s === 'Delayed' ? 'warn' : (/EnRoute|Departed|Approaching/.test(s) ? 'info' : (s === 'Arrived' ? 'done' : 'ok')));
    return `<span class="st st-${cls}">${esc(t('st_' + s))}</span>`;
  }

  /* On-time history from BTS for this flight (or the airline on this route). */
  function trendHtml(leg) {
    const ot = S.onTime(leg);
    if (!ot) return '';
    const bits = [t('on_time', { n: ot.ot }), t('canceled_pct', { n: ot.cxl })];
    if (ot.avgDelay > 0) bits.push(t('avg_delay', { n: ot.avgDelay }));
    const cls = ot.ot >= 80 ? 'ot-good' : (ot.ot >= 65 ? 'ot-mid' : 'ot-bad');
    const who = ot.src === 'route' ? t('ot_route', { a: AL.name(leg.carrier) }) : t('ot_flight');
    return `<div class="trend ${cls}"><span class="ot-dot" aria-hidden="true"></span><span>${esc(bits.join(' · '))} <span class="muted">(${esc(who)}, ${esc(ot.months)})</span></span></div>`;
  }

  function inboundHtml(leg) {
    const res = st.inbound[leg.id];
    if (st.inboundBusy[leg.id]) return `<div class="ib ib-busy">${esc(t('inbound_checking'))}</div>`;
    if (!res) return '';
    if (res.state === 'error') return `<div class="ib ib-bad">${esc(t('ib_error'))}</div>`;
    const p = res.prev;
    const tl = p ? fmt(T.zoned(res.eta, AP.tz(leg.from)).time) : '';
    const map = {
      unassigned: ['ib-info', t('ib_unassigned')],
      unknown: ['ib-info', t('ib_unknown', { reg: res.reg })],
      first: ['ib-ok', t('ib_first', { reg: res.reg })],
      ok: ['ib-ok', p && t('ib_ok', { f: p.flight, a: p.from, t: tl, reg: res.reg })],
      tight: ['ib-warn', p && t('ib_tight', { f: p.flight, a: p.from, t: tl, n: Math.max(0, res.lateIn) })],
      late: ['ib-bad', p && t('ib_late', { f: p.flight, a: p.from, t: tl, n: res.lateIn, d: res.depDelay })],
      prev_canceled: ['ib-bad', p && t('ib_prev_canceled', { f: p.flight })]
    }[res.state] || ['ib-info', ''];
    const fa = res.reg ? ` <a href="https://www.flightaware.com/live/flight/${encodeURIComponent(res.reg)}" target="_blank" rel="noopener">${esc(res.reg)} ↗</a>` : '';
    return `<div class="ib ${map[0]}">${esc(map[1])}${res.state !== 'unassigned' ? fa : ''}</div>`;
  }

  function legHtml(leg, it, idx) {
    const ac = AL.aircraft(leg.model);
    const seats = leg.model && ac ? ac.seats : null;
    const plus = leg.arrDate && leg.depDate ? T.daysBetween(leg.depDate, leg.arrDate) : 0;
    const depPlace = [leg.depTerminal && t('terminal', { x: leg.depTerminal }), leg.depGate && t('gate', { x: leg.depGate })].filter(Boolean).join(' · ');
    const arrPlace = [leg.arrTerminal && t('terminal', { x: leg.arrTerminal }), leg.arrGate && t('gate', { x: leg.arrGate })].filter(Boolean).join(' · ');
    const depEst = isFinite(leg.depEst) && Math.abs(leg.depEst - leg.depUtc) >= 5 * MIN ? `<span class="est">${esc(t('est', { t: fmt(T.zoned(leg.depEst, AP.tz(leg.from)).time) }))}</span>` : '';
    const arrEst = isFinite(leg.arrEst) && Math.abs(leg.arrEst - leg.arrUtc) >= 5 * MIN ? `<span class="est">${esc(t('est', { t: fmt(T.zoned(leg.arrEst, AP.tz(leg.to)).time) }))}</span>` : '';
    const op = leg.opName ? `<span class="op">${esc(t('operated_by', { x: leg.opName }))}</span>` : '';
    const shares = leg.codeshares && leg.codeshares.length ? `<span class="muted">${esc(t('also_sold_as', { x: leg.codeshares.slice(0, 4).join(', ') }))}</span>` : '';
    const model = [AL.shortModel(leg.model), seats ? t('seats_approx', { n: seats }) : ''].filter(Boolean).join(' · ');
    const untilDep = leg.depUtc - Date.now();
    const ibReady = untilDep < 48 * 3600000 && untilDep > -2 * 3600000;
    const links = AL.trackLinks(leg).map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)} ↗</a>`).join('');
    const mine = (ST.get('myAirlines') || []).indexOf(leg.carrier) >= 0;
    return `<li class="leg">
      <div class="leg-top">
        ${logo(leg.carrier, 'al-logo-leg')}<span class="fl${mine ? ' fl-mine' : ''}">${esc(leg.flight)}</span>
        <span class="al-name">${esc(AL.name(leg.carrier))}</span>${op}${statusChip(leg)}
      </div>
      <div class="leg-times">
        <div class="lt-row"><span class="lt">${clock(leg.depTime)}</span><b>${esc(leg.from)}</b>${depEst}${depPlace ? `<span class="place">${esc(depPlace)}</span>` : ''}</div>
        <div class="lt-row"><span class="lt">${clock(leg.arrTime)}${plus > 0 ? `<sup>+${plus}</sup>` : (plus < 0 ? `<sup>${plus}</sup>` : '')}</span><b>${esc(leg.to)}</b>${arrEst}${arrPlace ? `<span class="place">${esc(arrPlace)}</span>` : ''}</div>
      </div>
      ${model || shares ? `<div class="leg-sub muted">${esc(model)}${model && shares ? ' · ' : ''}${shares}</div>` : ''}
      ${trendHtml(leg)}
      <div class="leg-actions">
        <details class="menu" data-key="trk:${esc(leg.id)}"><summary class="ghost sm">${esc(t('track'))}</summary><div class="menu-pop">${links}</div></details>
        <button type="button" class="ghost sm" data-act="inbound" data-it="${esc(it.id)}" data-leg="${idx}" ${ibReady ? '' : `disabled title="${esc(t('inbound_later'))}"`}>${esc(t('inbound_btn'))}</button>
        ${ibReady ? '' : `<span class="muted small">${esc(t('inbound_later'))}</span>`}
      </div>
      ${inboundHtml(leg)}
    </li>`;
  }

  function connHtml(c) {
    const need = c.same ? st.run.q.minConnSame : st.run.q.minConnOther;
    const slack = c.min - need;
    const cls = slack < 15 ? 'conn-tight' : (slack < 30 ? 'conn-snug' : 'conn-ok');
    return `<li class="conn ${cls}">
      <span class="conn-main">⏱ ${esc(t('conn_in', { d: T.fmtDur(c.min), a: AP.label(c.at) }))}</span>
      ${c.overnight ? `<span class="conn-note">${esc(t('conn_overnight'))}</span>` : ''}
      ${c.same ? '' : `<span class="conn-note">${esc(t('conn_change'))}</span>`}
    </li>`;
  }

  function itinHtml(it) {
    const first = it.legs[0], last = it.legs[it.legs.length - 1];
    const plus = T.daysBetween(it.depDate, it.arrDate);
    const stopsTxt = it.stops === 0 ? t('nonstop') : (it.stops === 1 ? t('n_stop') : t('n_stops', { n: it.stops }));
    const via = it.conns.map(c => c.at).join(', ');
    const flags = it.flags || [];
    const lvl = S.level(flags);
    const role = it.role ? `<span class="role role-${it.role}">${esc(t('role_' + it.role))}</span>` : '';
    const mine = new Set(ST.get('myAirlines') || []);
    const carriers = it.carriers.map(c => `<span class="al${mine.has(c) ? ' al-mine' : ''}" title="${esc(AL.name(c))}">${logo(c)}${esc(c)}</span>`).join('');
    const backups = it.backups === 0 ? t('backups_0') : (it.backups === 1 ? t('backups_1') : t('backups_n', { n: it.backups > 20 ? '20+' : it.backups }));
    const dayBadge = st.run && it.depDate !== st.run.q.date ? `<span class="day-badge">${esc(T.fmtDate(it.depDate, lang()))}</span>` : '';
    const dots = it.conns.map(() => '<i></i>').join('');
    let legs = '';
    it.legs.forEach((leg, i) => {
      if (i > 0) legs += connHtml(it.conns[i - 1]);
      legs += legHtml(leg, it, i);
    });
    const flagHtml = flags.length
      ? `<ul class="flags">${flags.map(f => `<li class="flag flag-${f.level}">${esc(t(f.t, f.p))}</li>`).join('')}</ul>` : '';
    return `<article class="itin lvl-${lvl}" data-id="${esc(it.id)}">
      <div class="itin-head">
        <div class="tl">
          <div class="tl-end"><span class="tl-time">${clock(first.depTime)}</span><span class="tl-code">${esc(it.from)}</span></div>
          <div class="tl-mid"><span class="tl-dur">${T.fmtDur(it.durMin)}</span><span class="tl-line">${dots}</span>
            <span class="tl-stops">${esc(stopsTxt)}${via ? ' · ' + esc(via) : ''}</span></div>
          <div class="tl-end tl-right"><span class="tl-time">${clock(last.arrTime)}${plus > 0 ? `<sup>+${plus}</sup>` : ''}</span><span class="tl-code">${esc(it.to)}</span></div>
        </div>
      </div>
      <div class="itin-meta">${role}${dayBadge}${carriers}<span class="backups">${esc(backups)}</span></div>
      ${flagHtml}
      <ol class="legs">${legs}</ol>
      <div class="itin-actions">
        <button type="button" class="ghost sm" data-act="ics" data-it="${esc(it.id)}">${esc(t('add_calendar'))}</button>
        <button type="button" class="ghost sm" data-act="share" data-it="${esc(it.id)}">${esc(t('share'))}</button>
      </div>
    </article>`;
  }

  /* ================= result actions ================= */
  function findItin(id) { return st.view.find(i => i.id === id) || (st.run && st.run.itins.find(i => i.id === id)); }

  function rerenderCard(it) {
    it.flags = S.flags(it, Object.assign({}, st.run.flagCtx || {}, { inbound: st.inbound }));
    const el = $$('#results article.itin').find(a => a.dataset.id === it.id);
    if (!el) return;
    const open = new Set($$('details[open]', el).map(d => d.dataset.key));
    const tmp = document.createElement('div');
    tmp.innerHTML = itinHtml(it);
    const fresh = tmp.firstElementChild;
    $$('details[data-key]', fresh).forEach(d => { if (open.has(d.dataset.key)) d.open = true; });
    el.replaceWith(fresh);
  }

  async function checkInbound(it, idx) {
    const leg = it.legs[idx];
    st.inboundBusy[leg.id] = true;
    rerenderCard(it);
    try {
      st.inbound[leg.id] = await CC.inbound.check(leg);
    } catch (e) {
      st.inbound[leg.id] = { state: 'error', error: e };
      if (e && (e.code === 'bad_code' || e.code === 'limit')) setStatus('error', esc(errorText(e)));
      if (e && e.code === 'bad_code') { ST.forgetCode(); openCodeDialog('code_wrong'); }
    }
    delete st.inboundBusy[leg.id];
    rerenderCard(it);
    refreshUsage(true);
  }

  function icsStamp(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  function icsEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
  function downloadIcs(it) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Crew Commute//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    it.legs.forEach(l => {
      const desc = [l.flight + (l.opName ? ' (' + t('operated_by', { x: l.opName }) + ')' : ''), AL.shortModel(l.model), l.depGate ? t('gate', { x: l.depGate }) : '', 'Crew Commute'].filter(Boolean).join('\n');
      lines.push('BEGIN:VEVENT', 'UID:' + l.id.replace(/[^\w-]/g, '') + '@crew-commute', 'DTSTAMP:' + icsStamp(Date.now()),
        'DTSTART:' + icsStamp(l.depUtc), 'DTEND:' + icsStamp(l.arrUtc),
        'SUMMARY:' + icsEsc(l.flight + ' ' + l.from + '-' + l.to + ' (standby)'),
        'LOCATION:' + icsEsc(AP.label(l.from)), 'DESCRIPTION:' + icsEsc(desc), 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'crew-commute-' + it.from + '-' + it.to + '-' + it.depDate + '.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  async function shareText(title, text, btn) {
    const url = location.href;
    try {
      if (navigator.share) { await navigator.share({ title, text, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try {
      await navigator.clipboard.writeText(text + '\n' + url);
      if (btn) { const old = btn.textContent; btn.textContent = t('copied'); setTimeout(() => { btn.textContent = old; }, 1500); }
    } catch (e) { /* ignore */ }
  }
  function itinText(it) {
    const head = `${it.from} ${fmt(it.legs[0].depTime)} → ${it.to} ${fmt(it.legs[it.legs.length - 1].arrTime)} (${T.fmtDate(it.depDate, lang())}, ${T.fmtDur(it.durMin)})`;
    const legs = it.legs.map(l => `${l.flight} ${l.from}→${l.to} ${fmt(l.depTime)}–${fmt(l.arrTime)}${l.opName ? ' (' + l.opName + ')' : ''}`);
    return [head].concat(legs).join('\n');
  }

  function setupResultsEvents() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || !st.run) return;
      const act = b.dataset.act;
      if (act === 'more') { st.shown += 25; renderResults(); return; }
      if (act === 'al') {
        const code = b.dataset.al;
        if (!code) st.include = [];
        else if (st.include.indexOf(code) >= 0) st.include = st.include.filter(c => c !== code);
        else st.include = st.include.concat(code);
        st.shown = 25;
        render();
        return;
      }
      if (act === 'two-stop') {
        search(false, { twoStop: true });
        return;
      }
      if (act === 'save-trip') {
        const q = st.run.q;
        const name = prompt(t('trip_name_prompt'), q.from.join('/') + ' → ' + q.to.join('/'));
        if (!name) return;
        ST.addTrip({ name: name.slice(0, 40), mode: q.mode, from: q.from, to: q.to, report: q.report, buffer: q.buffer });
        renderTrips();
        return;
      }
      if (act === 'share-search') {
        const q = st.run.q;
        shareText('Crew Commute', `Crew Commute: ${q.from.join('/')} → ${q.to.join('/')} · ${T.fmtDate(q.date, lang())}`, b);
        return;
      }
      const it = b.dataset.it ? findItin(b.dataset.it) : null;
      if (!it) return;
      if (act === 'inbound') checkInbound(it, +b.dataset.leg);
      else if (act === 'ics') downloadIcs(it);
      else if (act === 'share') shareText('Crew Commute', itinText(it), b);
    });
  }

  /* ================= saved trips ================= */
  function quickTrips() {
    const list = ((root.CREW_CONFIG || {}).quickTrips || []);
    return list.filter(q => q && AP.get(q.from) && AP.get(q.to) && q.from !== q.to).slice(0, 8);
  }
  function startTrip(tr) {
    st.from = [].concat(tr.from).map(c => String(c).toUpperCase());
    st.to = [].concat(tr.to).map(c => String(c).toUpperCase());
    drawChips('from'); drawChips('to');
    setMode(tr.mode === 'commute' ? 'commute' : 'find');
    if (tr.report) $('#reportInput').value = tr.report;
    if (tr.buffer) $('#bufferInput').value = String(tr.buffer);
    if (!$('#dateInput').value) $('#dateInput').value = T.deviceToday();
    search(true);
  }
  function renderTrips() {
    const trips = ST.trips(), quick = quickTrips();
    $('#trips').hidden = !trips.length && !quick.length;
    $('#quickGroup').hidden = !quick.length;
    $('#savedGroup').hidden = !trips.length;
    $('#quickList').innerHTML = quick.map((tr, i) =>
      `<button type="button" class="trip-quick" data-quick="${i}">${esc(tr.from)} <span aria-hidden="true">→</span> ${esc(tr.to)}</button>`).join('');
    $('#tripList').innerHTML = trips.map((tr, i) =>
      `<span class="trip"><button type="button" class="trip-go" data-trip="${i}">${tr.mode === 'commute' ? '🧳 ' : '✈ '}${esc(tr.name)}</button>` +
      `<button type="button" class="trip-x" data-trip-rm="${esc(tr.name)}" aria-label="${esc(t('remove'))}">×</button></span>`).join('');
    $('#quickList').onclick = (e) => {
      const b = e.target.closest('[data-quick]');
      if (b) { const tr = quickTrips()[+b.dataset.quick]; if (tr) startTrip(tr); }
    };
    $('#tripList').onclick = (e) => {
      const rm = e.target.closest('[data-trip-rm]');
      if (rm) { ST.removeTrip(rm.dataset.tripRm); renderTrips(); return; }
      const go = e.target.closest('[data-trip]');
      if (!go) return;
      const tr = ST.trips()[+go.dataset.trip];
      if (tr) startTrip(tr);
    };
  }

  /* ================= airline logos ================= */
  /* A logo is always shown next to the airline code, never instead of it, so a logo that can't load changes nothing. */
  const badLogos = new Set();
  function logo(code, cls) {
    if (ST.get('showLogos') === false || badLogos.has(code)) return '';
    const url = AL.logoUrl(code);
    if (!url) return '';
    return `<img class="al-logo${cls ? ' ' + cls : ''}" src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-code="${esc(code)}">`;
  }
  function setupLogos() {
    const isLogo = (el) => el && el.classList && el.classList.contains('al-logo');
    const drop = (img) => { badLogos.add(img.dataset.code); img.remove(); };
    document.addEventListener('error', (e) => { if (isLogo(e.target)) drop(e.target); }, true);
    /* an empty placeholder picture counts as missing */
    document.addEventListener('load', (e) => {
      if (isLogo(e.target) && (e.target.naturalWidth < 8 || e.target.naturalHeight < 8)) drop(e.target);
    }, true);
  }

  /* ================= dialogs (with a fallback for older phones) ================= */
  const hasDialog = typeof HTMLDialogElement === 'function' && typeof document.createElement('dialog').showModal === 'function';
  function openDialog(dlg) {
    if (dlg.open || dlg.hasAttribute('open')) return;
    if (hasDialog) { dlg.showModal(); return; }
    dlg.setAttribute('open', '');
    dlg.classList.add('dlg-fallback');
    if (!$('.dlg-shade')) { const sh = document.createElement('div'); sh.className = 'dlg-shade'; document.body.appendChild(sh); }
  }
  function closeDialog(dlg) {
    if (hasDialog) { if (dlg.open) dlg.close(); return; }
    if (!dlg.hasAttribute('open')) return;
    dlg.removeAttribute('open');
    if (!$$('dialog[open]').length) { const sh = $('.dlg-shade'); if (sh) sh.remove(); }
    dlg.dispatchEvent(new Event('close'));
  }

  /* ================= light / dark theme ================= */
  const darkQuery = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
  function effectiveTheme() {
    const pref = ST.get('theme') || 'auto';
    if (pref === 'light' || pref === 'dark') return pref;
    return darkQuery && darkQuery.matches ? 'dark' : 'light';
  }
  function applyTheme() {
    const th = effectiveTheme();
    document.documentElement.setAttribute('data-theme', th);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', th === 'dark' ? '#0b1730' : '#0f2a4a');
    $$('input[name=theme]').forEach(r => { r.checked = r.value === (ST.get('theme') || 'auto'); });
  }
  function setupTheme() {
    applyTheme();
    $('#themeBtn').addEventListener('click', () => {
      ST.set('theme', effectiveTheme() === 'dark' ? 'light' : 'dark');
      applyTheme();
    });
    $$('input[name=theme]').forEach(r => r.addEventListener('change', () => { ST.set('theme', r.value); applyTheme(); }));
    const onSystem = () => { if ((ST.get('theme') || 'auto') === 'auto') applyTheme(); };
    if (darkQuery) {
      if (darkQuery.addEventListener) darkQuery.addEventListener('change', onSystem);
      else if (darkQuery.addListener) darkQuery.addListener(onSystem);
    }
  }

  /* ================= access code pop-up ================= */
  /* People see "access code". Inside the code it is still the group code (Cloudflare: ACCESS_CODE). */
  let afterCode = null;     /* what to do once a code is accepted or demo is chosen (e.g. run a shared search) */
  let codeErrFn = null;     /* the current pop-up message, kept as a function so it follows a language change */
  let wantCodeDialog = false;
  function needsCode() { return !CC.api.isDemo() && !ST.code(); }
  function codeDialogOpen() { const d = $('#codeDlg'); return !!(d.open || d.hasAttribute('open')); }
  function setCodeErr(fn) {
    codeErrFn = fn || null;
    $('#codeErr').textContent = codeErrFn ? codeErrFn() : '';
  }
  /* Texts in the pop-up that depend on the situation (also redrawn when the language changes). */
  function drawCodeTexts() {
    $('#codeIntro').textContent = ST.codeExpired() ? t('code_expired') : t('welcome_text');
    $('#codeShow').textContent = $('#codeEntry').type === 'password' ? t('show') : t('hide');
    if (codeErrFn) $('#codeErr').textContent = codeErrFn();
    $$('[data-setlang]').forEach(b => {
      const on = b.dataset.setlang === lang();
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  function openCodeDialog(errKey) {
    if (!CC.api.base()) return;               /* no helper set up: the site only has demo data */
    const dlg = $('#codeDlg');
    const entry = $('#codeEntry');
    if (!codeDialogOpen()) {
      entry.value = '';
      entry.type = 'password';
      $('#codeRemember').checked = !!ST.get('rememberDevice');
    }
    setCodeErr(errKey ? () => t(errKey) : null);
    const canClose = !needsCode();
    $('#codeClose').hidden = !canClose;
    /* "Explore with demo flights" is only for people who have no code yet and aren't exploring already */
    const offerDemo = !ST.code() && !ST.exploring();
    $('#exploreBtn').hidden = !offerDemo;
    $('.code-or').hidden = !offerDemo;
    $('.explore-hint').hidden = !offerDemo;
    drawCodeTexts();
    if (!codeDialogOpen()) openDialog(dlg);
    setTimeout(() => { try { entry.focus(); } catch (e) { /* ignore */ } }, 50);
  }
  /* After a code is accepted or demo is chosen: run what was waiting, or redo a search that had no data. */
  function codeAccepted(rerun) {
    const next = afterCode; afterCode = null;
    if (next) next();
    else if (st.run && (rerun || st.run.fatal)) search();
    refreshUsage(true);
  }
  function setupCodeDialog() {
    const dlg = $('#codeDlg');
    /* the site needs a code or demo mode: Esc doesn't close the pop-up until one is chosen */
    dlg.addEventListener('cancel', (e) => { if (needsCode()) e.preventDefault(); });
    $('#codeClose').addEventListener('click', () => { if (!needsCode()) closeDialog(dlg); });
    $('#codeShow').addEventListener('click', () => {
      const i = $('#codeEntry');
      i.type = i.type === 'password' ? 'text' : 'password';
      drawCodeTexts();
      try { i.focus(); } catch (e) { /* ignore */ }
    });
    $('#codeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#codeGo');
      if (btn.disabled) return;
      const code = $('#codeEntry').value.trim();
      if (!code) { setCodeErr(() => t('code_empty')); return; }
      setCodeErr(null);
      btn.disabled = true;
      btn.classList.add('busy');
      const label = $('span', btn);
      if (label) label.textContent = t('checking');
      try {
        await CC.api.ping(code);                  /* checked first, so a wrong code is never saved */
        const wasDemo = !!(st.run && st.run.demo);
        ST.saveCode(code, $('#codeRemember').checked);
        ST.setExploring(false);
        CC.api.clearCache();
        $('#codeEntry').value = '';
        drawCodeTexts();
        closeDialog(dlg);
        updateDemoBanner();
        codeAccepted(wasDemo);                    /* demo results are replaced by real ones */
      } catch (ex) {
        if (ex && ex.code === 'bad_code') setCodeErr(() => t('code_wrong'));
        else setCodeErr(() => errorText(ex));
      } finally {
        btn.disabled = false;
        btn.classList.remove('busy');
        if (label) label.textContent = t('continue');
      }
    });
    $('#exploreBtn').addEventListener('click', () => {
      ST.setExploring(true);                      /* this visit only; no calls to the helper at all */
      CC.api.clearCache();
      $('#codeEntry').value = '';
      setCodeErr(null);
      closeDialog(dlg);
      updateDemoBanner();
      codeAccepted(false);
    });
    $('#demoExit').addEventListener('click', () => openCodeDialog());
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-setlang]');
      if (b) { ST.set('lang', b.dataset.setlang); applyLang(); }
    });
    /* the code expires after a few days: check again when the site comes back on screen */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && needsCode() && !codeDialogOpen()) openCodeDialog();
    });
  }

  /* ================= settings ================= */
  const adminMode = /[?&#]admin\b/.test(location.search + location.hash);
  let connAtOpen = null, demoAtOpen = null;
  function fmtDay(ms) {
    try { return new Date(ms).toLocaleDateString(lang() === 'es' ? 'es' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
    catch (e) { return new Date(ms).toDateString(); }
  }
  /* Access code status in Settings: saved on this device, only for this visit, or demo. */
  function drawCodeStatus() {
    $('#codeField').hidden = !CC.api.base();
    const info = ST.codeInfo();
    let text;
    if (info) text = info.remembered ? t('code_saved_until', { d: fmtDay(info.askAgainAt) }) : t('code_session');
    else if (CC.api.isDemo()) text = t('code_demo_status');
    else text = t('code_none');
    $('#codeStatus').textContent = text;
    $('#changeCodeBtn').textContent = info ? t('change_code') : t('enter_code');
    $('#forgetCodeBtn').hidden = !info;
  }
  function openSettings() {
    const dlg = $('#settingsDlg');
    connAtOpen = connKey();
    demoAtOpen = CC.api.isDemo();
    drawCodeStatus();
    $('#adminBox').hidden = !adminMode;
    $('#apiInput').value = ST.get('apiBase') || (root.CREW_CONFIG && root.CREW_CONFIG.apiBase) || '';
    $('#demoToggle').checked = !!ST.get('forceDemo');
    $$('input[name=lang]').forEach(r => { r.checked = r.value === lang(); });
    $$('input[name=tfmt]').forEach(r => { r.checked = r.value === ST.get('timeFmt'); });
    $$('input[name=theme]').forEach(r => { r.checked = r.value === (ST.get('theme') || 'auto'); });
    $('#backupsWanted').value = String(ST.get('backupsWanted'));
    $('#logosField').hidden = !AL.logoUrl('AA');
    $('#logosToggle').checked = ST.get('showLogos') !== false;
    drawMyAirlines();
    openDialog(dlg);
  }
  function drawMyAirlines() {
    const mine = new Set(ST.get('myAirlines') || []);
    $('#myAirlines').innerHTML = MY_AIRLINE_CHOICES.filter(c => hiddenAirlines().indexOf(c) < 0).map(c =>
      `<button type="button" class="al-chip${mine.has(c) ? ' on' : ''}" data-my="${esc(c)}" aria-pressed="${mine.has(c)}">${logo(c)}${esc(c)} <small>${esc(AL.name(c))}</small></button>`).join('');
  }
  function connKey() { return [ST.code(), ST.get('apiBase'), ST.get('forceDemo'), ST.exploring()].join('|'); }
  function saveSettingsInputs() {
    if (adminMode) {
      const api = $('#apiInput').value.trim();
      const cfgBase = (root.CREW_CONFIG && root.CREW_CONFIG.apiBase) || '';
      ST.set('apiBase', api && api !== cfgBase ? api : '');
      ST.set('forceDemo', $('#demoToggle').checked);
    }
    updateDemoBanner();
  }
  function setupSettings() {
    $('#settingsBtn').addEventListener('click', openSettings);
    const dlg = $('#settingsDlg');
    $('#settingsForm').addEventListener('submit', (e) => { e.preventDefault(); closeDialog(dlg); });
    $('.dlg-close', dlg).addEventListener('click', () => closeDialog(dlg));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || hasDialog) return;
      if (dlg.hasAttribute('open')) closeDialog(dlg);
      else if (codeDialogOpen() && !needsCode()) closeDialog($('#codeDlg'));
    });
    $('#changeCodeBtn').addEventListener('click', () => { wantCodeDialog = true; closeDialog(dlg); });
    $('#forgetCodeBtn').addEventListener('click', () => {
      ST.forgetCode();
      ST.setExploring(false);
      CC.api.clearCache();
      updateDemoBanner();
      closeDialog(dlg);                         /* the pop-up then asks for a code (or demo) again */
    });
    $('#myAirlines').addEventListener('click', (e) => {
      const b = e.target.closest('[data-my]');
      if (!b) return;
      const mine = ST.get('myAirlines') || [];
      const c = b.dataset.my;
      ST.set('myAirlines', mine.indexOf(c) >= 0 ? mine.filter(x => x !== c) : mine.concat(c));
      drawMyAirlines();
    });
    $$('input[name=lang]').forEach(r => r.addEventListener('change', () => { ST.set('lang', r.value); applyLang(); drawMyAirlines(); }));
    $$('input[name=tfmt]').forEach(r => r.addEventListener('change', () => { ST.set('timeFmt', r.value); render(); }));
    $('#backupsWanted').addEventListener('change', (e) => { ST.set('backupsWanted', +e.target.value); render(); });
    $('#logosToggle').addEventListener('change', (e) => { ST.set('showLogos', e.target.checked); drawMyAirlines(); render(); });
    $('#resetBtn').addEventListener('click', () => {
      if (confirm(t('reset_confirm'))) { ST.reset(); location.hash = ''; location.reload(); }
    });
    dlg.addEventListener('close', () => {
      saveSettingsInputs();
      const changed = connKey() !== connAtOpen || CC.api.isDemo() !== demoAtOpen;
      if (changed) CC.api.clearCache();
      applyLang();
      if (wantCodeDialog || needsCode()) {
        wantCodeDialog = false;
        openCodeDialog();
        return;
      }
      if (st.run && (changed || st.run.fatal)) search();
    });
  }

  /* go */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* for debugging in the browser console */
  CC.app = { state: st, search, render };
})(window);
