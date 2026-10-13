// The "Statistics" box under the piles: one fun fact about everyone's answers,
// a new one every minute, linking to the full /stats page. The facts come
// from the same site_stats totals as /stats, so nobody's own answers are shown.
// If the totals can't be loaded, the box still links to /stats.
(function () {
  const cfg = window.WOOMETER_CONFIG || {};
  const box = document.getElementById("fun-stat");
  const text = document.getElementById("fun-stat-text");
  if (!box || !text || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return;

  const EVERY_MS = 60000;
  const byId = Object.fromEntries(CLAIMS.map((c) => [c.id, c]));
  const pct = (x) => `${Math.round(x * 100)}%`;
  const label = (claim) => `${CATEGORIES[claim.category].icon} ${claim.name}`;

  // The box shows once this browser has 10 Yes or No answers, the same bar
  // /stats uses to count someone. Crossing it by answering shows a few
  // sparkles and a quiet note, once; anyone already past it just sees the box.
  const COUNTED_AT = 10;
  const UNLOCKED_KEY = "woometer.statsUnlocked.v1";
  let answeredNow = false;
  const decided = () =>
    Object.entries(saved()).filter(([id, v]) => byId[id] && (v === "yes" || v === "no")).length;
  const celebrated = () => {
    try {
      return localStorage.getItem(UNLOCKED_KEY) === "1";
    } catch {
      return true;
    }
  };
  function updateLock() {
    const counted = decided() >= COUNTED_AT;
    const wasHidden = box.hidden;
    box.hidden = !counted;
    if (!counted || !wasHidden) return;
    if (answeredNow && !celebrated()) celebrate();
    try {
      localStorage.setItem(UNLOCKED_KEY, "1");
    } catch {}
  }
  // A tap on an answer fires "woometer:answer" just after the save, so wait a
  // moment to tell a tap from answers arriving from an account.
  document.addEventListener("woometer:answer", () => (answeredNow = true));
  window.addEventListener("woometer:answers", () =>
    setTimeout(() => {
      updateLock();
      answeredNow = false;
    })
  );
  updateLock();

  function celebrate() {
    box.classList.add("unlocked");
    for (let i = 0; i < 8; i++) {
      const spark = document.createElement("span");
      spark.className = "unlock-spark";
      spark.setAttribute("aria-hidden", "true");
      spark.textContent = "✦";
      const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
      spark.style.left = `${50 + Math.cos(angle) * 30}%`;
      spark.style.top = `${50 + Math.sin(angle) * 30}%`;
      spark.style.setProperty("--dx", `${Math.cos(angle) * 40}px`);
      spark.style.setProperty("--dy", `${Math.sin(angle) * 28}px`);
      spark.style.animationDelay = `${i * 60}ms`;
      box.append(spark);
      setTimeout(() => spark.remove(), 2000);
    }
    // A shooting star across the header, like the one for finishing the list.
    window.dispatchEvent(new Event("woometer:shooting-star"));
    const note = document.createElement("div");
    note.className = "unlock-note";
    note.setAttribute("role", "status");
    note.textContent = "Now that you've answered 10, you're counted on the stats page. ✨";
    document.body.append(note);
    setTimeout(() => note.remove(), 6200);
    setTimeout(() => box.classList.remove("unlocked"), 2000);
  }

  fetch(`${cfg.supabaseUrl}/rest/v1/rpc/site_stats`, {
    method: "POST",
    headers: { apikey: cfg.supabaseAnonKey, "Content-Type": "application/json" },
    body: "{}",
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`site_stats ${res.status}`))))
    .then((s) => {
      const facts = factsFrom(s);
      if (facts.length) rotate(facts);
    })
    .catch((err) => console.warn("woometer: fun stats aren't available.", err));

  function saved() {
    try {
      return JSON.parse(localStorage.getItem("woometer.answers.v1")) || {};
    } catch {
      return {};
    }
  }

  function yourScore() {
    try {
      const values = Object.entries(saved()).filter(([id]) => byId[id]).map(([, v]) => v);
      const s = WooScore.of(values);
      return s.decided >= 10 ? s.fraction : null;
    } catch {
      return null;
    }
  }

  function factsFrom(s) {
    if (!s) return [];
    const facts = [];
    const claims = (s.claims || [])
      .filter((c) => byId[c.id])
      .map((c) => ({ ...c, claim: byId[c.id], share: c.yes / (c.yes + c.no), all: c.yes + c.no + c.unsure }));
    const top = (list, score) => list.reduce((best, c) => (!best || score(c) > score(best) ? c : best), null);

    if (s.people > 0 && s.average_score != null) {
      const mine = yourScore();
      facts.push(
        mine === null
          ? `On average, people are <b>${pct(s.average_score)}</b> woo.`
          : `On average, people are <b>${pct(s.average_score)}</b> woo. You: <b>${pct(mine)}</b>`
      );
    }
    if (s.people > 1) facts.push(`<b>${s.people}</b> people have taken the woometer.`);
    if (!claims.length) return facts;

    const believed = top(claims, (c) => c.yes + c.share / 2 - c.unsure / 1e6);
    if (believed.yes) facts.push(`Most believed: <b>${esc(label(believed.claim))}</b> (${pct(believed.share)})`);
    const rejected = top(claims, (c) => c.no + (1 - c.share) / 2 - c.unsure / 1e6);
    facts.push(`Most rejected: <b>${esc(label(rejected.claim))}</b> (${pct(1 - rejected.share)} No)`);
    const split = top(claims.filter((c) => c.yes && c.no), (c) => -Math.abs(c.share - 0.5) + c.all / 1e6);
    if (split && split !== believed && split.share >= 0.2 && split.share <= 0.8) {
      facts.push(`Most split: <b>${esc(label(split.claim))}</b> (${pct(split.share)} believe)`);
    }
    const unsure = top(claims.filter((c) => c.unsure), (c) => c.unsure / c.all);
    if (unsure) facts.push(`Least sure: <b>${esc(label(unsure.claim))}</b> (${pct(unsure.unsure / unsure.all)} Don't Know)`);

    // The category with the highest share of Yes answers.
    const cats = {};
    for (const c of claims) {
      const t = (cats[c.claim.category] ||= { yes: 0, decided: 0 });
      t.yes += c.yes;
      t.decided += c.yes + c.no;
    }
    const [catKey, cat] = Object.entries(cats).reduce((a, b) => (b[1].yes / b[1].decided > a[1].yes / a[1].decided ? b : a));
    if (cat.yes) facts.push(`Most believed kind: <b>${CATEGORIES[catKey].icon} ${esc(CATEGORIES[catKey].short || CATEGORIES[catKey].label)}</b>`);
    return facts;
  }

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function rotate(facts) {
    let i = 0;
    show(facts[0]);
    if (facts.length < 2) return;
    setInterval(() => {
      if (document.hidden) return;
      i = (i + 1) % facts.length;
      text.classList.add("fade");
      setTimeout(() => {
        show(facts[i]);
        text.classList.remove("fade");
      }, 300);
    }, EVERY_MS);
  }

  function show(html) {
    text.innerHTML = html;
  }
})();
