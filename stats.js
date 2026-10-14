// The /stats page: totals across everyone, from the site_stats function in
// supabase/schema.sql. Only totals ever reach the browser, never who answered
// what. If Supabase isn't set up or that function hasn't been added yet, the
// page says the numbers aren't ready instead of breaking.
(function () {
  const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js";
  const STORAGE_KEY = "woometer.answers.v1";
  // When each answer was given, kept alongside (see app.js and syncAnswers in cloud.js).
  const TIMES_KEY = "woometer.answerTimes.v1";
  const SESSION_KEY = "woometer.session.v1";
  const LIST_SIZE = 10;

  const cfg = window.WOOMETER_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const byId = Object.fromEntries(CLAIMS.map((c) => [c.id, c]));
  const pct = (x) => `${Math.round(x * 100)}%`;
  // site_stats for everyone, kept so "All" can switch back to it.
  let everyone = null;
  // What the page is showing now, so it can redraw after an answer here.
  let current = { s: null, where: "" };
  let db = null;
  // How many claims people have answered (answered_stats), and which
  // continent is picked, or null for everyone.
  let answered = null;
  let regionKey = null;

  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    notReady();
    return;
  }

  loadScript(SUPABASE_JS)
    .then(async () => {
      db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      db.auth.onAuthStateChange((event, session) => keepSession(session));
      // The map (and each continent's numbers) has its own function; if it
      // isn't in the database yet, the map just stays hidden.
      const mapLoad = db.rpc("map_stats");
      // Only claims on the site now count, not retired ones. If this function
      // isn't in the database yet, its section just stays hidden.
      db.rpc("answered_stats", { current_ids: CLAIMS.map((c) => c.id) }).then(({ data, error }) => {
        if (error) return console.warn("woometer: answered counts aren't available.", error);
        answered = data;
        renderAnswered();
      });
      const { data, error } = await db.rpc("site_stats");
      if (error) throw error;
      everyone = data;
      render(data);
      const { data: m, error: mapError } = await mapLoad;
      if (mapError) console.warn("woometer: map isn't available.", mapError);
      else renderMap(m);
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
      const s = WooScore.of(values);
      return s.decided ? s.fraction : null;
    } catch {
      return null;
    }
  }

  // s is site_stats for everyone, or one continent's numbers from map_stats
  // (same shape). where is that continent's name, or "" for everyone.
  function render(s, where = "") {
    if (!s) return notReady();
    current = { s, where };
    const mine = yourScore();
    document.querySelectorAll("#stats-body h2 .where").forEach((el) => (el.textContent = where && `in ${where}`));

    if (s.people > 0) {
      $("avg-score").textContent = s.average_score == null ? "–" : pct(s.average_score);
      $("median-score").textContent = s.median_score == null ? "–" : pct(s.median_score);
    }
    $("people-count").textContent = s.people;
    $("people-label").textContent = s.people === 1 ? "person counted" : "people counted";
    showMine(s, mine);

    // Claims removed from the site since people answered them are left out.
    const claims = (s.claims || [])
      .filter((c) => byId[c.id])
      .map((c) => ({ ...c, claim: byId[c.id], share: c.yes / (c.yes + c.no), total: c.yes + c.no }));
    const byMost = (a, b) => b.total - a.total;
    // Ranked by how many people put it on that side, then by share, then by
    // fewer Not Sures: 8 believers beat 7, whatever else they answered.
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

    // Not Sure is its own question, so these may also be in the lists above.
    const unsure = claims
      .filter((c) => c.unsure > 0)
      .sort((a, b) => b.unsure - a.unsure || b.unsure / (b.total + b.unsure) - a.unsure / (a.total + a.unsure))
      .slice(0, LIST_SIZE);

    // For everyone, an empty list just hides; for a continent it says why.
    const empty = where ? "Not enough answers here yet." : "";
    renderList("believed", believed, undefined, empty);
    renderList("rejected", rejected, undefined, empty);
    renderList("split", split, undefined, empty && "No claims are split here yet.");
    renderList("unsure", unsure, (c) => `${pct(c.unsure / (c.total + c.unsure))} not sure`, empty && "Nobody here has picked Not Sure enough yet.");

    $("method-note").textContent =
      `How these are counted: a person's woo % is the share of all their answers that were Yes, so in ` +
      `that number Not Sure counts like No. In the claim lists, Not Sure is shown on its own in grey, ` +
      `and the percentages there are of Yes and No answers only. A person is counted once they've answered at least ` +
      `${s.min_person_answers} claims Yes or No. A woo % from only a few answers swings a lot, so the average, ` +
      `typical and chart of woo % only include people with at least ${s.min_woo_answers || 50} Yes or No answers. ` +
      `A claim is listed once at least ` +
      `${s.min_claim_answers} people have answered it Yes or No.` +
      (where
        ? ` Each person is placed by the country they last answered from, and a continent shows once ` +
          `${s.min_people} people there are counted.`
        : "");

    $("stats-body").hidden = true;
    $("stats-status").hidden = s.people > 0 || claims.length > 0;
    if (!$("stats-status").hidden) {
      $("stats-status").textContent = "Not enough people have answered yet to show stats. Please check back soon.";
      return;
    }
    renderAnswered();
    $("stats-body").hidden = false;
  }

  // Your own score tile, and your bar in the chart.
  function showMine(s, mine = yourScore()) {
    if (mine !== null) {
      $("your-score").textContent = pct(mine);
      $("your-tile").hidden = false;
    }
    renderSpread(scoreCounts(s), mine);
  }

  // "How far people get": for everyone, or the picked continent once it has
  // 3 people. Only counts, never anyone's own.
  function renderAnswered() {
    const a = answered && (regionKey ? (answered.continents || {})[regionKey] : answered);
    $("answered-section").hidden = !a || !a.people;
    if (!a || !a.people) return;
    const total = answered.claims;
    $("claim-total").textContent = total;
    $("answered-avg").textContent = Math.round(a.average);
    $("answered-avg-label").textContent = `of ${total} answered on average`;
    $("answered-median").textContent = Math.round(a.median);
    $("answered-median-label").textContent = `of ${total} typical (median)`;
    $("answered-all").textContent = a.answered_all;
    $("answered-all-label").textContent = a.answered_all === 1 ? "person answered every claim" : "people answered every claim";
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
    if (minePct !== null) $("spread-note").textContent = `How many people with ${current.s && current.s.min_woo_answers || 50}+ answers are at each woo %. Yours is in the highlighted bar.`;
  }

  // Tapping a bar segment shows its label; tapping anywhere else hides it.
  document.addEventListener("click", (e) => {
    const part = e.target.closest(".split [data-tip]");
    document.querySelectorAll(".split .tip").forEach((el) => el !== part && el.classList.remove("tip"));
    if (part) part.classList.toggle("tip");
  });

  // Each list shows its top few, with a button for the rest.
  const SHOW_FIRST = 5;

  function renderList(id, items, describe = (c) => `${pct(c.share)} believe · ${pct(1 - c.share)} don't`, empty = "") {
    $(`${id}-section`).hidden = items.length === 0 && !empty;
    const list = $(id);
    if (!items.length) {
      list.classList.remove("open");
      list.nextElementSibling?.classList.contains("show-more") && list.nextElementSibling.remove();
      const li = document.createElement("li");
      li.className = "none";
      li.textContent = empty;
      list.replaceChildren(li);
      return;
    }
    list.classList.remove("open");
    list.nextElementSibling?.classList.contains("show-more") && list.nextElementSibling.remove();
    if (items.length > SHOW_FIRST) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "show-more";
      more.textContent = `Show all ${items.length}`;
      more.addEventListener("click", () => {
        const open = list.classList.toggle("open");
        more.textContent = open ? "Show fewer" : `Show all ${items.length}`;
      });
      list.after(more);
    }
    list.replaceChildren(
      ...items.map((c, i) => {
        const li = document.createElement("li");
        if (i >= SHOW_FIRST) li.className = "more";
        const name = document.createElement("button");
        name.type = "button";
        name.className = "name";
        name.textContent = `${CATEGORIES[c.claim.category].icon} ${c.claim.name}`;
        name.title = c.claim.name;
        name.addEventListener("click", () => openCard(c));

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
        meta.textContent = describe(c);

        li.append(name, bar, meta);
        return li;
      })
    );
  }

  // A claim's card, like the one on the main page: the evidence, how people
  // here answered, and the same three buttons. Answering here saves it just
  // like the main page does, and the totals catch up within about a minute.
  const ANSWERS = [["yes", "Yes"], ["unsure", "Not Sure"], ["no", "No"]];
  const SAID = { yes: "Yes", no: "No", unsure: "Not Sure" };

  function savedAnswers() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function openCard(c) {
    const claim = c.claim;
    $("detail-cat").textContent = `${CATEGORIES[claim.category].icon} ${CATEGORIES[claim.category].label}`;
    $("detail-name").textContent = claim.name;
    $("detail-q").textContent = claim.question;
    $("detail-verdict").textContent = claim.verdict;
    $("detail-link").href = claim.link;
    const total = c.yes + c.no + c.unsure;
    const share = (n) => `${Math.round((n / total) * 100)}%`;
    const people = `${total} ${total === 1 ? "person" : "people"}${current.where ? ` in ${current.where}` : ""}`;
    $("detail-stats").textContent = c.unsure
      ? `${share(c.yes)} of ${people} said Yes, ${share(c.no)} said No and ${share(c.unsure)} aren't sure.`
      : `${share(c.yes)} of ${people} said Yes and ${share(c.no)} said No.`;
    $("detail-saved").hidden = true;
    showButtons(claim, savedAnswers()[claim.id]);
    $("detail").showModal();
  }

  function showButtons(claim, given) {
    $("detail-answer").replaceChildren(
      ...ANSWERS.map(([value, label]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = value;
        b.textContent = label;
        b.disabled = given === value;
        if (b.disabled) b.title = "Your answer";
        b.addEventListener("click", () => answer(claim, value));
        return b;
      })
    );
  }

  async function answer(claim, value) {
    const answers = savedAnswers();
    const before = answers[claim.id];
    const at = Date.now();
    // A changed answer counts as the newest one, as on the main page.
    delete answers[claim.id];
    answers[claim.id] = value;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
      const times = JSON.parse(localStorage.getItem(TIMES_KEY)) || {};
      times[claim.id] = at;
      localStorage.setItem(TIMES_KEY, JSON.stringify(times));
    } catch {}
    if (typeof Sounds !== "undefined") ({ yes: Sounds.woo, no: Sounds.trash, unsure: Sounds.unsure })[value]();
    showButtons(claim, value);
    const saved = $("detail-saved");
    saved.hidden = false;
    saved.textContent = before
      ? `Changed to ${SAID[value]}. The totals here catch up within about a minute.`
      : `Saved as ${SAID[value]}. The totals here catch up within about a minute.`;
    // Your own score and its bar on this page change straight away.
    if (current.s) showMine(current.s);
    // If the main page can't be reached now, it sends this answer up next
    // time it opens, since this browser's copy is newer than the account's.
    sendAnswer(claim.id, value, at).catch((err) => console.warn("woometer: answer will be saved next visit.", err));
  }

  // Only uses a sign-in this browser already has (never starts a new one), so
  // someone who has never answered on the main page doesn't get an account here.
  async function sendAnswer(id, value, at) {
    if (!db) return;
    let { data } = await db.auth.getSession();
    if (!data.session) {
      const spare = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (!spare || !spare.refresh_token) return;
      const res = await db.auth.setSession({ access_token: spare.access_token, refresh_token: spare.refresh_token });
      if (res.error || !res.data.session) return;
      data = res.data;
    }
    const { error } = await db
      .from("answers")
      .upsert({ user_id: data.session.user.id, claim_id: id, answer: value, updated_at: new Date(at).toISOString() });
    if (error) throw error;
  }

  // The main page keeps a spare copy of its sign-in (see keepSession in
  // cloud.js); a refresh here has to update it too, or that copy goes stale.
  function keepSession(session) {
    if (!session || !session.refresh_token) return;
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ user: session.user.id, access_token: session.access_token, refresh_token: session.refresh_token })
      );
    } catch {}
  }

  // World map: a star on each country people answered from, bigger for more
  // people. Tapping a continent (or its chip) switches the whole page to just
  // that continent; "All" or tapping the sea switches back to everyone.
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
    const chips = {};
    const pick = (key) => {
      regionKey = key;
      Object.entries(lands).forEach(([k, l]) => l.classList.toggle("on", k === key));
      Object.entries(chips).forEach(([k, b]) => b.setAttribute("aria-pressed", String(k === (key || "all"))));
      if (!key) render(everyone);
      else showRegion(key, byKey[key], counts[key] || 0, m);
    };

    for (const [key, d] of Object.entries(map.shapes)) {
      const land = document.createElementNS(SVG, "path");
      land.setAttribute("d", d);
      land.setAttribute("class", "land");
      land.setAttribute("tabindex", "0");
      land.setAttribute("role", "button");
      land.setAttribute("aria-label", map.continents[key]);
      land.addEventListener("click", (e) => {
        e.stopPropagation();
        pick(land.classList.contains("on") ? null : key);
      });
      land.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick(key);
        }
      });
      lands[key] = land;
      svg.append(land);
    }
    svg.addEventListener("click", () => pick(null));

    m.countries.forEach((c, i) => {
      const pt = map.points[c.code];
      if (!pt) return;
      const star = document.createElementNS(SVG, "path");
      star.setAttribute("d", starPath(pt[0], pt[1], Math.min(26, 9 + 5 * Math.sqrt(c.n))));
      star.setAttribute("class", "star");
      star.style.animationDelay = `${(i * 0.7) % 3}s`;
      svg.append(star);
    });

    // A chip for everyone, then one for each continent anyone answered from.
    const chip = (key, text) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = text;
      b.setAttribute("aria-pressed", String(key === "all"));
      b.addEventListener("click", () => pick(key === "all" ? null : key));
      chips[key] = b;
      return b;
    };
    $("chips").replaceChildren(
      chip("all", "🌐 All"),
      ...Object.keys(map.continents)
        .filter((key) => counts[key])
        .map((key) => chip(key, `${GLOBES[key]} ${map.continents[key]}`))
    );
    $("map-section").hidden = false;
    $("map-hint").hidden = false;
  }

  function showRegion(key, c, answered, m) {
    const name = `${GLOBES[key]} ${window.WORLD_MAP.continents[key]}`;
    const people = c ? c.people : 0;
    if (!everyone || people < m.min_people) {
      $("stats-body").hidden = true;
      const status = $("stats-status");
      status.hidden = false;
      status.textContent = !answered
        ? `Nobody has answered from ${window.WORLD_MAP.continents[key]} yet.`
        : `Not enough answers from ${window.WORLD_MAP.continents[key]} yet. ` +
          `${answered} ${answered === 1 ? "person has" : "people have"} answered from here, and stats show once ` +
          `${m.min_people} people here have answered at least ${m.min_person_answers} claims.`;
      return;
    }
    render(
      {
        people,
        average_score: c.average_score,
        median_score: c.median_score,
        scores: c.scores || [],
        claims: c.claims || [],
        min_people: m.min_people,
        min_person_answers: m.min_person_answers,
        min_woo_answers: m.min_woo_answers,
        min_claim_answers: m.min_claim_answers,
      },
      name
    );
  }
})();
