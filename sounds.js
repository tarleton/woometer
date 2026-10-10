// Little synthesized sound effects, made with the Web Audio API so there are
// no audio files to host or license.
//   Sounds.trash() - a bright, pleasant two-note chime
//   Sounds.woo()   - a low, slightly ominous descending boop
//   Sounds.unsure() - a soft, questioning "hm?" that rises at the end
//   Sounds.open()    - a soft little pop when opening an answered claim from a list
//   Sounds.forward() - a quiet rising tick when opening another page
//   Sounds.back()    - the same tick falling, when heading back to the main page
//   Sounds.meow()    - a very soft little meow for tapping the cat, one of 21 at random
const Sounds = (function () {
  const STORAGE_KEY = "woometer.muted";
  let ctx = null;
  let muted = false;
  try {
    muted = localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Storage blocked: sound stays on and the choice isn't remembered.
  }

  // Browsers only allow audio after a user gesture, so the context is created
  // lazily on the first click.
  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // One enveloped oscillator note. `glideTo` bends the pitch over the note.
  function note(ac, { type = "sine", freq, glideTo, start, length, volume, out }) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + length);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain).connect(out);
    osc.start(start);
    osc.stop(start + length + 0.05);
  }

  function trash() {
    const ac = !muted && audio();
    if (!ac) return;
    const t = ac.currentTime;
    const out = ac.destination;
    // A rising major sixth (C6 then A6), with a quiet octave shimmer on top.
    note(ac, { freq: 1046.5, start: t, length: 0.35, volume: 0.18, out });
    note(ac, { freq: 1760, start: t + 0.09, length: 0.5, volume: 0.16, out });
    note(ac, { freq: 3520, start: t + 0.09, length: 0.3, volume: 0.03, out });
  }

  function woo() {
    const ac = !muted && audio();
    if (!ac) return;
    const t = ac.currentTime;
    // Low-pass filter takes the edge off the triangle waves for a muffled "boop".
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    filter.connect(ac.destination);
    // Two slightly detuned notes sliding down a tritone: a little uneasy.
    note(ac, { type: "triangle", freq: 220, glideTo: 155.6, start: t, length: 0.55, volume: 0.32, out: filter });
    note(ac, { type: "triangle", freq: 233.1, glideTo: 164.8, start: t, length: 0.55, volume: 0.18, out: filter });
    note(ac, { freq: 110, glideTo: 77.8, start: t + 0.02, length: 0.6, volume: 0.25, out: filter });
  }

  function unsure() {
    const ac = !muted && audio();
    if (!ac) return;
    const t = ac.currentTime;
    const out = ac.destination;
    // Two gentle notes, the second bending upward like a shrug.
    note(ac, { freq: 587.3, start: t, length: 0.16, volume: 0.12, out });
    note(ac, { freq: 659.3, glideTo: 830.6, start: t + 0.12, length: 0.32, volume: 0.12, out });
  }

  // Page-turn ticks: two quick, quiet sine blips, up for forward, down for back.
  function tick(first, second) {
    const ac = !muted && audio();
    if (!ac) return;
    const t = ac.currentTime;
    const out = ac.destination;
    note(ac, { freq: first, start: t, length: 0.09, volume: 0.06, out });
    note(ac, { freq: second, start: t + 0.055, length: 0.13, volume: 0.06, out });
  }
  // A gentle "pop": one quick upward-gliding blip with a faint sparkle on top.
  function open() {
    const ac = !muted && audio();
    if (!ac) return;
    const t = ac.currentTime;
    const out = ac.destination;
    note(ac, { freq: 520, glideTo: 880, start: t, length: 0.12, volume: 0.08, out });
    note(ac, { freq: 1760, start: t + 0.05, length: 0.1, volume: 0.015, out });
  }

  const forward = () => tick(784, 1046.5);
  const back = () => tick(1046.5, 784);

  // Meows: a sawtooth voice through a sweeping band-pass filter, so each one
  // opens like "mi" and closes like "ow". Twenty small cute ones and one silly
  // low one; tapping the cat picks one at random, never the same twice running.
  //   [start Hz, peak Hz, end Hz, length s, filter peak Hz, trill Hz (0 = none)]
  const MEOWS = [
    [520, 760, 430, 0.5, 2200, 0],
    [700, 980, 560, 0.32, 2600, 0],
    [820, 1100, 700, 0.22, 2900, 0],
    [600, 900, 820, 0.28, 2500, 0],
    [480, 680, 380, 0.6, 2000, 0],
    [900, 1250, 760, 0.18, 3100, 0],
    [640, 860, 500, 0.4, 2400, 0],
    [560, 820, 600, 0.35, 2300, 18],
    [750, 1050, 900, 0.25, 2800, 0],
    [500, 720, 460, 0.45, 2100, 22],
    [680, 940, 520, 0.3, 2600, 0],
    [860, 1180, 980, 0.2, 3000, 0],
    [620, 780, 420, 0.55, 2200, 0],
    [740, 1020, 640, 0.34, 2700, 26],
    [580, 840, 700, 0.26, 2400, 0],
    [960, 1300, 840, 0.16, 3200, 0],
    [540, 760, 520, 0.42, 2150, 0],
    [660, 920, 600, 0.3, 2550, 20],
    [800, 1080, 620, 0.28, 2850, 0],
    [600, 880, 460, 0.38, 2350, 0],
    // The silly one: low, long and a bit wobbly.
    [190, 260, 140, 0.9, 900, 9],
  ];
  let lastMeow = -1;

  function meow() {
    const ac = !muted && audio();
    if (!ac) return;
    let i;
    do i = Math.floor(Math.random() * MEOWS.length);
    while (i === lastMeow);
    lastMeow = i;
    const [f0, fPeak, fEnd, len, bright, trill] = MEOWS[i];
    const t = ac.currentTime;
    const rise = len * 0.32;
    const osc = ac.createOscillator();
    const filter = ac.createBiquadFilter();
    const gain = ac.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.linearRampToValueAtTime(fPeak, t + rise);
    osc.frequency.exponentialRampToValueAtTime(fEnd, t + len);
    if (trill) {
      // A little purring wobble in the pitch.
      const lfo = ac.createOscillator();
      const depth = ac.createGain();
      lfo.frequency.value = trill;
      depth.gain.value = f0 * 0.06;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + len + 0.05);
    }
    filter.type = "bandpass";
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(bright * 0.65, t);
    filter.frequency.linearRampToValueAtTime(bright, t + rise * 0.9);
    filter.frequency.exponentialRampToValueAtTime(Math.max(300, bright * 0.32), t + len);
    // The low silly meow needs more push to be heard through the filter.
    const volume = f0 < 300 ? 0.26 : 0.2;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + Math.min(0.06, len * 0.25));
    gain.gain.setValueAtTime(volume, t + len * 0.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(filter).connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + len + 0.05);
  }

  // Links between woometer's pages get a tick. The sound has to start while the
  // click is still being handled (phones block audio on a page that has just
  // loaded), so the page change waits a moment for the tick to be heard.
  const SUBPAGE = /\/(about|privacy|terms|stats)(\.html)?$/;
  function navSoundFor(link) {
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return null;
    if (url.pathname === location.pathname && url.search === location.search) return null;
    if (SUBPAGE.test(url.pathname)) return forward;
    if (/\/(index\.html)?$/.test(url.pathname)) return back;
    return null;
  }
  document.addEventListener("click", (e) => {
    if (muted || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest && e.target.closest("a[href]");
    if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
    const play = navSoundFor(link);
    if (!play) return;
    play();
    e.preventDefault();
    setTimeout(() => location.assign(link.href), 140);
  });

  function setMuted(value) {
    muted = value;
    try {
      localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // Ignore: see above.
    }
  }

  return { trash, woo, unsure, open, forward, back, meow, setMuted, isMuted: () => muted };
})();
