// Camera jam: read a timecode counter through the camera and work out the
// offset between it and this phone's clock. See solveOffset in tc.js.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const panel = $('cam-panel');
  const stage = $('cam-stage');
  const video = $('cam-video');
  const box = $('cam-box');
  const msg = $('cam-msg');
  const out = $('cam-tc');
  const useBtn = $('cam-use');

  // Size of the crop handed to the reader. Digits end up roughly 60 px tall.
  const CW = 504;
  const CH = 120;
  const WINDOW_S = 6;      // only trust readings from the last few seconds
  const CAM_LATENCY = 80;  // ms, used when the browser cannot tell us capture time

  const canvas = document.createElement('canvas');
  canvas.width = CW;
  canvas.height = CH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const testSrc = new URLSearchParams(location.search).get('testvideo');

  let workerPromise = null;
  let worker = null;
  let stream = null;
  let running = false;
  let busy = false;
  let t0 = 0;            // wall ms when this session started
  let readings = [];     // [{ t: seconds since t0, s: second of day }]
  let solution = null;   // locked { offset, ... }
  let lastText = '';

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('could not load ' + src));
      document.head.appendChild(s);
    });
  }

  function getWorker() {
    if (!workerPromise) {
      workerPromise = (async () => {
        const base = new URL('vendor/tesseract/', location.href).href;
        if (!window.Tesseract) await loadScript(base + 'tesseract.min.js');
        const w = await window.Tesseract.createWorker('eng', 1, {
          workerPath: base + 'worker.min.js',
          corePath: base + 'core',
          langPath: base + 'lang',
          gzip: true,
        });
        await w.setParameters({
          tessedit_char_whitelist: '0123456789:;.',
          tessedit_pageseg_mode: '7', // one line of text
        });
        return w;
      })();
      workerPromise.catch(() => { workerPromise = null; });
    }
    return workerPromise;
  }

  // Copy the part of the video under the guide box into the canvas, then make
  // it dark text on a light background with the contrast stretched.
  function grab() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return false;
    // The video element is shown with object-fit: cover and may be scaled up
    // by the zoom buttons; its bounding box includes that scaling.
    const sr = video.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const scale = Math.max(sr.width / vw, sr.height / vh);
    const ox = (sr.width - vw * scale) / 2;
    const oy = (sr.height - vh * scale) / 2;
    ctx.drawImage(
      video,
      (br.left - sr.left - ox) / scale, (br.top - sr.top - oy) / scale,
      br.width / scale, br.height / scale,
      0, 0, CW, CH
    );

    const img = ctx.getImageData(0, 0, CW, CH);
    const d = img.data;
    const hist = new Uint32Array(256);
    const n = CW * CH;
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      d[i] = g;
      hist[g]++;
    }
    let lo = 0, hi = 255, med = 0, acc = 0;
    for (let v = 0, seenLo = false, seenMed = false; v < 256; v++) {
      acc += hist[v];
      if (!seenLo && acc >= n * 0.02) { lo = v; seenLo = true; }
      if (!seenMed && acc >= n * 0.5) { med = v; seenMed = true; }
      if (acc >= n * 0.98) { hi = v; break; }
    }
    if (hi - lo < 30) return false; // nothing but a flat surface in the box
    const invert = med < (lo + hi) / 2; // mostly dark: lit digits on black
    const k = 255 / (hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      let g = (d[i] - lo) * k;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      if (invert) g = 255 - g;
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(img, 0, 0);
    return true;
  }

  function locked(r) {
    return r && r.agree >= 6 && r.agree / r.total >= 0.6 &&
      r.width <= 0.4 && r.span >= 1.5 && r.distinct >= 2;
  }

  async function readFrame(wall) {
    busy = true;
    try {
      if (!grab()) return;
      const res = await worker.recognize(canvas);
      if (!running) return;
      const tc = TC.parseReading(res.data.text);
      if (!tc) return;
      lastText = TC.pad(tc.h) + ':' + TC.pad(tc.m) + ':' + TC.pad(tc.s);
      const t = (wall - t0) / 1000;
      readings.push({ t: t, s: tc.h * 3600 + tc.m * 60 + tc.s });
      readings = readings.filter((r) => r.t > t - WINDOW_S);
      const r = TC.solveOffset(readings);
      if (locked(r)) solution = r;
    } catch (e) {
      // A single failed frame does not matter; the next one will be tried.
    } finally {
      busy = false;
    }
  }

  function onFrame(now, meta) {
    if (!running) return;
    schedule();
    if (busy || !worker || video.readyState < 2) return;
    // When was this picture taken, on the performance.now() timeline?
    let ts;
    if (meta && meta.captureTime) ts = meta.captureTime;
    else if (stream) ts = (now || performance.now()) - CAM_LATENCY;
    else ts = now || performance.now();
    readFrame(Date.now() - (performance.now() - ts));
  }

  function schedule() {
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(onFrame);
    else requestAnimationFrame((now) => onFrame(now, null));
  }

  // Timecode, in seconds of day, that the solution says applies right now.
  function tcSecondsNow(wall) {
    const s = solution.offset + (wall - t0) / 1000;
    return ((s % 86400) + 86400) % 86400;
  }

  function jamFromSolution() {
    const wall = Date.now();
    const sec = tcSecondsNow(wall);
    const whole = Math.floor(sec);
    const rate = window.TCApp.rate();
    const tc = {
      h: Math.floor(whole / 3600),
      m: Math.floor(whole / 60) % 60,
      s: whole % 60,
      f: Math.floor((sec - whole) * TC.RATES[rate].nominal),
    };
    return { rate: rate, f0: TC.tcToFrames(tc, rate), wall: wall };
  }

  function paint() {
    if (!running) return;
    if (solution) {
      const j = jamFromSolution();
      out.textContent = TC.formatTc(TC.framesToTc(j.f0, j.rate), j.rate);
      out.classList.remove('dim');
      box.classList.add('locked');
      useBtn.disabled = false;
      msg.textContent = 'Locked. If this matches the counter, use it.';
    } else if (lastText) {
      msg.textContent = 'Reading ' + lastText + ' … hold steady';
    }
    requestAnimationFrame(paint);
  }

  async function start() {
    panel.hidden = false;
    running = true;
    busy = false;
    readings = [];
    solution = null;
    lastText = '';
    t0 = Date.now();
    out.textContent = '--:--:--:--';
    out.classList.add('dim');
    box.classList.remove('locked');
    useBtn.disabled = true;
    msg.textContent = 'Starting camera…';

    const loading = getWorker();
    try {
      if (testSrc) {
        worker = await loading; // have the reader ready before the clip plays
        video.src = testSrc;
      } else {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('no camera support');
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (!running) { stop(); return; }
        video.srcObject = stream;
      }
      await video.play();
    } catch (e) {
      msg.textContent = stream || testSrc
        ? 'Could not start the camera view.'
        : 'No camera access. Allow the camera for this page, or jam by hand.';
      return;
    }

    msg.textContent = 'Loading the reader…';
    try {
      worker = await loading;
    } catch (e) {
      msg.textContent = 'Could not load the reader. Check the connection and try again.';
      return;
    }
    if (!running) return;
    msg.textContent = 'Fill the box with the counter and hold steady.';
    schedule();
    requestAnimationFrame(paint);
  }

  function stop() {
    running = false;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    video.pause();
    video.srcObject = null;
    if (testSrc) video.removeAttribute('src');
    panel.hidden = true;
  }

  function setZoom(z) {
    video.style.transform = 'scale(' + z + ')';
    document.querySelectorAll('[data-zoom]').forEach((b) => {
      b.classList.toggle('on', +b.dataset.zoom === z);
    });
    // Old readings are still valid: zoom changes the picture, not the time.
  }
  document.querySelectorAll('[data-zoom]').forEach((b) => {
    b.addEventListener('click', () => setZoom(+b.dataset.zoom));
  });

  $('jam-cam').addEventListener('click', start);
  $('cam-close').addEventListener('click', stop);
  useBtn.addEventListener('click', () => {
    if (!solution) return;
    window.TCApp.setJam(jamFromSolution());
    stop();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' && running) stop();
  });

  // For tests and troubleshooting from the console.
  window.TCCam = {
    canvas: canvas,
    state: () => ({
      running: running,
      readings: readings.length,
      solution: solution,
      tcSeconds: solution ? tcSecondsNow(Date.now()) : null,
    }),
  };
})();
