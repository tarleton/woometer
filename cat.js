// The Woometer cat: one cartoon cat drawn as inline SVG, in 21 stages (one per 5%).
// Stage 0 is a dapper professor in glasses and a tie; every stage after that loses a
// little dignity, until stage 20 is a tinfoil-hatted furball with spiral eyes.
const Cat = (function () {
  const NAMES = [
    "Professor Whiskers, PhD",
    "Dr. Mittens",
    "Fact-Checker Felix",
    "Skeptical Tabby",
    "Library Cat",
    "Curious Kitty",
    "Tie Loosened",
    "Read One Horoscope",
    "Lost the Glasses",
    "Crystal-Curious",
    "Half-Baked Tom",
    "Blames Mercury",
    "Essential Oil Enthusiast",
    "Healing Crystal Wearer",
    "Did Their Own Research",
    "Moon Phase Mouser",
    "Third Eye Wide Open",
    "Tinfoil Tabby",
    "Vibes Only",
    "Cosmic Kitty",
    "Full Woo Furball",
  ];

  const FUR = "#eda65c";
  const FUR_DARK = "#c97a36";
  const LINE = "#4a2e17";
  const CREAM = "#f8dfbd";
  const PINK = "#f28aa0";

  // Where fur tufts sprout around the head, in the order they appear (degrees, 0 = right).
  const TUFT_ANGLES = [-70, -110, -30, -150, 10, 170, -90, 35, 145, -50, -130, 60, 120, -10, -170, 85];
  // Where dirt smudges show up on the face.
  const SMUDGES = [[41, 44, 3], [79, 76, 2.5], [70, 42, 2], [36, 70, 2.2], [56, 48, 1.6]];

  const f = (n) => Math.round(n * 10) / 10;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function stageFor(pct) {
    return clamp(Math.round(pct / 5), 0, 20);
  }

  // A point on the head outline (ellipse centred at 60,60), scaled outward by k.
  function onHead(deg, k) {
    const a = (deg * Math.PI) / 180;
    return [60 + Math.cos(a) * 32 * k, 60 + Math.sin(a) * 28 * k];
  }

  function tuft(deg, len) {
    const [x1, y1] = onHead(deg - 9, 0.9);
    const [x2, y2] = onHead(deg + 9, 0.9);
    const [tx, ty] = onHead(deg + 4, len);
    return `<polygon points="${f(x1)},${f(y1)} ${f(tx)},${f(ty)} ${f(x2)},${f(y2)}" fill="${FUR}" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/>`;
  }

  function spiral(cx, cy, r, dir) {
    let d = "";
    const turns = 2.6;
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * turns * 2 * Math.PI;
      const rr = (i / steps) * r;
      const x = cx + Math.cos(th * dir) * rr;
      const y = cy + Math.sin(th * dir) * rr;
      d += `${i ? "L" : "M"}${f(x)},${f(y)}`;
    }
    return `<path d="${d}" fill="none" stroke="${LINE}" stroke-width="1.4" stroke-linecap="round"/>`;
  }

  function star(cx, cy, r, color) {
    const p = [];
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const rr = i % 2 ? r * 0.38 : r;
      p.push(`${f(cx + Math.cos(a) * rr)},${f(cy + Math.sin(a) * rr)}`);
    }
    return `<polygon points="${p.join(" ")}" fill="${color}"/>`;
  }

  function eyes(s) {
    let out = "";
    // Eye whites get a little lopsided as things go downhill.
    const lr = 7;
    const rr = s < 6 ? 7 : clamp(7 + (s - 5) * 0.35, 7, 9.5);
    const L = [47, 58];
    const R = [73, 58];
    out += `<ellipse cx="${L[0]}" cy="${L[1]}" rx="${lr}" ry="${f(lr * 1.05)}" fill="#fff" stroke="${LINE}" stroke-width="2"/>`;
    out += `<ellipse cx="${R[0]}" cy="${R[1]}" rx="${f(rr)}" ry="${f(rr * 1.05)}" fill="#fff" stroke="${LINE}" stroke-width="2"/>`;

    if (s >= 16) {
      out += spiral(L[0], L[1], lr - 1.5, 1);
      out += spiral(R[0], R[1], rr - 1.5, -1);
      return out;
    }

    let lp, rp;
    if (s <= 5) {
      // Focused, a touch upward: the thinking look.
      lp = [L[0] + 0.5, L[1] + 1];
      rp = [R[0] - 0.5, R[1] + 1];
    } else if (s <= 10) {
      // Starting to wander.
      const k = s - 5;
      lp = [L[0] - k * 0.6, L[1] - k * 0.5];
      rp = [R[0] + k * 0.7, R[1] + k * 0.4];
    } else {
      // Cross-eyed, staring at the nose.
      lp = [L[0] + 3.2, L[1] + 2.5];
      rp = [R[0] - 3.5, R[1] + 3];
    }
    const pr = s <= 10 ? 2.6 : 2;
    out += `<ellipse cx="${f(lp[0])}" cy="${f(lp[1])}" rx="${pr}" ry="${f(pr * 1.5)}" fill="${LINE}"/>`;
    out += `<ellipse cx="${f(rp[0])}" cy="${f(rp[1])}" rx="${pr}" ry="${f(pr * 1.5)}" fill="${LINE}"/>`;
    out += `<circle cx="${f(lp[0] + 0.8)}" cy="${f(lp[1] - 1.4)}" r="0.9" fill="#fff"/>`;
    out += `<circle cx="${f(rp[0] + 0.8)}" cy="${f(rp[1] - 1.4)}" r="0.9" fill="#fff"/>`;

    if (s <= 3) {
      // Smug, half-closed lids.
      out += `<path d="M${L[0] - lr},${L[1]} a${lr},${lr} 0 0 1 ${lr * 2},0 z" fill="${FUR}" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/>`;
      out += `<path d="M${R[0] - 7},${R[1]} a7,7 0 0 1 14,0 z" fill="${FUR}" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/>`;
    }
    return out;
  }

  function brows(s) {
    if (s <= 4) {
      // Thoughtful, slightly furrowed.
      return `<path d="M40,46 L53,48 M80,46 L67,48" stroke="${LINE}" stroke-width="2.4" stroke-linecap="round"/>`;
    }
    if (s >= 11 && s <= 15) {
      // Raised and uneven: baffled.
      return `<path d="M40,46 q6,-6 13,-2 M68,43 q6,-7 13,0" fill="none" stroke="${LINE}" stroke-width="2.2" stroke-linecap="round"/>`;
    }
    return "";
  }

  function glasses(s) {
    if (s >= 8) return "";
    const rot = s < 4 ? 0 : (s - 3) * 5;
    const dy = s < 6 ? 0 : (s - 5) * 2.5;
    let g = `<g transform="translate(0 ${dy}) rotate(${rot} 60 58)">`;
    g += `<circle cx="47" cy="58" r="10" fill="rgb(200 230 255 / 25%)" stroke="#222" stroke-width="2.2"/>`;
    g += `<circle cx="73" cy="58" r="10" fill="rgb(200 230 255 / 25%)" stroke="#222" stroke-width="2.2"/>`;
    g += `<path d="M57,57 q3,-3 6,0 M37,56 L29,52 M83,56 L91,52" fill="none" stroke="#222" stroke-width="2.2" stroke-linecap="round"/>`;
    if (s >= 6) g += `<path d="M66,52 l4,4 l-2,3 l5,4 l-1,3" fill="none" stroke="#222" stroke-width="1.2"/>`;
    return g + "</g>";
  }

  function mouth(s) {
    let m = `<path d="M57,65 h6 l-3,3.5 z" fill="${PINK}" stroke="${LINE}" stroke-width="1.4" stroke-linejoin="round"/>`;
    if (s <= 4) {
      // Neat little cat smile with a confident smirk.
      m += `<path d="M60,68.5 v2.5 M60,71 q-4,4 -8,1 M60,71 q4,3.5 9,-0.5" fill="none" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round"/>`;
    } else if (s <= 9) {
      m += `<path d="M60,68.5 v2" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round"/>`;
      m += `<ellipse cx="60" cy="74.5" rx="3.2" ry="${f(2 + (s - 5) * 0.4)}" fill="${LINE}"/>`;
    } else {
      // Big goofy grin with a buck tooth.
      m += `<path d="M49,71 q11,13 22,0 z" fill="${LINE}" stroke="${LINE}" stroke-width="1.6" stroke-linejoin="round"/>`;
      m += `<rect x="57.5" y="71" width="4" height="3.5" fill="#fff"/>`;
      if (s >= 15) {
        m += `<path d="M60,75 q-1,10 5,10 q6,0 4,-11 z" fill="${PINK}" stroke="${LINE}" stroke-width="1.4" stroke-linejoin="round"/>`;
        m += `<path d="M65,77 v5" stroke="#d0607a" stroke-width="1"/>`;
      }
      if (s >= 18) {
        m += `<path d="M51,74 q-1,7 0,9 a2,2 0 1 0 2,-1 q-1,-4 -2,-8" fill="#9fd3f5" stroke="#4f9ac9" stroke-width="0.8"/>`;
      }
    }
    return m;
  }

  function whiskers(s) {
    const bend = (s / 20) * 9;
    const rows = [[-3, -6], [0, 0], [3, 6]];
    let d = "";
    rows.forEach(([y0, spread], i) => {
      // One whisker per side breaks off once things get really bad.
      if (s >= 13 && i === 2) return;
      const wob = i % 2 ? bend : -bend;
      d += `M47,${70 + y0} Q34,${f(70 + y0 + spread / 2 + wob)} 22,${70 + y0 + spread}`;
      d += `M73,${70 + y0} Q86,${f(70 + y0 + spread / 2 - wob)} 98,${70 + y0 + spread}`;
    });
    return `<path d="${d}" fill="none" stroke="${LINE}" stroke-width="1.2" stroke-linecap="round"/>`;
  }

  function ears(s) {
    const droopR = s < 8 ? 0 : Math.min(75, (s - 7) * 7);
    const droopL = s < 15 ? 0 : Math.min(35, (s - 14) * 6);
    const ear = (pts, inner, rot, px, py) =>
      `<g transform="rotate(${rot} ${px} ${py})"><polygon points="${pts}" fill="${FUR}" stroke="${LINE}" stroke-width="2.2" stroke-linejoin="round"/><polygon points="${inner}" fill="${PINK}" opacity="0.7"/></g>`;
    return (
      ear("31,50 35,20 54,37", "36,44 38,28 48,38", -droopL, 40, 42) +
      ear("89,50 85,20 66,37", "84,44 82,28 72,38", droopR, 80, 42)
    );
  }

  function tie(s) {
    if (s >= 13) {
      // The tie is gone; a "healing" crystal has taken its place.
      return (
        `<path d="M44,96 Q60,112 76,96" fill="none" stroke="#8a6d3b" stroke-width="1.4"/>` +
        `<polygon points="60,103 65,109 60,121 55,109" fill="#b98cf0" stroke="#6b3fd6" stroke-width="1.4" stroke-linejoin="round"/>` +
        `<path d="M60,103 v18 M55,109 h10" stroke="#e6d6ff" stroke-width="0.8"/>`
      );
    }
    let out = "";
    if (s <= 6) {
      out += `<polygon points="46,94 60,103 54,90" fill="#fff" stroke="${LINE}" stroke-width="1.6" stroke-linejoin="round"/>`;
      out += `<polygon points="74,94 60,103 66,90" fill="#fff" stroke="${LINE}" stroke-width="1.6" stroke-linejoin="round"/>`;
    }
    const rot = s <= 2 ? 0 : (s - 2) * 4.5;
    const dy = s <= 4 ? 0 : (s - 4) * 1.2;
    out += `<g transform="translate(0 ${f(dy)}) rotate(${f(rot)} 60 101)">`;
    out += `<polygon points="56,99 64,99 62.5,105 57.5,105" fill="#2b4c9b" stroke="${LINE}" stroke-width="1.4" stroke-linejoin="round"/>`;
    out += `<polygon points="57.5,105 62.5,105 67,124 60,131 53,124" fill="#2b4c9b" stroke="${LINE}" stroke-width="1.4" stroke-linejoin="round"/>`;
    out += `<path d="M56,111 l8,-3 M55,118 l10,-4 M55,125 l10,-4" stroke="#e5c04a" stroke-width="1.6"/>`;
    return out + "</g>";
  }

  function hat() {
    return (
      `<polygon points="40,40 58,2 80,38" fill="#cfd4dc" stroke="#7d8591" stroke-width="2" stroke-linejoin="round"/>` +
      `<path d="M50,30 l6,-4 l-2,6 l8,-3 M57,16 l4,3 l-5,2 M64,30 l6,-2 l-1,5" fill="none" stroke="#9aa2ad" stroke-width="1.2"/>` +
      `<path d="M38,40 q22,-8 44,-2" fill="none" stroke="#7d8591" stroke-width="3" stroke-linecap="round"/>`
    );
  }

  function svg(stage) {
    const s = clamp(stage | 0, 0, 20);
    const tilt = s <= 4 ? 0 : (s - 4) * 0.9;
    const tufts = s <= 2 ? 0 : Math.round(((s - 2) * TUFT_ANGLES.length) / 18);
    let o = "";

    if (s >= 19) {
      o += star(12, 22, 6, "#e5c04a") + star(106, 30, 5, "#c04ad6") + star(104, 96, 4, "#e5c04a") + star(16, 98, 4.5, "#c04ad6");
    }

    // Shoulders, then neckwear, tucked up under the chin.
    o += `<g transform="translate(0 -12)">`;
    o += `<ellipse cx="60" cy="128" rx="38" ry="28" fill="${FUR}" stroke="${LINE}" stroke-width="2.2"/>`;
    o += `<ellipse cx="60" cy="122" rx="16" ry="20" fill="${CREAM}"/>`;
    o += tie(s);
    o += "</g>";

    // Head, tilting as the woo sets in.
    o += `<g transform="rotate(${f(tilt)} 60 70)">`;
    o += ears(s);
    for (let i = 0; i < tufts; i++) o += tuft(TUFT_ANGLES[i], 1.18 + (i % 3) * 0.07);
    o += `<ellipse cx="60" cy="60" rx="32" ry="28" fill="${FUR}" stroke="${LINE}" stroke-width="2.4"/>`;
    o += `<path d="M54,34 v6 M60,33 v7 M66,34 v6" stroke="${FUR_DARK}" stroke-width="2.4" stroke-linecap="round"/>`;
    if (s <= 3) {
      // A tidy side part.
      o += `<path d="M42,40 q10,-8 26,-6" fill="none" stroke="${FUR_DARK}" stroke-width="2" stroke-linecap="round"/>`;
    }
    const smudges = s < 10 ? 0 : Math.min(SMUDGES.length, s - 9);
    for (let i = 0; i < smudges; i++) {
      const [x, y, r] = SMUDGES[i];
      o += `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${f(r * 0.7)}" fill="#7a5130" opacity="0.45"/>`;
    }
    o += `<ellipse cx="60" cy="71" rx="15" ry="9" fill="${CREAM}"/>`;
    o += whiskers(s);
    o += eyes(s);
    o += brows(s);
    o += mouth(s);
    o += glasses(s);
    if (s >= 17) o += hat();
    o += "</g>";

    if (s >= 20) {
      // A couple of flies have moved in.
      o += `<path d="M88,14 q10,-8 14,2 q4,10 -8,8" fill="none" stroke="${LINE}" stroke-width="0.8" stroke-dasharray="2 2"/>`;
      o += `<circle cx="94" cy="22" r="2" fill="#222"/><ellipse cx="93" cy="19.5" rx="2" ry="1.2" fill="#bcd" opacity="0.8"/>`;
      o += `<circle cx="22" cy="44" r="1.8" fill="#222"/><ellipse cx="23" cy="41.7" rx="1.8" ry="1.1" fill="#bcd" opacity="0.8"/>`;
    }

    return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${o}</svg>`;
  }

  return { svg, stageFor, name: (stage) => NAMES[clamp(stage | 0, 0, 20)] };
})();
