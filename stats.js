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
    renderSpread(s.spread || [], mine);

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

    renderList("believed", believed, (c) => `${pct(c.share)} believe it`);
    renderList("rejected", rejected, (c) => `${pct(1 - c.share)} put it in the Trash Bin`);
    renderList("split", split, (c) => `${pct(c.share)} believe it, ${pct(1 - c.share)} don't`);

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

  function renderSpread(spread, mine) {
    const max = Math.max(1, ...spread);
    const mineBucket = mine === null ? -1 : Math.min(9, Math.floor(mine * 10));
    $("spread").replaceChildren(
      ...spread.map((n, i) => {
        const col = document.createElement("div");
        col.className = "col";
        const label = document.createElement("span");
        label.className = "n";
        label.textContent = n || "";
        const bar = document.createElement("div");
        bar.className = "bar" + (i === mineBucket ? " mine" : "");
        bar.style.height = `${(n / max) * 100}%`;
        col.append(label, bar);
        return col;
      })
    );
    $("spread-axis").replaceChildren(
      ...spread.map((_, i) => {
        const span = document.createElement("span");
        span.textContent = `${i * 10}%`;
        return span;
      })
    );
    if (mineBucket >= 0) $("spread-note").textContent = "How many people have each woo score. Your score is in the highlighted bar.";
  }

  function renderList(id, items, describe) {
    $(`${id}-section`).hidden = items.length === 0;
    $(id).replaceChildren(
      ...items.map((c) => {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = `${CATEGORIES[c.claim.category].icon} ${c.claim.name}`;

        const all = c.yes + c.no + c.unsure;
        const bar = document.createElement("span");
        bar.className = "split";
        for (const [cls, n] of [["y", c.yes], ["x", c.no], ["u", c.unsure]]) {
          const part = document.createElement("span");
          part.className = cls;
          part.style.width = `${(n / all) * 100}%`;
          bar.append(part);
        }

        const meta = document.createElement("span");
        meta.className = "meta";
        const unsure = c.unsure ? `, ${c.unsure} don't know` : "";
        meta.textContent = `${describe(c)} · ${c.total} ${c.total === 1 ? "answer" : "answers"}${unsure}`;

        li.append(name, bar, meta);
        return li;
      })
    );
  }
})();
