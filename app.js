(function () {
  const STORAGE_KEY = "woometer.answers.v1";

  const $ = (id) => document.getElementById(id);
  const grid = $("grid");
  const filters = $("filters");
  const trashPile = $("trash-pile");
  const wooPile = $("woo-pile");
  const detail = $("detail");

  const byId = Object.fromEntries(CLAIMS.map((c) => [c.id, c]));

  // answers: { [claimId]: "yes" | "no" }, in the order they were given
  let answers = load();
  let activeCategory = "all";
  let detailId = null;

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      // Drop answers for claims that have since been removed from the list.
      return Object.fromEntries(Object.entries(saved).filter(([id]) => byId[id]));
    } catch {
      return {};
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
    } catch {
      // Private mode or storage blocked: the page still works, it just won't remember.
    }
  }

  function score() {
    const ids = Object.keys(answers);
    const woo = ids.filter((id) => answers[id] === "yes").length;
    return { answered: ids.length, woo, trash: ids.length - woo, pct: ids.length ? Math.round((woo / ids.length) * 100) : 0 };
  }

  function verdictFor(pct, answered) {
    if (answered === 0) return "Answer a few to get a reading";
    if (pct === 0) return "Skeptic of the year";
    if (pct <= 10) return "Hard to fool";
    if (pct <= 25) return "A little woo-curious";
    if (pct <= 50) return "Partly hoodwinked";
    if (pct <= 75) return "Deep in the woo";
    if (pct < 100) return "Thoroughly hoodwinked";
    return "Maximum woo";
  }

  // Rendering

  function renderFilters() {
    const options = [["all", "All"]].concat(
      Object.entries(CATEGORIES).map(([key, c]) => [key, `${c.icon} ${c.label}`])
    );
    filters.replaceChildren(
      ...options.map(([key, label]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip";
        b.textContent = label;
        b.setAttribute("aria-pressed", String(key === activeCategory));
        b.addEventListener("click", () => {
          activeCategory = key;
          renderFilters();
          renderGrid();
        });
        return b;
      })
    );
  }

  function makeCard(claim) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = claim.id;

    const cat = document.createElement("span");
    cat.className = "cat";
    cat.textContent = `${CATEGORIES[claim.category].icon} ${CATEGORIES[claim.category].label}`;

    const h = document.createElement("h3");
    h.textContent = claim.name;

    const q = document.createElement("p");
    q.className = "q";
    q.textContent = claim.question;

    const row = document.createElement("div");
    row.className = "answer";
    for (const [value, label, cls] of [["yes", "Yes", "yes"], ["no", "No", "no"]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = label;
      b.setAttribute("aria-label", `${label}: ${claim.name}`);
      b.addEventListener("click", () => answer(claim.id, value, card));
      row.append(b);
    }

    card.append(cat, h, q, row);
    return card;
  }

  function renderGrid() {
    const open = CLAIMS.filter(
      (c) => !answers[c.id] && (activeCategory === "all" || c.category === activeCategory)
    );
    grid.replaceChildren(...open.map(makeCard));

    const total = CLAIMS.length;
    const done = Object.keys(answers).length;
    $("progress").textContent = `${done} of ${total} answered`;
    $("done").hidden = open.length > 0;
    $("done").querySelector("p").textContent =
      done === total ? "That's every claim on the list." : "Nothing left in this category.";
  }

  function renderBins() {
    const fill = (list, kind) => {
      const ids = Object.keys(answers).filter((id) => answers[id] === kind);
      list.replaceChildren(
        ...ids.map((id) => {
          const li = document.createElement("li");
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = byId[id].name;
          b.addEventListener("click", () => openDetail(id));
          li.append(b);
          return li;
        })
      );
    };
    fill(trashPile, "no");
    fill(wooPile, "yes");
  }

  function renderMeter() {
    const s = score();
    $("pct").textContent = `${s.pct}%`;
    $("verdict").textContent = verdictFor(s.pct, s.answered);
    $("trash-count").textContent = s.trash;
    $("woo-count").textContent = s.woo;
    $("mini-trash-count").textContent = s.trash;
    $("mini-woo-count").textContent = s.woo;
    $("mini-pct").textContent = `${s.pct}%`;
    // -90deg is all the way left (0%), +90deg all the way right (100%).
    $("needle").style.transform = `rotate(${-90 + s.pct * 1.8}deg)`;
  }

  function renderAll() {
    renderGrid();
    renderBins();
    renderMeter();
  }

  // Answering

  function answer(id, value, card) {
    answers[id] = value;
    save();
    if (value === "yes") Sounds.woo();
    else Sounds.trash();

    // On narrow screens the bins are below the grid, so aim for the bottom bar instead.
    let bin = value === "yes" ? $("woo-bin") : $("trash-bin");
    if (!isOnScreen(bin)) bin = value === "yes" ? $("mini-woo") : $("mini-trash");
    flyInto(card, bin, () => {
      renderAll();
      bin.classList.add("bump");
      setTimeout(() => bin.classList.remove("bump"), 200);
    });
  }

  function isOnScreen(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
  }

  // Animate a copy of the card shrinking into the bin, then call done().
  function flyInto(card, bin, done) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = card.getBoundingClientRect();
    const to = bin.getBoundingClientRect();
    if (reduced || !isOnScreen(bin)) {
      done();
      return;
    }

    const flyer = card.cloneNode(true);
    flyer.classList.add("flyer");
    Object.assign(flyer.style, {
      left: `${from.left}px`,
      top: `${from.top}px`,
      width: `${from.width}px`,
      height: `${from.height}px`,
    });
    document.body.append(flyer);
    card.classList.add("leaving");

    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + Math.min(40, to.height / 2) - (from.top + from.height / 2);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        flyer.style.transform = `translate(${dx}px, ${dy}px) scale(0.15) rotate(${dx > 0 ? 12 : -12}deg)`;
        flyer.style.opacity = "0.2";
      });
    });

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      flyer.remove();
      done();
    };
    flyer.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 700);
  }

  // Detail dialog for answered claims

  function openDetail(id) {
    const c = byId[id];
    detailId = id;
    $("detail-cat").textContent = `${CATEGORIES[c.category].icon} ${CATEGORIES[c.category].label}`;
    $("detail-name").textContent = c.name;
    $("detail-q").textContent = c.question;
    $("detail-verdict").textContent = c.verdict;
    $("detail-link").href = c.link;
    detail.showModal();
  }

  $("detail-undo").addEventListener("click", () => {
    if (detailId) {
      delete answers[detailId];
      save();
      renderAll();
    }
    detail.close();
  });

  // Share and reset

  $("share").addEventListener("click", async () => {
    const s = score();
    const text = s.answered
      ? `I'm ${s.pct}% hoodwinked on the Woometer (${s.woo} of ${s.answered} claims in my Woo Pile). How much woo do you believe? ${location.href.split("#")[0]}`
      : `How much woo do you believe? ${location.href.split("#")[0]}`;
    try {
      await navigator.clipboard.writeText(text);
      toast("Score copied. Paste it anywhere.");
    } catch {
      window.prompt("Copy your score:", text);
    }
  });

  $("reset").addEventListener("click", () => {
    if (!Object.keys(answers).length) return;
    if (!confirm("Clear all your answers and start over?")) return;
    answers = {};
    save();
    renderAll();
  });

  const muteBtn = $("mute");
  function renderMute() {
    const m = Sounds.isMuted();
    muteBtn.textContent = m ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-pressed", String(m));
    muteBtn.title = m ? "Turn sound on" : "Turn sound off";
    muteBtn.setAttribute("aria-label", muteBtn.title);
  }
  muteBtn.addEventListener("click", () => {
    Sounds.setMuted(!Sounds.isMuted());
    renderMute();
  });
  renderMute();

  function toast(message) {
    const t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.textContent = message;
    document.body.append(t);
    setTimeout(() => t.remove(), 2200);
  }

  renderFilters();
  renderAll();
})();
