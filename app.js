(function () {
  'use strict';

  // How far off we think the clock could be: the jam itself is good to about
  // a quarter second, and a phone clock can wander against a timecode
  // generator by something like 30 parts per million.
  const BASE_ERR_S = 0.25;
  const DRIFT_PPM = 30;
  const WARN_ERR_S = 0.6; // amber, about 3 hours after a jam
  const BAD_ERR_S = 1.0;  // red, about 7 hours: could be off by a second

  const $ = (id) => document.getElementById(id);
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) { /* private mode or full: keep running in memory */ }
    },
  };

  let jam = store.get('tcjam.jam', null);      // { rate, f0, wall } or null
  let cues = store.get('tcjam.cues', []);      // [{ tc, rate, wall, note }]
  let rate = store.get('tcjam.rate', '23.976');
  let clockJumped = store.get('tcjam.jumped', false);
  if (!TC.RATES[rate]) rate = '23.976';
  if (jam && !TC.RATES[jam.rate]) jam = null;
  if (jam) rate = jam.rate;

  // ---------- frame rate ----------

  const rateSel = $('rate');
  TC.RATE_ORDER.forEach((key) => {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = TC.RATES[key].label;
    rateSel.appendChild(o);
  });
  rateSel.value = rate;
  rateSel.addEventListener('change', () => {
    rate = rateSel.value;
    store.set('tcjam.rate', rate);
    if (jam) {
      jam = TC.rerate(jam, rate);
      store.set('tcjam.jam', jam);
    }
    lastShown = '';
  });

  // ---------- clock ----------

  const tapEl = $('tap');
  const tcMain = $('tc-main');
  const tcTens = $('tc-tens');
  const tcStar = $('tc-star');
  const statusEl = $('status');
  const hintEl = $('hint');
  const trimTc = $('trim-tc');
  let lastShown = '';
  let lastStatus = '';
  let starsOn = true;
  let prevWall = Date.now();
  let prevPerf = performance.now();

  function nowTc() {
    return TC.framesToTc(TC.framesAt(jam, Date.now()), jam.rate);
  }

  function ago(ms) {
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    return Math.floor(min / 60) + 'h ' + TC.pad(min % 60) + 'm ago';
  }

  function tick() {
    const wall = Date.now();
    const perf = performance.now();

    // The clock runs off wall time so it survives sleep and reloads. If wall
    // time is stepped while we are running, the jam is no longer trustworthy.
    const dWall = wall - prevWall;
    const dPerf = perf - prevPerf;
    if (jam && dPerf < 2000 && Math.abs(dWall - dPerf) > 400 && !clockJumped) {
      clockJumped = true;
      store.set('tcjam.jumped', true);
    }
    prevWall = wall;
    prevPerf = perf;

    if (jam) {
      const tc = nowTc();
      const s = TC.approx(TC.formatTc(tc, jam.rate));
      if (s !== lastShown) {
        lastShown = s;
        tcMain.textContent = s.slice(0, 8);
        tcTens.textContent = s.slice(8, 10);
        trimTc.textContent = s;
      }
      // This clock is good to the second, not the frame. Tens of frames are
      // shown; the units are a star that flashes once a second.
      const on = tc.f * 2 < TC.RATES[jam.rate].nominal;
      if (on !== starsOn) {
        starsOn = on;
        tcStar.classList.toggle('off', !on);
      }
      const age = wall - jam.wall;
      const err = BASE_ERR_S + (age / 1000) * DRIFT_PPM * 1e-6;
      let cls = 'ok';
      let text = 'Jammed ' + ago(age);
      if (clockJumped) {
        cls = 'bad';
        text = 'REJAM. Phone clock changed.';
      } else if (err >= BAD_ERR_S) {
        cls = 'bad';
        text = 'REJAM. Jammed ' + ago(age) + ', may be off by over a second.';
      } else if (err >= WARN_ERR_S) {
        cls = 'warn';
        text += '. Rejam soon.';
      }
      const st = cls + '|' + text;
      if (st !== lastStatus) {
        lastStatus = st;
        statusEl.className = 'status ' + cls;
        statusEl.textContent = text;
        tapEl.classList.toggle('stale', cls === 'bad');
        hintEl.textContent = 'Tap to mark';
      }
    } else if (lastStatus !== 'none') {
      lastStatus = 'none';
      lastShown = '';
      tcMain.textContent = '--:--:--';
      tcTens.textContent = ':-';
      tcStar.classList.remove('off');
      tapEl.classList.remove('stale');
      statusEl.className = 'status';
      statusEl.textContent = 'Not jammed';
      hintEl.textContent = 'Tap to jam';
    }
    requestAnimationFrame(tick);
  }

  // ---------- cues ----------

  const cuesEl = $('cues');

  function saveCues() {
    store.set('tcjam.cues', cues);
  }

  function renderCues() {
    cuesEl.textContent = '';
    for (let i = cues.length - 1; i >= 0; i--) {
      const c = cues[i];
      const li = document.createElement('li');

      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = i + 1;

      const tc = document.createElement('span');
      tc.className = 'ctc';
      tc.textContent = TC.approx(c.tc);

      const note = document.createElement('input');
      note.type = 'text';
      note.placeholder = 'note';
      note.value = c.note || '';
      note.setAttribute('aria-label', 'Note for cue ' + (i + 1));
      note.addEventListener('input', () => {
        c.note = note.value;
        saveCues();
      });

      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '×';
      del.setAttribute('aria-label', 'Delete cue ' + (i + 1));
      del.addEventListener('click', () => {
        cues.splice(cues.indexOf(c), 1);
        saveCues();
        renderCues();
      });

      li.append(num, tc, note, del);
      cuesEl.appendChild(li);
    }
    const n = cues.length;
    $('count').textContent = n ? n + (n === 1 ? ' cue' : ' cues') : 'No cues yet';
    $('btn-undo').disabled = !n;
    $('btn-export').disabled = !n;
    $('btn-clear').hidden = !n;
  }

  function mark() {
    const wall = Date.now();
    const tc = TC.formatTc(TC.framesToTc(TC.framesAt(jam, wall), jam.rate), jam.rate);
    cues.push({ tc: tc, rate: jam.rate, wall: wall, note: '' });
    saveCues();
    renderCues();
    if (navigator.vibrate) navigator.vibrate(15);
    tapEl.classList.add('flash');
    setTimeout(() => tapEl.classList.remove('flash'), 150);
  }

  // Stamp on touch-down, not on release.
  tapEl.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    if (jam) mark();
    else openJam();
  });
  // Keyboard users: Enter/Space on the focused clock.
  tapEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (jam) mark();
    else openJam();
  });

  $('btn-undo').addEventListener('click', () => {
    cues.pop();
    saveCues();
    renderCues();
  });

  $('btn-clear').addEventListener('click', () => {
    if (!confirm('Clear all ' + cues.length + ' cues?')) return;
    cues = [];
    saveCues();
    renderCues();
  });

  // ---------- jam ----------

  const jamPanel = $('jam-panel');
  const ins = { h: $('in-h'), m: $('in-m'), s: $('in-s') };
  const order = ['h', 'm', 's'];

  function setInputs(tc) {
    order.forEach((k) => { ins[k].value = TC.pad(tc[k]); });
  }

  function readInputs() {
    const n = (el, max) => Math.max(0, Math.min(max, parseInt(el.value, 10) || 0));
    return {
      h: n(ins.h, 23),
      m: n(ins.m, 59),
      s: n(ins.s, 59),
      f: 0,
    };
  }

  function addSeconds(tc, secs) {
    const t = (((tc.h * 3600 + tc.m * 60 + tc.s + secs) % 86400) + 86400) % 86400;
    return { h: Math.floor(t / 3600), m: Math.floor(t / 60) % 60, s: t % 60, f: 0 };
  }

  function openJam() {
    if (jam) setInputs(addSeconds(nowTc(), 10));
    $('trim').hidden = !jam;
    jamPanel.hidden = false;
  }

  order.forEach((k, i) => {
    const el = ins[k];
    el.addEventListener('focus', () => el.select());
    el.addEventListener('input', () => {
      el.value = el.value.replace(/\D/g, '').slice(0, 2);
      if (el.value.length === 2 && i < order.length - 1) ins[order[i + 1]].focus();
    });
  });

  $('btn-jam').addEventListener('click', openJam);
  $('jam-close').addEventListener('click', () => { jamPanel.hidden = true; });

  $('jam-tod').addEventListener('click', () => {
    const d = new Date();
    setInputs(addSeconds({ h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() }, 10));
  });

  $('jam-plus5').addEventListener('click', () => {
    setInputs(addSeconds(readInputs(), 5));
  });

  // On a rejam, say how far the old jam had wandered. It is the only real
  // measurement of drift we ever get.
  function driftNote(old, j) {
    const el = $('drift');
    el.hidden = true;
    if (!old || old.rate !== j.rate) return;
    const day = TC.dayFrames(j.rate);
    let d = TC.framesAt(old, j.wall) - j.f0;
    if (d > day / 2) d -= day;
    if (d < -day / 2) d += day;
    const secs = d / TC.RATES[j.rate].real;
    const age = j.wall - old.wall;
    if (age < 60000 || Math.abs(secs) > 30) return; // a fresh retry, or a different timecode
    const mag = Math.abs(secs);
    el.textContent = mag < 0.15
      ? 'The previous jam (' + ago(age) + ') was still on time.'
      : 'The previous jam (' + ago(age) + ') had ended up ' + mag.toFixed(1) + ' s ' + (secs > 0 ? 'ahead.' : 'behind.');
    el.hidden = false;
  }

  function setJam(j) {
    driftNote(jam, j);
    jam = j;
    store.set('tcjam.jam', jam);
    clockJumped = false;
    store.set('tcjam.jumped', false);
    lastShown = '';
    lastStatus = '';
    $('trim').hidden = false;
    if (navigator.vibrate) navigator.vibrate(30);
  }

  $('jam-go').addEventListener('pointerdown', (e) => {
    if (e.button) return;
    const wall = Date.now();
    const tc = readInputs();
    setJam({ rate: rate, f0: TC.tcToFrames(tc, rate), wall: wall });
    setInputs(tc);
  });

  // Used by the camera jam.
  window.TCApp = { rate: () => rate, setJam: setJam };

  document.querySelectorAll('[data-trim]').forEach((b) => {
    b.addEventListener('click', () => {
      if (!jam) return;
      const kind = b.dataset.trim;
      const sign = kind[0] === '-' ? -1 : 1;
      // Shift the jam instant: a whole second, or a quarter second.
      jam.wall -= sign * (kind[1] === 'q' ? 250 : 1000);
      store.set('tcjam.jam', jam);
      lastShown = '';
    });
  });

  // ---------- export ----------

  const exPanel = $('export-panel');
  const exMsg = $('ex-msg');

  function asText() {
    return cues
      .map((c, i) => (i + 1) + '\t' + TC.approx(c.tc) + (c.note ? '\t' + c.note : ''))
      .join('\n');
  }

  function asCsv() {
    const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const rows = cues.map((c, i) =>
      [i + 1, TC.approx(c.tc), q(c.note || ''), TC.RATES[c.rate] ? TC.RATES[c.rate].label : c.rate,
        new Date(c.wall).toISOString()].join(','));
    return ['#,Timecode,Note,Rate,Marked at (UTC)'].concat(rows).join('\r\n') + '\r\n';
  }

  $('btn-export').addEventListener('click', () => {
    exMsg.textContent = '';
    $('ex-share').hidden = !navigator.share;
    exPanel.hidden = false;
  });
  $('export-close').addEventListener('click', () => { exPanel.hidden = true; });

  $('ex-share').addEventListener('click', () => {
    navigator.share({ title: 'Timecode cues', text: asText() }).catch(() => {});
  });

  $('ex-copy').addEventListener('click', () => {
    const text = asText();
    const done = () => { exMsg.textContent = 'Copied ' + cues.length + ' cues.'; };
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { exMsg.textContent = 'Copy failed.'; }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  });

  $('ex-csv').addEventListener('click', () => {
    const d = new Date();
    const name = 'tc-cues-' + d.getFullYear() + TC.pad(d.getMonth() + 1) + TC.pad(d.getDate()) + '.csv';
    const url = URL.createObjectURL(new Blob([asCsv()], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // ---------- keep the screen awake ----------

  let wakeLock = null;
  async function keepAwake() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { /* low battery or unsupported: nothing to do */ }
  }
  document.addEventListener('visibilitychange', () => {
    // Do not treat time spent in the background as a clock jump.
    prevWall = Date.now();
    prevPerf = performance.now();
    keepAwake();
  });
  keepAwake();

  // ---------- offline ----------

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  renderCues();
  requestAnimationFrame(tick);
})();
