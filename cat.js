// The woometer cats: 21 different cartoon cats drawn as inline SVG, one per 5% of woo.
// Every cat is a happy cat. The low end are skeptics with books and magnifying glasses;
// the props get more mystical as the score climbs, ending in a cat wearing a UFO.
const Cat = (function () {
  const LINE = "#3b2a1e";
  const PINK = "#f28aa0";

  // Coat colours and patterns.
  const COATS = {
    grayTabby: { fur: "#a5adb8", stripe: "#6e7782", muzzle: "#eef0f3", pattern: "tabby" },
    tuxedo: { fur: "#2f2f36", muzzle: "#ffffff", pattern: "tux" },
    ginger: { fur: "#eda65c", stripe: "#c97a36", muzzle: "#f8dfbd", pattern: "tabby" },
    siamese: { fur: "#f1e3cc", point: "#6b4a35", muzzle: "#f8efe0", pattern: "points" },
    calico: { fur: "#fbf6ee", patchA: "#e8964a", patchB: "#3a3236", muzzle: "#ffffff", pattern: "calico" },
    white: { fur: "#fbfbf8", muzzle: "#ffffff", pattern: "plain", line: "#6b5a4e" },
    cream: { fur: "#f3d7a6", stripe: "#e2b979", muzzle: "#fbefd9", pattern: "tabby" },
    blue: { fur: "#8d9bb3", muzzle: "#b9c4d6", pattern: "plain" },
    brownTabby: { fur: "#a87a52", stripe: "#5e4029", muzzle: "#e9d3b8", pattern: "tabby" },
    bengal: { fur: "#e3b363", spot: "#6b4423", muzzle: "#f7e6c4", pattern: "spots" },
    black: { fur: "#26232b", muzzle: "#3a3640", pattern: "plain", line: "#0e0c10" },
    sphynx: { fur: "#efc3b4", muzzle: "#f7d8cd", pattern: "wrinkles", bigEars: true },
    mainecoon: { fur: "#8a6142", stripe: "#4f3626", muzzle: "#e6cfb4", pattern: "tabby" },
    abyssinian: { fur: "#c47a45", stripe: "#9a5528", muzzle: "#efcfa8", pattern: "ticked", bigEars: true },
    silverTabby: { fur: "#d4d8de", stripe: "#7d848e", muzzle: "#f3f4f6", pattern: "tabby" },
    lilac: { fur: "#c9b8cf", muzzle: "#e6dbe9", pattern: "plain" },
    cowcat: { fur: "#ffffff", patchB: "#2f2f36", muzzle: "#ffffff", pattern: "cow" },
  };

  // name, coat, eye colour, eye style, mouth, props
  const STAGES = [
    ["Professor Whiskers", "grayTabby", "#5aa0d8", "open", "smile", ["glasses", "bowtie", "book"]],
    ["Dr. Mittens", "tuxedo", "#8fd36a", "open", "smile", ["monocle", "bowtie"]],
    ["Fact-Checker Felix", "ginger", "#6bbf73", "open", "grin", ["magnifier"]],
    ["Stargazer", "siamese", "#4f8de0", "open", "smile", ["telescope"]],
    ["Library Cat", "calico", "#d9a43a", "happy", "smile", ["readers", "books"]],
    ["Curious Kitty", "white", "#55b0e8", "open", "open", ["cookie"]],
    ["Horoscope Reader", "cream", "#c98a3a", "open", "smile", ["zodiac"]],
    ["Lucky Cat", "white", "#e0a93a", "happy", "open", ["luckyCollar", "clover"]],
    ["Crystal Collector", "blue", "#e0b84a", "open", "smile", ["crystal"]],
    ["Tarot Tabby", "brownTabby", "#7bc46a", "open", "grin", ["tarot"]],
    ["Crystal Ball Gazer", "bengal", "#62b56b", "open", "smile", ["hoop", "crystalBall"]],
    ["Ouija Whisperer", "black", "#f2c94c", "open", "smile", ["planchette"]],
    ["Essential Oil Enthusiast", "cream", "#9a7bd8", "happy", "smile", ["flowerCrown", "oil"]],
    ["Third Eye Open", "sphynx", "#7ac3e8", "open", "smile", ["thirdEye", "mala"]],
    ["Wand Waver", "ginger", "#6bbf73", "open", "grin", ["scar", "roundGlasses", "scarf", "wand"]],
    ["Dungeon Master", "grayTabby", "#e07a5a", "open", "grin", ["d20"]],
    ["The Wizard", "mainecoon", "#e0b84a", "open", "smile", ["wizardHat", "staff"]],
    ["Pyramid Power", "abyssinian", "#8fc46a", "open", "open", ["pyramidHat"]],
    ["Tinfoil Tabby", "silverTabby", "#5aa0d8", "open", "grin", ["tinfoil"]],
    ["Alien Contactee", "lilac", "#7ad86a", "open", "open", ["antennae", "sparkles"]],
    ["UFO Pilot", "cowcat", "#5ac8e8", "open", "open", ["ufo", "sparkles"]],
  ];

  let drawn = 0;
  const f = (n) => Math.round(n * 10) / 10;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function stageFor(pct) {
    return clamp(Math.round(pct / 5), 0, 20);
  }

  // Soft halo behind each cat, sliding along the gauge colours from green to gold to purple.
  function haloColor(s) {
    const stops = [[0x3f, 0xb6, 0x8b], [0xe5, 0xc0, 0x4a], [0xc0, 0x4a, 0xd6]];
    const t = (s / 20) * 2;
    const i = Math.min(1, Math.floor(t));
    const k = t - i;
    const c = stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * k));
    return `rgb(${c.join(" ")})`;
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

  // A paw holding something at the lower right.
  const paw = (c) => `<ellipse cx="88" cy="104" rx="8" ry="6" fill="${c.fur}" stroke="${c.line || LINE}" stroke-width="2"/>`;

  // Props. Each returns [behindHead, onHead, inFront] SVG strings.
  const PROPS = {
    glasses: () => ["", `<g fill="rgb(200 230 255 / 25%)" stroke="#222" stroke-width="2.2"><circle cx="47" cy="58" r="10"/><circle cx="73" cy="58" r="10"/></g><path d="M57,57 q3,-3 6,0 M37,56 L29,52 M83,56 L91,52" fill="none" stroke="#222" stroke-width="2.2" stroke-linecap="round"/>`, ""],
    roundGlasses: () => ["", `<g fill="none" stroke="#222" stroke-width="2"><circle cx="47" cy="58" r="9.5"/><circle cx="73" cy="58" r="9.5"/><path d="M56.5,58 h7 M37.5,57 L29,54 M82.5,57 L91,54"/></g>`, ""],
    readers: () => ["", `<g fill="rgb(255 240 200 / 30%)" stroke="#b23a48" stroke-width="2"><rect x="38" y="57" width="18" height="10" rx="4"/><rect x="64" y="57" width="18" height="10" rx="4"/></g><path d="M56,61 q4,-3 8,0" fill="none" stroke="#b23a48" stroke-width="2"/>`, ""],
    monocle: () => ["", `<circle cx="73" cy="58" r="10" fill="rgb(200 230 255 / 25%)" stroke="#c9a227" stroke-width="2.4"/><path d="M82,63 q6,14 -2,28" fill="none" stroke="#c9a227" stroke-width="1.2" stroke-dasharray="2 1.5"/>`, ""],
    bowtie: () => ["", "", `<g stroke="${LINE}" stroke-width="1.6" stroke-linejoin="round"><polygon points="60,92 47,85 47,99" fill="#c0392b"/><polygon points="60,92 73,85 73,99" fill="#c0392b"/><rect x="56.5" y="88.5" width="7" height="7" rx="2" fill="#e05a4a"/></g>`],
    book: (c) => ["", "", `<g transform="rotate(-12 96 96)"><rect x="82" y="84" width="28" height="22" rx="2" fill="#2b6cb0" stroke="${LINE}" stroke-width="1.8"/><rect x="85" y="87" width="22" height="16" fill="#3d82cc"/><path d="M89,92 h14 M89,96 h10" stroke="#e5c04a" stroke-width="1.6"/></g>${paw(c)}`],
    books: (c) => ["", "", `<rect x="82" y="100" width="30" height="8" rx="1.5" fill="#3a9a6a" stroke="${LINE}" stroke-width="1.6"/><rect x="84" y="92" width="27" height="8" rx="1.5" fill="#c0392b" stroke="${LINE}" stroke-width="1.6"/><rect x="83" y="84" width="28" height="8" rx="1.5" fill="#2b6cb0" stroke="${LINE}" stroke-width="1.6"/><path d="M87,88 h12 M88,96 h14 M86,104 h10" stroke="#f5e9c8" stroke-width="1.4"/>`],
    magnifier: (c) => ["", "", `<path d="M90,104 L100,86" stroke="#7a4a24" stroke-width="5" stroke-linecap="round"/><circle cx="104" cy="77" r="11" fill="rgb(200 230 255 / 45%)" stroke="#555" stroke-width="3"/><path d="M98,72 q3,-4 8,-3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>${paw(c)}`],
    telescope: (c) => ["", "", `<g transform="rotate(-42 96 92)"><rect x="76" y="86" width="40" height="11" rx="3" fill="#2d3e66" stroke="${LINE}" stroke-width="1.8"/><rect x="112" y="84" width="7" height="15" rx="2" fill="#c9a227" stroke="${LINE}" stroke-width="1.6"/><rect x="88" y="86" width="4" height="11" fill="#c9a227"/></g>${star(108, 50, 5, "#e5c04a")}${paw(c)}`],
    cookie: (c) => ["", "", `<path d="M82,96 q14,-22 28,0 q-6,-5 -14,-1 q-8,-4 -14,1 z" fill="#e8b25e" stroke="${LINE}" stroke-width="1.8" stroke-linejoin="round"/><rect x="94" y="94" width="18" height="5" fill="#fff" stroke="#b9a" stroke-width="0.8" transform="rotate(12 103 96)"/>${paw(c)}`],
    zodiac: (c) => ["", "", `<g transform="rotate(10 98 88)"><rect x="86" y="70" width="24" height="34" rx="3" fill="#1f2a5a" stroke="#e5c04a" stroke-width="2"/><path d="M101,80 a7,7 0 1 0 0,12 a5.5,5.5 0 1 1 0,-12 z" fill="#f2d675"/>${star(94, 96, 3, "#fff")}${star(104, 76, 2, "#fff")}</g>${paw(c)}`],
    luckyCollar: () => ["", "", `<path d="M40,88 q20,10 40,0" fill="none" stroke="#d62d3a" stroke-width="5" stroke-linecap="round"/><circle cx="60" cy="98" r="5" fill="#f2c94c" stroke="${LINE}" stroke-width="1.4"/><path d="M57,98 h6 M60,98 v3" stroke="${LINE}" stroke-width="1.2"/>`],
    clover: (c) => ["", "", `<path d="M96,104 q2,-10 0,-18" stroke="#2f8f4a" stroke-width="2.4" fill="none"/><g fill="#3fb65a" stroke="#2f7a3f" stroke-width="1.2"><circle cx="91" cy="80" r="5.5"/><circle cx="101" cy="80" r="5.5"/><circle cx="91" cy="90" r="5.5"/><circle cx="101" cy="90" r="5.5"/></g>${paw(c)}`],
    crystal: (c) => ["", "", `<polygon points="98,66 108,80 104,100 92,100 88,80" fill="#b98cf0" stroke="#6b3fd6" stroke-width="1.8" stroke-linejoin="round"/><path d="M98,66 L98,100 M88,80 L108,80" stroke="#e6d6ff" stroke-width="1"/>${star(112, 66, 4, "#e6d6ff")}${paw(c)}`],
    tarot: (c) => ["", "", `<g transform="rotate(-10 98 88)"><rect x="85" y="68" width="26" height="38" rx="3" fill="#6b3fd6" stroke="#e5c04a" stroke-width="2"/><circle cx="98" cy="84" r="6" fill="#f2c94c"/><path d="M98,74 v-3 M98,94 v3 M88,84 h-2 M108,84 h2 M91,77 l-2,-2 M105,77 l2,-2 M91,91 l-2,2 M105,91 l2,2" stroke="#f2c94c" stroke-width="1.6"/><path d="M90,100 h16" stroke="#e5c04a" stroke-width="1.4"/></g>${paw(c)}`],
    crystalBall: (c) => ["", "", `<path d="M86,106 h24 l-4,-8 h-16 z" fill="#c9a227" stroke="${LINE}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="98" cy="86" r="14" fill="#c7b4f5" stroke="#6b3fd6" stroke-width="2"/><path d="M90,80 q4,-6 10,-5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>${star(102, 90, 3.5, "#fff")}`],
    hoop: () => ["", `<circle cx="34" cy="76" r="4" fill="none" stroke="#e5c04a" stroke-width="2"/>`, ""],
    planchette: (c) => ["", "", `<path d="M98,68 C110,72 114,90 106,102 L90,102 C82,90 86,72 98,68 z" fill="#d9a066" stroke="${LINE}" stroke-width="1.8" stroke-linejoin="round"/><circle cx="98" cy="82" r="5" fill="#f5e9c8" stroke="${LINE}" stroke-width="1.4"/><path d="M92,96 h12" stroke="#a8693a" stroke-width="1.4"/>${paw(c)}`],
    flowerCrown: () => ["", ["#f28aa0", "#f2c94c", "#9ad0f5", "#f28aa0", "#c7a4f5", "#f2c94c", "#9ad0f5"].map((col, i) => {
      const x = 32 + i * 9.3;
      const y = 40 - Math.sin((i / 6) * Math.PI) * 9;
      return `<circle cx="${f(x)}" cy="${f(y)}" r="4.6" fill="${col}" stroke="${LINE}" stroke-width="1"/><circle cx="${f(x)}" cy="${f(y)}" r="1.5" fill="#fff8d0"/>`;
    }).join(""), ""],
    oil: (c) => ["", "", `<rect x="90" y="82" width="16" height="22" rx="4" fill="#c97a2a" stroke="${LINE}" stroke-width="1.8" opacity="0.95"/><rect x="93" y="76" width="10" height="7" fill="#333"/><rect x="95" y="68" width="6" height="9" rx="3" fill="#1f1f1f"/><rect x="92" y="88" width="12" height="9" fill="#f5e9c8"/><path d="M95,92 q3,-3 6,0" stroke="#3fb65a" stroke-width="1.4" fill="none"/>${paw(c)}`],
    thirdEye: () => ["", `<ellipse cx="60" cy="42" rx="6" ry="3.6" fill="#fff" stroke="${LINE}" stroke-width="1.6"/><circle cx="60" cy="42" r="2.4" fill="#8b5cf6"/><circle cx="60" cy="42" r="1" fill="${LINE}"/><path d="M52,36 l2,2 M60,33.5 v2.5 M68,36 l-2,2" stroke="#8b5cf6" stroke-width="1.4" stroke-linecap="round"/>`, ""],
    mala: () => ["", "", Array.from({ length: 11 }, (_, i) => {
      const a = Math.PI * (0.15 + (i / 10) * 0.7);
      return `<circle cx="${f(60 - Math.cos(a) * 22)}" cy="${f(86 + Math.sin(a) * 12)}" r="2.6" fill="#8a5a3a" stroke="${LINE}" stroke-width="0.8"/>`;
    }).join("") + `<circle cx="60" cy="102" r="3" fill="#d62d3a"/>`],
    scar: () => ["", `<path d="M66,34 l-4,6 h4 l-4,6" fill="none" stroke="#b23a48" stroke-width="1.8" stroke-linejoin="round"/>`, ""],
    scarf: () => ["", "", `<path d="M38,86 q22,12 44,0 l0,7 q-22,12 -44,0 z" fill="#8b1e2b" stroke="${LINE}" stroke-width="1.6"/><path d="M46,90 v8 M54,92 v9 M66,92 v9 M74,90 v8" stroke="#e5b53a" stroke-width="3"/><rect x="42" y="94" width="9" height="20" fill="#8b1e2b" stroke="${LINE}" stroke-width="1.4"/><path d="M42,100 h9 M42,107 h9" stroke="#e5b53a" stroke-width="3"/>`],
    wand: (c) => ["", "", `<path d="M88,104 L108,66" stroke="#5a3a1e" stroke-width="3.4" stroke-linecap="round"/><path d="M90,100 L93,94" stroke="#3a2412" stroke-width="4.4" stroke-linecap="round"/>${star(110, 62, 6, "#f2c94c")}${star(102, 54, 3.5, "#fff3b0")}${star(116, 74, 3, "#fff3b0")}${paw(c)}`],
    d20: (c) => ["", "", `<polygon points="98,70 112,78 112,95 98,103 84,95 84,78" fill="#d62d3a" stroke="${LINE}" stroke-width="1.8" stroke-linejoin="round"/><polygon points="98,76 107,92 89,92" fill="#e85a5a" stroke="#7a1420" stroke-width="1.2" stroke-linejoin="round"/><path d="M98,70 L98,76 M84,78 L89,92 M112,78 L107,92 M84,95 L89,92 M112,95 L107,92 M98,103 L89,92 M98,103 L107,92" stroke="#7a1420" stroke-width="1"/><text x="98" y="89.5" text-anchor="middle" font-size="7" font-weight="700" font-family="system-ui, sans-serif" fill="#fff">20</text>${paw(c)}`],
    wizardHat: () => ["", `<path d="M30,40 q30,-10 60,0 q-30,8 -60,0 z" fill="#3b3fa8" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/><path d="M40,38 L66,0 Q70,-2 70,4 L80,38 z" fill="#4a4fc4" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/>${star(58, 26, 4, "#f2c94c")}${star(70, 14, 3, "#f2c94c")}<path d="M68,30 a3.5,3.5 0 1 0 3,5 a2.6,2.6 0 1 1 -3,-5 z" fill="#f2c94c"/>`, ""],
    staff: (c) => ["", "", `<path d="M92,116 L104,62" stroke="#7a4a24" stroke-width="4" stroke-linecap="round"/><circle cx="105" cy="57" r="6" fill="#7ad0f5" stroke="#2b6cb0" stroke-width="1.6"/><circle cx="103" cy="55" r="1.8" fill="#fff"/>${paw(c)}`],
    pyramidHat: () => ["", `<polygon points="36,40 60,4 84,40" fill="#e5b53a" stroke="#9a7420" stroke-width="2" stroke-linejoin="round"/><path d="M42,31 h36 M48,22 h24 M54,13 h12" stroke="#c99a2a" stroke-width="1.4"/><ellipse cx="60" cy="26" rx="6" ry="3.5" fill="#fff" stroke="${LINE}" stroke-width="1.2"/><circle cx="60" cy="26" r="2" fill="#2b6cb0"/>`, ""],
    tinfoil: () => ["", `<polygon points="38,40 58,2 82,38" fill="#cfd4dc" stroke="#7d8591" stroke-width="2" stroke-linejoin="round"/><path d="M50,30 l6,-4 l-2,6 l8,-3 M57,16 l4,3 l-5,2 M64,30 l6,-2 l-1,5" fill="none" stroke="#9aa2ad" stroke-width="1.2"/><path d="M36,40 q22,-8 48,-2" fill="none" stroke="#7d8591" stroke-width="3" stroke-linecap="round"/>`, ""],
    antennae: () => [`<path d="M48,36 q-6,-14 -12,-26 M72,36 q6,-14 12,-26" fill="none" stroke="${LINE}" stroke-width="2"/><circle cx="35" cy="9" r="5" fill="#7ad86a" stroke="${LINE}" stroke-width="1.6"/><circle cx="85" cy="9" r="5" fill="#7ad86a" stroke="${LINE}" stroke-width="1.6"/>`, `<path d="M38,38 q22,-10 44,0" fill="none" stroke="#7ad86a" stroke-width="4" stroke-linecap="round"/>`, ""],
    ufo: () => [`<polygon points="46,30 74,30 92,96 28,96" fill="#c4f5a8" opacity="0.35"/>`, `<ellipse cx="60" cy="18" rx="15" ry="13" fill="#bfe8ff" stroke="${LINE}" stroke-width="1.8" opacity="0.95"/><ellipse cx="60" cy="18" rx="5" ry="6" fill="#7ad86a"/><circle cx="58" cy="17" r="1.4" fill="#111"/><circle cx="62.5" cy="17" r="1.4" fill="#111"/><ellipse cx="60" cy="31" rx="34" ry="9" fill="#9aa2ad" stroke="${LINE}" stroke-width="2"/><ellipse cx="60" cy="28" rx="26" ry="4" fill="#c9ced6"/>${["#f2c94c", "#f28aa0", "#7ad86a", "#7ad0f5", "#f2c94c"].map((col, i) => `<circle cx="${34 + i * 13}" cy="${f(33 + Math.sin((i / 4) * Math.PI) * 2.5)}" r="2.4" fill="${col}" stroke="${LINE}" stroke-width="0.8"/>`).join("")}`, ""],
    sparkles: () => [star(12, 24, 6, "#e5c04a") + star(108, 46, 5, "#c04ad6") + star(14, 96, 4.5, "#c04ad6") + star(112, 14, 3.5, "#e5c04a"), "", ""],
  };

  function coatMarkings(c) {
    let o = "";
    switch (c.pattern) {
      case "tabby":
      case "ticked":
        o += `<path d="M54,34 v6 M60,33 v7 M66,34 v6" stroke="${c.stripe}" stroke-width="2.4" stroke-linecap="round"/>`;
        if (c.pattern === "tabby") {
          o += `<path d="M29,56 h8 M30,63 h7 M91,56 h-8 M90,63 h-7" stroke="${c.stripe}" stroke-width="2.2" stroke-linecap="round"/>`;
        }
        break;
      case "points":
        o += `<ellipse cx="60" cy="66" rx="21" ry="17" fill="${c.point}" opacity="0.55" clip-path="url(#${c.clip})"/>`;
        break;
      case "calico":
        o += `<g clip-path="url(#${c.clip})"><ellipse cx="40" cy="42" rx="16" ry="12" fill="${c.patchA}"/><ellipse cx="82" cy="46" rx="14" ry="11" fill="${c.patchB}"/></g>`;
        break;
      case "cow":
        o += `<g clip-path="url(#${c.clip})"><ellipse cx="38" cy="50" rx="14" ry="18" fill="${c.patchB}"/><ellipse cx="80" cy="38" rx="12" ry="8" fill="${c.patchB}"/></g>`;
        break;
      case "spots":
        for (const [x, y, r] of [[42, 42, 3], [52, 36, 2.4], [70, 37, 2.6], [79, 44, 3], [34, 56, 2.4], [86, 58, 2.4]]) {
          o += `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${f(r * 0.8)}" fill="none" stroke="${c.spot}" stroke-width="1.6"/>`;
        }
        break;
      case "wrinkles":
        o += `<path d="M50,40 q10,-4 20,0 M53,45 q7,-3 14,0" fill="none" stroke="#c99688" stroke-width="1.4" stroke-linecap="round"/>`;
        break;
    }
    return o;
  }

  function ears(c) {
    const line = c.line || LINE;
    const inner = c.pattern === "points" ? c.point : PINK;
    const outer = c.pattern === "points" ? c.point : c.fur;
    const l = c.bigEars ? "28,52 28,12 54,36" : "31,50 35,20 54,37";
    const r = c.bigEars ? "92,52 92,12 66,36" : "89,50 85,20 66,37";
    const li = c.bigEars ? "33,44 33,22 47,37" : "36,44 38,28 48,38";
    const ri = c.bigEars ? "87,44 87,22 73,37" : "84,44 82,28 72,38";
    let o = `<polygon points="${l}" fill="${outer}" stroke="${line}" stroke-width="2.2" stroke-linejoin="round"/><polygon points="${li}" fill="${inner}" opacity="0.7"/>`;
    o += `<polygon points="${r}" fill="${c.pattern === "calico" ? c.patchB : outer}" stroke="${line}" stroke-width="2.2" stroke-linejoin="round"/><polygon points="${ri}" fill="${inner}" opacity="0.7"/>`;
    return o;
  }

  function eyes(style, iris, c) {
    const line = c.line || LINE;
    if (style === "happy") {
      return `<path d="M40,60 q7,-8 14,0 M66,60 q7,-8 14,0" fill="none" stroke="${line}" stroke-width="2.6" stroke-linecap="round"/>`;
    }
    let o = "";
    for (const x of [47, 73]) {
      o += `<ellipse cx="${x}" cy="58" rx="7" ry="7.5" fill="#fff" stroke="${line}" stroke-width="2"/>`;
      o += `<circle cx="${x}" cy="59" r="5" fill="${iris}"/>`;
      o += `<ellipse cx="${x}" cy="59" rx="2" ry="3.4" fill="#1a1414"/>`;
      o += `<circle cx="${x + 2}" cy="56" r="1.6" fill="#fff"/>`;
    }
    return o;
  }

  function mouth(style, c) {
    const line = c.line || LINE;
    let m = `<path d="M57,65 h6 l-3,3.5 z" fill="${PINK}" stroke="${line}" stroke-width="1.4" stroke-linejoin="round"/>`;
    if (style === "smile") {
      m += `<path d="M60,68.5 v2.5 M60,71 q-4,4 -8,0 M60,71 q4,4 8,0" fill="none" stroke="${line}" stroke-width="1.8" stroke-linecap="round"/>`;
    } else if (style === "grin") {
      m += `<path d="M60,68.5 v2 M52,71 q8,9 16,0 z" fill="${line}" stroke="${line}" stroke-width="1.6" stroke-linejoin="round"/>`;
      m += `<path d="M56,75 q4,2.5 8,0 q-4,-2.5 -8,0" fill="${PINK}"/>`;
    } else {
      // Open, delighted.
      m += `<path d="M60,68.5 v2 M53,71 q7,12 14,0 z" fill="${line}" stroke="${line}" stroke-width="1.6" stroke-linejoin="round"/>`;
      m += `<ellipse cx="60" cy="76" rx="4" ry="2.6" fill="${PINK}"/>`;
    }
    return m;
  }

  function whiskers(c) {
    const col = c.fur === "#26232b" || c.fur === "#2f2f36" ? "#d8d8de" : c.line || LINE;
    return `<path d="M47,67 L23,63 M47,70 L22,71 M47,73 L24,79 M73,67 L97,63 M73,70 L98,71 M73,73 L96,79" fill="none" stroke="${col}" stroke-width="1.2" stroke-linecap="round"/>`;
  }

  function svg(stage) {
    const s = clamp(stage | 0, 0, 20);
    const [, coatKey, iris, eyeStyle, mouthStyle, props] = STAGES[s];
    // Each drawing gets its own clip id, since several cats can be on the page at once.
    const c = { ...COATS[coatKey], clip: `cat-head-clip-${++drawn}` };
    const line = c.line || LINE;
    const parts = props.map((p) => PROPS[p](c));
    const layer = (i) => parts.map((p) => p[i]).join("");

    let o = `<defs><clipPath id="${c.clip}"><ellipse cx="60" cy="60" rx="32" ry="28"/></clipPath></defs>`;
    o += `<circle cx="60" cy="62" r="54" fill="${haloColor(s)}" opacity="0.16"/>`;
    o += layer(0);

    // Shoulders and chest.
    o += `<ellipse cx="60" cy="116" rx="38" ry="28" fill="${c.fur}" stroke="${line}" stroke-width="2.2"/>`;
    o += `<ellipse cx="60" cy="110" rx="16" ry="20" fill="${c.muzzle}"/>`;
    if (c.pattern === "cow") o += `<ellipse cx="82" cy="112" rx="10" ry="12" fill="${c.patchB}"/>`;

    o += ears(c);
    o += `<ellipse cx="60" cy="60" rx="32" ry="28" fill="${c.fur}" stroke="${line}" stroke-width="2.4"/>`;
    o += coatMarkings(c);
    o += `<ellipse cx="60" cy="71" rx="15" ry="9" fill="${c.muzzle}"/>`;
    o += `<ellipse cx="40" cy="70" rx="5" ry="3" fill="${PINK}" opacity="0.35"/><ellipse cx="80" cy="70" rx="5" ry="3" fill="${PINK}" opacity="0.35"/>`;
    o += whiskers(c);
    o += eyes(eyeStyle, iris, c);
    o += mouth(mouthStyle, c);
    o += layer(1);
    o += layer(2);

    return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${o}</svg>`;
  }

  return { svg, stageFor, name: (stage) => STAGES[clamp(stage | 0, 0, 20)][0] };
})();
