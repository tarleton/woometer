// Little synthesized sound effects, made with the Web Audio API so there are
// no audio files to host or license.
//   Sounds.trash() - a bright, pleasant two-note chime
//   Sounds.woo()   - a low, slightly ominous descending boop
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

  function setMuted(value) {
    muted = value;
    try {
      localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // Ignore: see above.
    }
  }

  return { trash, woo, setMuted, isMuted: () => muted };
})();
