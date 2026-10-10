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
    const believed = [...claims].sort((a, b) => b.share - a.share || byMost(a, b)).slice(0, LIST_SIZE);
    const shown = new Set(believed.map((c) => c.id));
    const rejected = claims
      .filter((c) => !shown.has(c.id))
      .sort((a, b) => a.share - b.share || byMost(a, b))
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
        for (const [cls, n, label] of [["y", c.yes, "believe"], ["x", c.no, "don't"], ["u", c.unsure, "don't know"]]) {
          if (!n) continue;
          const part = document.createElement("span");
          part.className = cls;
          part.style.flexGrow = n;
          part.textContent = n;
          part.title = `${n} ${label}`;
          bar.append(part);
        }

        const meta = document.createElement("span");
        meta.className = "meta";
        // e.g. "20% believe · 80% don't · 2 don't know"
        const unsure = c.unsure ? ` · ${c.unsure} don't know` : "";
        meta.textContent = `${pct(c.share)} believe · ${pct(1 - c.share)} don't${unsure}`;

        li.append(name, bar, meta);
        return li;
      })
    );
  }
})();
