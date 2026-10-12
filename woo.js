// woometer.com/woo: a slow psychedelic "mind expanse" field to experiment on.
// Rainbow sacred-geometry rings are born at the centre and drift outward as if
// you were gliding through them; soft light ribbons swirl out between them and
// a glow breathes at the heart. Everything is added light ("lighter"), kept dim
// and slow. With reduced motion it shows one still frame.
(() => {
  const canvas = document.getElementById("field");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const TAU = Math.PI * 2;

  // How much of the field is revealed, 0 to 1: your real share of claims
  // answered, until the header slider pretends otherwise. The header's stars
  // follow the slider too.
  let reveal = 0;
  let ready = false;
  const slider = document.getElementById("reveal");
  const readout = document.getElementById("reveal-out");
  try {
    const saved = JSON.parse(localStorage.getItem("woometer.answers.v1")) || {};
    const ids = new Set(CLAIMS.map((c) => c.id));
    reveal = Object.keys(saved).filter((id) => ids.has(id)).length / CLAIMS.length;
  } catch {
    // No saved answers: start from nothing.
  }
  function setReveal(pct, fromSlider) {
    reveal = pct / 100;
    readout.textContent = `${pct % 1 ? pct.toFixed(1) : pct}%`;
    if (!fromSlider) slider.value = pct;
    if (fromSlider) {
      const n = Math.round(reveal * CLAIMS.length);
      window.dispatchEvent(new CustomEvent("woometer:sky-preview", { detail: { ids: CLAIMS.slice(0, n).map((c) => c.id) } }));
    }
    if (still.matches && ready) draw(20000);
  }
  setReveal(Math.round(reveal * 200) / 2, false);
  slider.addEventListener("input", () => setReveal(Number(slider.value), true));

  let w = 0;
  let h = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (still.matches) draw(20000);
  }

  // Each ring is one of a few sacred-geometry figures, so the tunnel varies.
  function polygon(r, sides, turn) {
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const a = turn + (i / sides) * TAU;
      ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.stroke();
  }
  function petals(r, n, turn) {
    // A flower of life ring: n circles whose edges pass through the centre line.
    for (let i = 0; i < n; i++) {
      const a = turn + (i / n) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.5, 0, TAU);
      ctx.stroke();
    }
  }
  function star(r, turn) {
    polygon(r, 3, turn);
    polygon(r, 3, turn + Math.PI);
  }
  const FIGURES = [
    (r, t) => { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); },
    (r, t) => polygon(r, 6, t),
    (r, t) => petals(r, 6, t),
    (r, t) => star(r, t),
    (r, t) => polygon(r, 12, t),
    (r, t) => petals(r, 8, -t),
  ];

  const RING_EVERY = 1.6; // seconds between rings
  const RING_LIFE = 14; // seconds from the centre to past the edge

  // Ribbons: thin curling arcs of light that spiral outward.
  const ribbons = Array.from({ length: 26 }, (_, i) => ({
    angle: (i / 26) * TAU,
    speed: 0.05 + ((i * 37) % 11) / 200,
    curl: ((i * 53) % 7) / 7 - 0.5,
    hue: (i * 360) / 26,
    offset: ((i * 71) % 13) / 13,
  }));
  // Spread them out, so the first few to appear aren't all on one side.
  ribbons.sort((a, b) => ((Math.round(a.angle / TAU * 26) * 11) % 26) - ((Math.round(b.angle / TAU * 26) * 11) % 26));

  function draw(ms) {
    if (!w || !h) return;
    const t = ms / 1000;
    const cx = w / 2;
    const cy = h / 2;
    const reach = Math.hypot(w, h) * 0.6;

    // Fade the last frame a little instead of clearing: soft light trails.
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(13, 10, 20, 0.22)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";

    // The breathing glow at the heart.
    const breath = 0.5 + 0.5 * Math.sin(t * TAU / 7);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach * (0.06 + 0.32 * reveal));
    glow.addColorStop(0, `hsla(${(t * 6) % 360}, ${40 + 50 * reveal}%, 70%, ${(0.03 + 0.07 * breath) * (0.3 + reveal)})`);
    glow.addColorStop(1, "hsla(270, 80%, 40%, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.02);

    // Rings, oldest (largest) first. Depth grows exponentially, like flying in.
    const newest = Math.floor(t / RING_EVERY);
    const count = Math.ceil(RING_LIFE / RING_EVERY);
    for (let k = newest - count; k <= newest; k++) {
      const age = t - k * RING_EVERY;
      if (age < 0 || age > RING_LIFE) continue;
      const p = age / RING_LIFE;
      const r = reach * (Math.exp(p * 4) - 1) / (Math.exp(4) - 1);
      if (r < 2) continue;
      // Rings grow brighter, and reach further out, as more is revealed.
      if (p > 0.25 + 0.75 * reveal) continue;
      const fade = Math.min(1, p * 6) * (1 - p) ** 1.5 * reveal ** 0.7;
      if (fade <= 0.002) continue;
      const hue = (k * 29 + t * 8) % 360;
      ctx.lineWidth = 0.6 + p * 2.2;
      ctx.strokeStyle = `hsla(${hue}, 95%, 65%, ${0.28 * fade})`;
      ctx.shadowColor = `hsla(${hue}, 100%, 60%, ${0.6 * fade})`;
      ctx.shadowBlur = 6 + p * 14;
      // More kinds of figure join in as the reveal grows: circles first, then
      // hexagons, flowers, stars and the rest.
      const kinds = 1 + Math.floor(reveal * (FIGURES.length - 1) + 0.0001);
      FIGURES[((k % kinds) + kinds) % kinds](r, k * 0.4 + t * 0.03 * (k % 2 ? 1 : -1));
    }
    ctx.shadowBlur = 0;

    // Ribbons: each draws a short glowing arc that travels outward and curls.
    // Ribbons join one by one as the reveal grows.
    for (const rb of ribbons.slice(0, Math.round(ribbons.length * reveal))) {
      const p = (t * rb.speed + rb.offset) % 1;
      const r0 = reach * p * p;
      const r1 = r0 + 30 + 80 * p;
      const a0 = rb.angle + rb.curl * p * 3 + t * 0.03;
      const a1 = a0 + rb.curl * 0.6;
      const fade = Math.sin(p * Math.PI);
      const hue = (rb.hue + t * 10) % 360;
      ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${0.18 * fade})`;
      ctx.lineWidth = 1 + 2 * p;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
      ctx.quadraticCurveTo(
        Math.cos((a0 + a1) / 2 + 0.3 * rb.curl) * (r0 + r1) / 2,
        Math.sin((a0 + a1) / 2 + 0.3 * rb.curl) * (r0 + r1) / 2,
        Math.cos(a1) * r1,
        Math.sin(a1) * r1
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  let start = null;
  let running = false;
  function frame(now) {
    if (start === null) start = now;
    draw(now - start + 20000); // begin mid-flight so the tunnel is already full
    if (!still.matches && !document.hidden) requestAnimationFrame(frame);
    else running = false;
  }
  function run() {
    if (running || still.matches || document.hidden) return;
    running = true;
    requestAnimationFrame(frame);
  }

  ready = true;
  new ResizeObserver(resize).observe(canvas);
  document.addEventListener("visibilitychange", run);
  resize();
  if (still.matches) draw(20000);
  run();
})();
