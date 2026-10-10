// The /stats page: totals across everyone, from the site_stats function in
// supabase/schema.sql. Only totals ever reach the browser, never who answered
// what. If Supabase isn't set up or that function hasn't been added yet, the
// page says the numbers aren't ready instead of breaking.
(function () {
  const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js";
  const STORAGE_KEY = "woometer.answers.v1";
  const LIST_SIZE = 10;

  const cfg = window.WOOMETER_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const byId = Object.fromEntries(CLAIMS.map((c) => [c.id, c]));
  const pct = (x) => `${Math.round(x * 100)}%`;

  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    notReady();
    return;
  }

  loadScript(SUPABASE_JS)
    .then(async () => {
      const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      // The map has its own function; if it isn't in the database yet, the
      // map just stays hidden.
      db.rpc("map_stats").then(({ data, error }) => {
        if (error) console.warn("woometer: map isn't available.", error);
        else renderMap(data);
      });
      const { data, error } = await db.rpc("site_stats");
      if (error) throw error;
      render(data);
    })
    .catch((err) => {
      console.warn("woometer: stats aren't available.", err);
      notReady();
    });

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.append(s);
    });
  }

  function notReady() {
    $("stats-status").textContent = "The stats aren't ready yet. Please check back soon.";
  }

  // This browser's own score, worked out the same way as on the main page.
  function yourScore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      const values = Object.entries(saved).filter(([id]) => byId[id]).map(([, v]) => v);
      const yes = values.filter((v) => v === "yes").length;
      const decided = yes + values.filter((v) => v === "no").length;
      return decided ? yes / decided : null;
    } catch {
      return null;
    }
  }

  function render(s) {
    if (!s) return notReady();
    const mine = yourScore();

    if (s.people > 0) {
      $("avg-score").textContent = pct(s.average_score);
      $("median-score").textContent = pct(s.median_score);
    }
    $("people-count").textContent = s.people;
    $("people-label").textContent = s.people === 1 ? "person counted" : "people counted";
    if (mine !== null) {
      $("your-score").textContent = pct(mine);
      $("your-tile").hidden = false;
    }
    renderSpread(scoreCounts(s), mine);

    // Claims removed from the site since people answered them are left out.
    const claims = (s.claims || [])
      .filter((c) => byId[c.id])
      .map((c) => ({ ...c, claim: byId[c.id], share: c.yes / (c.yes + c.no), total: c.yes + c.no }));
    const byMost = (a, b) => b.total - a.total;
    // Ranked by how many people put it on that side, then by share, then by
    // fewer Don't Knows: 8 believers beat 7, whatever else they answered.
    const fewerUnsure = (a, b) => a.unsure - b.unsure;
    const believed = claims
      .filter((c) => c.yes > 0)
      .sort((a, b) => b.yes - a.yes || b.share - a.share || fewerUnsure(a, b))
      .slice(0, LIST_SIZE);
    const shown = new Set(believed.map((c) => c.id));
    const rejected = claims
      .filter((c) => !shown.has(c.id) && c.no > 0)
      .sort((a, b) => b.no - a.no || a.share - b.share || fewerUnsure(a, b))
      .slice(0, LIST_SIZE);
    rejected.forEach((c) => shown.add(c.id));
    const split = claims
      // Only claims with a real split, at least one in five on the smaller side.
      .filter((c) => !shown.has(c.id) && c.share >= 0.2 && c.share <= 0.8)
      .sort((a, b) => Math.abs(a.share - 0.5) - Math.abs(b.share - 0.5) || byMost(a, b))
      .slice(0, LIST_SIZE);

    renderList("believed", believed);
    renderList("rejected", rejected);
    renderList("split", split);

    $("method-note").textContent =
      `How these are counted: the woo score is the share of Yes and No answers that were Yes, and ` +
      `Don't Know answers don't count either way. A person is included once they've answered at least ` +
      `${s.min_person_answers} claims Yes or No, and a claim is listed once at least ` +
      `${s.min_claim_answers} people have answered it Yes or No.`;

    $("stats-status").hidden = s.people > 0 || claims.length > 0;
    if (!$("stats-status").hidden) {
      $("stats-status").textContent = "Not enough people have answered yet to show stats. Please check back soon.";
      return;
    }
    $("stats-body").hidden = false;
  }

  // Most people score low, so the ranges are narrow at the bottom and wide at
  // the top, to keep everyone from landing in one bar.
  const RANGES = [[0, 2], [3, 5], [6, 8], [9, 11], [12, 15], [16, 20], [21, 30], [31, 50], [51, 100]];

  // Older versions of site_stats sent tenths ("spread") instead of exact
  // scores; those still show, just in the old ten bars.
  function scoreCounts(s) {
    if (Array.isArray(s.scores)) {
      return RANGES.map(([lo, hi]) => ({
        label: lo === hi ? `${lo}%` : `${lo}–${hi}%`,
        n: s.scores.filter((x) => x.pct >= lo && x.pct <= hi).reduce((sum, x) => sum + x.n, 0),
        has: (pct) => pct >= lo && pct <= hi,
      }));
    }
    return (s.spread || []).map((n, i) => ({
      label: `${i * 10}%`,
      n,
      has: (pct) => Math.min(9, Math.floor(pct / 10)) === i,
    }));
  }

  function renderSpread(groups, mine) {
    const max = Math.max(1, ...groups.map((g) => g.n));
    const minePct = mine === null ? null : Math.round(mine * 100);
    $("spread").replaceChildren(
      ...groups.map((g) => {
        const col = document.createElement("div");
        col.className = "col";
        const label = document.createElement("span");
        label.className = "n";
        label.textContent = g.n || "";
        const bar = document.createElement("div");
        bar.className = "bar" + (minePct !== null && g.has(minePct) ? " mine" : "");
        bar.style.height = `${(g.n / max) * 100}%`;
        col.append(label, bar);
        return col;
      })
    );
    $("spread-axis").replaceChildren(
      ...groups.map((g) => {
        const span = document.createElement("span");
        span.textContent = g.label;
        return span;
      })
    );
    if (minePct !== null) $("spread-note").textContent = "How many people have each woo score. Your score is in the highlighted bar.";
  }

  // Tapping a bar segment shows its label; tapping anywhere else hides it.
  document.addEventListener("click", (e) => {
    const part = e.target.closest(".split [data-tip]");
    document.querySelectorAll(".split .tip").forEach((el) => el !== part && el.classList.remove("tip"));
    if (part) part.classList.toggle("tip");
  });

  function renderList(id, items) {
    $(`${id}-section`).hidden = items.length === 0;
    $(id).replaceChildren(
      ...items.map((c) => {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = `${CATEGORIES[c.claim.category].icon} ${c.claim.name}`;

        // Each color shows its own count, so even a sliver is wide enough for its number.
        const bar = document.createElement("span");
        bar.className = "split";
        const words = {
          y: (n) => `${n} ${n === 1 ? "believes" : "believe"}`,
          x: (n) => `${n} ${n === 1 ? "doesn't" : "don't"} believe`,
          u: (n) => `${n} ${n === 1 ? "doesn't" : "don't"} know`,
        };
        for (const [cls, n] of [["y", c.yes], ["x", c.no], ["u", c.unsure]]) {
          if (!n) continue;
          const part = document.createElement("span");
          part.className = cls;
          part.style.flexGrow = n;
          part.textContent = n;
          // Spelled out on hover, or on tap on a phone.
          part.dataset.tip = words[cls](n);
          part.tabIndex = 0;
          bar.append(part);
        }

        const meta = document.createElement("span");
        meta.className = "meta";
        meta.textContent = `${pct(c.share)} believe · ${pct(1 - c.share)} don't`;

        li.append(name, bar, meta);
        return li;
      })
    );
  }

  // World map: a star on each country people answered from, bigger for more
  // people, and continent totals when one is tapped.
  const GLOBES = { "north-america": "🌎", "south-america": "🌎", europe: "🌍", africa: "🌍", asia: "🌏", oceania: "🌏" };
  const SVG = "http://www.w3.org/2000/svg";

  function starPath(x, y, r) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const d = i % 2 ? r * 0.45 : r;
      pts.push(`${(x + d * Math.cos(a)).toFixed(1)},${(y + d * Math.sin(a)).toFixed(1)}`);
    }
    return `M${pts.join("L")}Z`;
  }

  function renderMap(m) {
    const map = window.WORLD_MAP;
    if (!m || !map || !(m.countries || []).length) return;
    const svg = $("world");
    svg.setAttribute("viewBox", `0 0 ${map.width} ${map.height}`);
    const byKey = Object.fromEntries((m.continents || []).map((c) => [c.key, c]));
    const counts = {};
    for (const c of m.countries) {
      const pt = map.points[c.code];
      if (pt) counts[pt[2]] = (counts[pt[2]] || 0) + c.n;
    }

    const lands = {};
    for (const [key, d] of Object.entries(map.shapes)) {
      const land = document.createElementNS(SVG, "path");
      land.setAttribute("d", d);
      land.setAttribute("class", "land");
      land.setAttribute("tabindex", "0");
      land.setAttribute("role", "button");
      land.setAttribute("aria-label", map.continents[key]);
      const pick = () => {
        Object.values(lands).forEach((l) => l.classList.toggle("on", l === land));
        showRegion(key, byKey[key], counts[key] || 0, m);
      };
      land.addEventListener("click", pick);
      land.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick();
        }
      });
      lands[key] = land;
      svg.append(land);
    }

    m.countries.forEach((c, i) => {
      const pt = map.points[c.code];
      if (!pt) return;
      const star = document.createElementNS(SVG, "path");
      star.setAttribute("d", starPath(pt[0], pt[1], Math.min(26, 9 + 5 * Math.sqrt(c.n))));
      star.setAttribute("class", "star");
      star.style.animationDelay = `${(i * 0.7) % 3}s`;
      svg.append(star);
    });
    $("map-section").hidden = false;
  }

  function showRegion(key, c, answered, m) {
    const name = `${GLOBES[key]} ${window.WORLD_MAP.continents[key]}`;
    const box = $("region");
    box.replaceChildren();
    const h = document.createElement("h3");
    h.textContent = name;
    box.append(h);
    const line = (html) => {
      const p = document.createElement("p");
      p.innerHTML = html;
      box.append(p);
    };
    if (!answered) {
      line("Nobody has answered from here yet.");
      return;
    }
    const people = c ? c.people : 0;
    if (people < m.min_people) {
      line(`<b>${answered}</b> ${answered === 1 ? "person has" : "people have"} answered from here. Stats show once ${m.min_people} people here have answered at least ${m.min_person_answers} claims.`);
      return;
    }
    line(`<b>${people}</b> people counted · average woo score <b>${pct(c.average_score)}</b>`);
    const claims = (c.claims || [])
      .filter((x) => byId[x.id])
      .map((x) => ({ ...x, claim: byId[x.id], share: x.yes / (x.yes + x.no), total: x.yes + x.no }));
    if (!claims.length) return;
    const top = (score) => claims.reduce((best, x) => (score(x) > score(best) ? x : best));
    const believed = top((x) => x.yes + x.share / 2 - x.unsure / 1e6);
    const trashed = top((x) => x.no + (1 - x.share) / 2 - x.unsure / 1e6);
    const label = (x) => esc(`${CATEGORIES[x.claim.category].icon} ${x.claim.name}`);
    if (believed.yes) line(`Most believed: <b>${label(believed)}</b> (${pct(believed.share)})`);
    line(`Most trashed: <b>${label(trashed)}</b> (${pct(1 - trashed.share)} No)`);
  }

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }
})();
