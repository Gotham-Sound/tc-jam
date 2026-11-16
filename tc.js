// Timecode math. No DOM in here so it can be unit tested in Node.
(function (root) {
  'use strict';

  // nominal = frames counted per timecode second
  // real    = frames that actually go by per real second
  const RATES = {
    '23.976': { label: '23.976', nominal: 24, real: 24000 / 1001, df: false },
    '24':     { label: '24',     nominal: 24, real: 24,           df: false },
    '25':     { label: '25',     nominal: 25, real: 25,           df: false },
    '29.97':  { label: '29.97 NDF', nominal: 30, real: 30000 / 1001, df: false },
    '29.97df':{ label: '29.97 DF',  nominal: 30, real: 30000 / 1001, df: true },
    '30':     { label: '30',     nominal: 30, real: 30,           df: false },
  };

  // Object key order would put the whole-number rates first, so list it explicitly.
  const RATE_ORDER = ['23.976', '24', '25', '29.97', '29.97df', '30'];

  const DF_PER_10MIN = 17982; // frames in 10 minutes of 29.97 drop-frame
  const DF_PER_MIN = 1798;    // frames in a dropped minute

  function dayFrames(rateKey) {
    const r = RATES[rateKey];
    return r.df ? DF_PER_10MIN * 6 * 24 : r.nominal * 86400;
  }

  function mod(n, m) {
    return ((n % m) + m) % m;
  }

  // {h,m,s,f} -> frame count since 00:00:00:00
  function tcToFrames(tc, rateKey) {
    const r = RATES[rateKey];
    let f = Math.min(tc.f || 0, r.nominal - 1);
    const totalMin = tc.h * 60 + tc.m;
    if (r.df) {
      // Frames 00 and 01 do not exist at the top of a dropped minute.
      if (tc.s === 0 && f < 2 && tc.m % 10 !== 0) f = 2;
      const n = r.nominal * (totalMin * 60 + tc.s) + f;
      return mod(n - 2 * (totalMin - Math.floor(totalMin / 10)), dayFrames(rateKey));
    }
    return mod(r.nominal * (totalMin * 60 + tc.s) + f, dayFrames(rateKey));
  }

  // frame count -> {h,m,s,f}
  function framesToTc(frames, rateKey) {
    const r = RATES[rateKey];
    let n = mod(Math.floor(frames), dayFrames(rateKey));
    if (r.df) {
      const d = Math.floor(n / DF_PER_10MIN);
      const m = n % DF_PER_10MIN;
      n += 18 * d;
      if (m >= 2) n += 2 * Math.floor((m - 2) / DF_PER_MIN);
    }
    const f = n % r.nominal;
    const secs = Math.floor(n / r.nominal);
    return {
      h: Math.floor(secs / 3600) % 24,
      m: Math.floor(secs / 60) % 60,
      s: secs % 60,
      f: f,
    };
  }

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function formatTc(tc, rateKey) {
    const sep = RATES[rateKey].df ? ';' : ':';
    return pad(tc.h) + ':' + pad(tc.m) + ':' + pad(tc.s) + sep + pad(tc.f);
  }

  // jam = { rate, f0, wall }: timecode was frame f0 at wall-clock ms `wall`.
  function framesAt(jam, nowMs) {
    const r = RATES[jam.rate];
    const elapsed = ((nowMs - jam.wall) / 1000) * r.real;
    return mod(jam.f0 + Math.floor(elapsed), dayFrames(jam.rate));
  }

  // Keep the same HH:MM:SS:FF reading at the jam instant, run at a new rate.
  function rerate(jam, newRate) {
    const tc = framesToTc(jam.f0, jam.rate);
    tc.f = Math.min(tc.f, RATES[newRate].nominal - 1);
    return { rate: newRate, f0: tcToFrames(tc, newRate), wall: jam.wall };
  }

  const api = { RATES, RATE_ORDER, dayFrames, tcToFrames, framesToTc, formatTc, framesAt, rerate, pad };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TC = api;
})(typeof self !== 'undefined' ? self : this);
