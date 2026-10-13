// A quiet easter egg: every claim you answer (Yes, No or Don't Know) adds one
// tiny star to a sky behind the top bar. Stars gather into faint
// constellations that drift slowly sideways. Past 100 answers a soft galaxy
// glow fades in and stars start to twinkle, more of them the more you answer.
// Each star's place comes from its claim's id, so the sky is the same on every
// page and every reload. Nothing here is labelled; it's there to be noticed.
// The footer gets a second, mirrored sky: the same stars, scattered
// differently and drifting the other way.
function paintSky(host, variant) {
  const STORAGE_KEY = "woometer.answers.v1";
  const GROUPS = 24; // constellations the stars gather into
  const DRIFT = 2.5; // pixels per second
  const FRAME_MS = 50; // about 20 frames a second is plenty for this pace

  const header = host;
  const SEED = variant.seed;
  const DIR = variant.dir;
  const canvas = document.createElement("canvas");
  canvas.className = "sky";
  canvas.setAttribute("aria-hidden", "true");
  header.prepend(canvas);
  const ctx = canvas.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)");

  // A small, stable hash so a claim id always lands on the same spot.
  function hash(text, seed) {
    let h = 2166136261 ^ (seed + SEED);
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    }
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  const groupCentres = Array.from({ length: GROUPS }, (_, g) => ({
    x: (g + 0.15 + hash("g" + g, 1) * 0.7) / GROUPS,
    y: 0.2 + hash("g" + g, 2) * 0.6,
  }));

  function starFor(id) {
    const g = groupCentres[Math.floor(hash(id, 3) * GROUPS)];
    const angle = hash(id, 4) * Math.PI * 2;
    const reach = Math.sqrt(hash(id, 5));
    return {
      id,
      group: g,
      // x is a fraction of the sky's width; y a fraction of the bar's height.
      x: (g.x + Math.cos(angle) * reach * 0.03 + 1) % 1,
      y: Math.min(0.92, Math.max(0.08, g.y + Math.sin(angle) * reach * 0.32)),
      size: 0.5 + hash(id, 6) * 0.7,
      glow: 0.3 + hash(id, 7) * 0.3,
      phase: hash(id, 8) * Math.PI * 2,
      twinkleRank: hash(id, 9),
      born: 0,
    };
  }

  let stars = [];
  let lines = [];

  // The /woo playground can show a pretend set of answers instead (its slider).
  let previewIds = null;
  function readIds() {
    if (previewIds) return previewIds;
    try {
      return Object.keys(JSON.parse(localStorage.getItem(STORAGE_KEY)) || {});
    } catch {
      return [];
    }
  }

  function refresh(fadeNew) {
    const ids = readIds();
    const old = new Map(stars.map((s) => [s.id, s]));
    stars = ids.map((id) => old.get(id) || Object.assign(starFor(id), { born: fadeNew && !still.matches ? performance.now() : 0 }));
    // Constellation lines: within each group, join every star to its nearest
    // earlier neighbour, in a fixed order so the shape only ever grows.
    lines = [];
    const byGroup = new Map();
    for (const s of [...stars].sort((a, b) => a.twinkleRank - b.twinkleRank)) {
      const placed = byGroup.get(s.group) || [];
      let best = null;
      let bestDist = Infinity;
      for (const p of placed) {
        const d = Math.hypot((p.x - s.x) * 8, p.y - s.y);
        if (d < bestDist) { best = p; bestDist = d; }
      }
      if (best) lines.push([best, s]);
      placed.push(s);
      byGroup.set(s.group, placed);
    }
    draw(performance.now());
  }

  let width = 0;
  let height = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = header.clientWidth;
    height = header.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(performance.now());
  }

  function draw(now) {
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    const count = stars.length;
    if (!count) return;
    const moving = !still.matches;
    // The sky is at least 1000px wide so phones see a slice of it drifting by.
    const skyWidth = Math.max(width, 1000);
    // Drift by the wall clock, so the sky carries on where it was on the next page.
    const shift = moving ? DIR * (Date.now() / 1000) * DRIFT : 0;
    const px = (s) => (((s.x * skyWidth + shift) % skyWidth) + skyWidth) % skyWidth;

    // Galaxy glow: fades in between 100 and 250 answers.
    const glow = Math.min(1, Math.max(0, (count - 100) / 150));
    if (glow > 0) {
      const gx = (((0.62 * skyWidth + shift * 0.6) % skyWidth) + skyWidth) % skyWidth;
      for (const x of [gx, gx - skyWidth, gx + skyWidth]) {
        if (x < -400 || x > width + 400) continue;
        ctx.save();
        ctx.translate(x, height * 0.5);
        ctx.scale(1, 0.32);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 260);
        g.addColorStop(0, `rgba(196, 160, 255, ${0.11 * glow})`);
        g.addColorStop(0.45, `rgba(150, 110, 220, ${0.05 * glow})`);
        g.addColorStop(1, "rgba(120, 80, 200, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(-260, -260, 520, 520);
        ctx.restore();
      }
    }

    // Faint constellation lines, skipped where a line would wrap around the edge.
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = "rgba(200, 190, 255, 0.07)";
    ctx.beginPath();
    for (const [a, b] of lines) {
      const ax = px(a);
      const bx = px(b);
      if (Math.abs(ax - bx) > 80) continue;
      ctx.moveTo(ax, a.y * height);
      ctx.lineTo(bx, b.y * height);
    }
    ctx.stroke();

    // Twinkling starts at 100 answers and spreads to more stars as you go on.
    const twinkleShare = count < 100 ? 0 : Math.min(0.6, 0.1 + (count - 100) / 500);
    for (const s of stars) {
      const x = px(s);
      if (x < -4 || x > width + 4) continue;
      let alpha = s.glow;
      if (s.twinkleRank < twinkleShare) {
        const t = moving ? now / 1000 : 0;
        alpha *= 0.55 + 0.45 * Math.sin(t * (0.6 + s.twinkleRank * 2) + s.phase);
      }
      if (s.born) {
        // A brand new star glows a little brighter, then settles over 3 seconds.
        const age = (now - s.born) / 3000;
        if (age < 1) alpha = Math.min(1, alpha + 0.5 * (1 - age));
        else s.born = 0;
      }
      ctx.fillStyle = `rgba(255, 246, 220, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, s.y * height, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Once every claim is answered, a tiny shooting star now and then: it
  // slants across the bar from top to bottom with sparkles trailing off it,
  // every two to four minutes. Header only, never with reduced motion.
  const TOTAL_KEY = "woometer.claimCount.v1";
  if (typeof CLAIMS !== "undefined") {
    try { localStorage.setItem(TOTAL_KEY, String(CLAIMS.length)); } catch {}
  }
  function finished() {
    let total = typeof CLAIMS !== "undefined" ? CLAIMS.length : 0;
    if (!total) {
      try { total = Number(localStorage.getItem(TOTAL_KEY)) || 0; } catch {}
    }
    return total > 0 && stars.length >= total;
  }
  let meteor = null;
  let sparks = [];
  let nextMeteor = 0;
  function planMeteor(soon) {
    nextMeteor = performance.now() + (soon ? 1500 : 120000 + Math.random() * 120000);
  }
  function launchMeteor(now) {
    // Enters at the top edge and slants down to leave at the bottom, from
    // either side, at a steady medium pace.
    const dir = Math.random() < 0.5 ? 1 : -1;
    const angle = 0.35 + Math.random() * 0.25; // radians below level
    const speed = 160; // pixels per second
    meteor = {
      x: width * (dir > 0 ? 0.1 + Math.random() * 0.5 : 0.4 + Math.random() * 0.5),
      y: -6,
      vx: dir * Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      last: now,
    };
  }
  function drawMeteor(now) {
    if (meteor) {
      const dt = Math.min(0.05, (now - meteor.last) / 1000);
      meteor.last = now;
      meteor.x += meteor.vx * dt;
      meteor.y += meteor.vy * dt;
      // A few sparkles shed behind the head each frame.
      for (let i = 0; i < 2; i++) {
        if (Math.random() < 0.7) {
          sparks.push({
            x: meteor.x - meteor.vx * 0.02 * Math.random(),
            y: meteor.y - meteor.vy * 0.02 * Math.random(),
            vx: (Math.random() - 0.5) * 14 - meteor.vx * 0.05,
            vy: (Math.random() - 0.2) * 12,
            born: now,
            life: 500 + Math.random() * 700,
            size: 0.5 + Math.random() * 0.9,
          });
        }
      }
      // The tail: a short streak fading back along the path.
      const len = 0.16; // seconds of travel the tail covers
      const tx = meteor.x - meteor.vx * len;
      const ty = meteor.y - meteor.vy * len;
      const tail = ctx.createLinearGradient(meteor.x, meteor.y, tx, ty);
      tail.addColorStop(0, "rgba(255, 250, 235, 0.85)");
      tail.addColorStop(0.3, "rgba(220, 200, 255, 0.35)");
      tail.addColorStop(1, "rgba(200, 180, 255, 0)");
      ctx.strokeStyle = tail;
      ctx.lineWidth = 1.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(meteor.x, meteor.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      const glow = ctx.createRadialGradient(meteor.x, meteor.y, 0, meteor.x, meteor.y, 5);
      glow.addColorStop(0, "rgba(255, 252, 240, 0.95)");
      glow.addColorStop(1, "rgba(255, 240, 220, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(meteor.x - 5, meteor.y - 5, 10, 10);
      if (meteor.y - meteor.vy * len > height + 4 || meteor.x < -60 || meteor.x > width + 60) meteor = null;
    }
    // Sparkles drift, twinkle and fade.
    sparks = sparks.filter((p) => now - p.born < p.life);
    for (const p of sparks) {
      const age = (now - p.born) / p.life;
      const dt = 1 / 60;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const a = (1 - age) * (0.55 + 0.45 * Math.sin(now / 45 + p.size * 20));
      ctx.fillStyle = `rgba(255, 244, 225, ${a})`;
      const r = p.size * (1 - age * 0.5);
      ctx.fillRect(p.x - r, p.y - 0.25, r * 2, 0.5);
      ctx.fillRect(p.x - 0.25, p.y - r, 0.5, r * 2);
    }
  }
  const meteors = variant.meteors;

  let timer = null;
  function tick() {
    timer = null;
    const now = performance.now();
    if (meteors && !meteor && finished() && now >= nextMeteor) {
      if (nextMeteor) launchMeteor(now);
      planMeteor(false);
    }
    draw(now);
    if (meteor || sparks.length) drawMeteor(now);
    schedule();
  }
  function schedule() {
    if (timer || still.matches || document.hidden || !stars.length) return;
    // Every frame while a shooting star is out, otherwise a calm 20 a second.
    if (meteor || sparks.length) timer = requestAnimationFrame(tick);
    else timer = setTimeout(() => requestAnimationFrame(tick), FRAME_MS);
  }

  new ResizeObserver(resize).observe(header);
  window.addEventListener("woometer:answers", () => {
    const was = finished();
    refresh(true);
    // Answering the very last claim sends the first one over straight away.
    if (meteors && !was && finished()) planMeteor(true);
    schedule();
  });
  window.addEventListener("woometer:sky-preview", (e) => {
    const was = finished();
    previewIds = e.detail.ids;
    refresh(false);
    // On the /woo playground, sliding to 100% sends one over right away.
    if (meteors && !was && finished()) planMeteor(true);
    schedule();
  });
  window.addEventListener("storage", (e) => { if (e.key === STORAGE_KEY) { refresh(false); schedule(); } });
  document.addEventListener("visibilitychange", schedule);
  still.addEventListener?.("change", () => { draw(performance.now()); schedule(); });
  refresh(false);
  resize();
  schedule();
}

{
  const header = document.querySelector("header.top");
  if (header) paintSky(header, { seed: 0, dir: 1, meteors: true });
  const footer = document.querySelector("footer.foot");
  if (footer) paintSky(footer, { seed: 7919, dir: -1 });
  // The footer is at least as tall as the header, however the header wraps.
  if (header && footer) {
    new ResizeObserver(() => (footer.style.minHeight = `${header.getBoundingClientRect().height}px`)).observe(header);
  }
}
