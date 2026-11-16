const TC = require('./tc.js');
const assert = require('assert');
const tc = (h, m, s, f) => ({ h, m, s, f });
const fmt = (frames, rate) => TC.formatTc(TC.framesToTc(frames, rate), rate);

// Round trip every rate across a day (sampled) and exhaustively over an hour.
for (const rate of Object.keys(TC.RATES)) {
  const day = TC.dayFrames(rate);
  for (let n = 0; n < day; n += n < 120000 ? 1 : 997) {
    assert.strictEqual(TC.tcToFrames(TC.framesToTc(n, rate), rate), n, rate + ' ' + n);
  }
}

// Drop-frame landmarks.
assert.strictEqual(fmt(1799, '29.97df'), '00:00:59;29');
assert.strictEqual(fmt(1800, '29.97df'), '00:01:00;02');
assert.strictEqual(fmt(17981, '29.97df'), '00:09:59;29');
assert.strictEqual(fmt(17982, '29.97df'), '00:10:00;00');
assert.strictEqual(fmt(107892, '29.97df'), '01:00:00;00');
assert.strictEqual(TC.tcToFrames(tc(0, 1, 0, 0), '29.97df'), 1800); // nonexistent frame snaps to ;02
assert.strictEqual(fmt(TC.dayFrames('29.97df') - 1, '29.97df'), '23:59:59;29');

// One real hour after a jam at 10:00:00:00.
const hour = 3600 * 1000;
const at = (rate) => {
  const jam = { rate, f0: TC.tcToFrames(tc(10, 0, 0, 0), rate), wall: 0 };
  return fmt(TC.framesAt(jam, hour), rate);
};
assert.strictEqual(at('24'), '11:00:00:00');
assert.strictEqual(at('25'), '11:00:00:00');
assert.strictEqual(at('30'), '11:00:00:00');
assert.strictEqual(at('23.976'), '10:59:56:09'); // 3.6 s behind real time
assert.strictEqual(at('29.97'), '10:59:56:12');
assert.strictEqual(at('29.97df'), '11:00:00;00'); // DF tracks real time

// Midnight wrap.
const j = { rate: '25', f0: TC.tcToFrames(tc(23, 59, 59, 0), '25'), wall: 0 };
assert.strictEqual(fmt(TC.framesAt(j, 2000), '25'), '00:00:01:00');

// Changing rate keeps the reading at the jam instant.
const r = TC.rerate({ rate: '30', f0: TC.tcToFrames(tc(1, 2, 3, 29), '30'), wall: 5 }, '24');
assert.strictEqual(fmt(r.f0, '24'), '01:02:03:23');
assert.strictEqual(r.wall, 5);

console.log('all timecode tests passed');
