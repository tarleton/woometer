// Little synthesized sound effects, made with the Web Audio API so there are
// no audio files to host or license.
//   Sounds.trash() - a bright, pleasant two-note chime
//   Sounds.woo()   - a low, slightly ominous descending boop
//   Sounds.unsure() - a soft, questioning "hm?" that rises at the end
//   Sounds.forward() - a quiet rising tick when opening another page
//   Sounds.back()    - the same tick falling, when heading back to the main page
//   Sounds.meow()    - a very soft little meow for tapping the cat
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
  const forward = () => tick(784, 1046.5);
  const back = () => tick(1046.5, 784);

  // A sawtooth voice through a sweeping band-pass filter, so it opens like "mi"
  // and closes like "ow". Kept very quiet.
  function meow() {
    const ac = !muted && audio();
    if (!ac) return;
    const t = ac.currentTime;
    const len = 0.5;
    const osc = ac.createOscillator();
    const filter = ac.createBiquadFilter();
    const gain = ac.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.linearRampToValueAtTime(760, t + 0.16);
    osc.frequency.exponentialRampToValueAtTime(430, t + len);
    filter.type = "bandpass";
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.linearRampToValueAtTime(2200, t + 0.14);
    filter.frequency.exponentialRampToValueAtTime(700, t + len);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.06);
    gain.gain.setValueAtTime(0.2, t + 0.25);
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

  return { trash, woo, unsure, forward, back, meow, setMuted, isMuted: () => muted };
})();
