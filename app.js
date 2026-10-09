(function () {
  const STORAGE_KEY = "woometer.answers.v1";

  const $ = (id) => document.getElementById(id);
  const grid = $("grid");
  const filters = $("filters");
  const trashPile = $("trash-pile");
  const wooPile = $("woo-pile");
  const unsurePile = $("unsure-pile");
  const detail = $("detail");

  const byId = Object.fromEntries(CLAIMS.map((c) => [c.id, c]));

  // answers: { [claimId]: "yes" | "no" | "unsure" }, in the order they were given.
  // "unsure" is Don't Know: off the board, but not part of the woo score.
  let answers = load();
  let activeCategory = "all";
  let query = "";
  let detailId = null;
  let catStage = null;

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

  // The woo score only counts Yes and No; Don't Know answers sit it out.
  function score() {
    const values = Object.values(answers);
    const woo = values.filter((v) => v === "yes").length;
    const trash = values.filter((v) => v === "no").length;
    const unsure = values.filter((v) => v === "unsure").length;
    const answered = woo + trash;
    return { answered, woo, trash, unsure, pct: answered ? Math.round((woo / answered) * 100) : 0 };
  }

  // Lead with what people reject: most visitors turn down most of the list.
  function verdictFor(pct, answered) {
    if (answered === 0) return "Answer a few to get a reading";
    if (pct === 0) return "You reject all of it";
    if (pct === 100) return "You believe all of it";
    return `You reject ${100 - pct}% of it`;
  }

  // Rendering

  function renderFilters() {
    const options = [["all", "All"]].concat(
      Object.entries(CATEGORIES).map(([key, c]) => [key, `${c.icon} ${c.short || c.label}`, c.label])
    );
    filters.replaceChildren(
      ...options.map(([key, label, full]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip";
        b.textContent = label;
        if (full) b.title = full;
        b.setAttribute("aria-pressed", String(key === activeCategory));
        b.addEventListener("click", () => {
          activeCategory = key;
          renderFilters();
          renderGrid();
        });
        return b;
      })
    );
    fitFilters();
  }

  // Let the chips wrap onto at most two rows; if they'd need more (narrow
  // screens), keep them on one row that scrolls sideways instead.
  function fitFilters() {
    filters.classList.remove("one-row");
    const chips = filters.children;
    if (!chips.length) return;
    const rows = new Set([...chips].map((c) => c.offsetTop)).size;
    if (rows > 2) filters.classList.add("one-row");
  }
  window.addEventListener("resize", () => {
    fitFilters();
    renderBins();
  });

  const PILES = {
    yes: { cls: "in-woo", label: "🔮 In your Woo Pile", title: "🔮 Woo Pile" },
    no: { cls: "in-trash", label: "🗑️ In your Trash Bin", title: "🗑️ Trash Bin" },
    unsure: { cls: "in-unsure", label: "🤷 In your Don't Know pile", title: "🤷 Don't Know" },
  };

  function makeCard(claim) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = claim.id;

    const cat = document.createElement("span");
    cat.className = "card-cat";
    cat.textContent = `${CATEGORIES[claim.category].icon} ${CATEGORIES[claim.category].label}`;

    // The title opens the evidence and everyone's answers, without answering.
    const h = document.createElement("h3");
    const info = document.createElement("button");
    info.type = "button";
    info.className = "card-info";
    info.setAttribute("aria-label", `${claim.name}: what's the evidence?`);
    const title = document.createElement("span");
    title.textContent = claim.name;
    const why = document.createElement("span");
    why.className = "card-why";
    why.setAttribute("aria-hidden", "true");
    why.textContent = "ⓘ";
    info.append(title, why);
    info.addEventListener("click", () => openDetail(claim.id));
    cat.addEventListener("click", () => openDetail(claim.id));
    h.append(info);

    const q = document.createElement("p");
    q.className = "q";
    q.textContent = claim.question;

    const row = document.createElement("div");
    row.className = "answer";
    const given = answers[claim.id];
    // Don't Know sits between Yes and No, on two lines so all three stay the same size.
    for (const [value, label, cls, text] of [["yes", "Yes", "yes"], ["unsure", "Don't Know", "unsure", "Don't\nKnow"], ["no", "No", "no"]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = text || label;
      b.setAttribute("aria-label", `${label}: ${claim.name}`);
      if (given) b.setAttribute("aria-pressed", String(given === value));
      b.addEventListener("click", () => answer(claim.id, value, card));
      row.append(b);
    }

    // Search also shows claims you've already answered, labelled with their pile.
    // Tapping another button moves the claim to that pile.
    const parts = [cat, h, q, row];
    if (given) {
      card.classList.add("answered", PILES[given].cls);
      const pile = document.createElement("p");
      pile.className = "card-pile";
      pile.textContent = PILES[given].label;
      parts.splice(3, 0, pile);
    }

    card.append(...parts);
    return card;
  }

  function renderGrid() {
    // Normally only unanswered claims are on the board; a search also finds
    // answered ones, listed after the unanswered matches.
    const open = CLAIMS.filter(
      (c) =>
        (query || !answers[c.id]) &&
        (activeCategory === "all" || c.category === activeCategory) &&
        (!query || `${c.name} ${c.question}`.toLowerCase().includes(query))
    ).sort((a, b) => !!answers[a.id] - !!answers[b.id]);
    grid.replaceChildren(...open.map(makeCard));

    const total = CLAIMS.length;
    const done = Object.keys(answers).length;
    $("progress").textContent = `${done} of ${total} answered`;
    $("done").hidden = open.length > 0;
    $("done").querySelector("p").textContent =
      done === total ? "That's every claim on the list." : query ? "No claims match your search." : "Nothing left in this category.";
  }

  // Each bin shows its newest few claims so the side panel never needs its own
  // scrollbar; the rest open in a popup. On wide screens the panel stays put
  // while the board scrolls, so the previews shrink until all three bins fit.
  // [Trash Bin and Woo Pile, Don't Know], tried in order until the panel fits.
  const PREVIEWS = [[6, 3], [5, 3], [4, 2], [3, 2], [3, 1], [3, 0], [2, 0], [1, 0]];

  function pileIds(kind) {
    return Object.keys(answers).filter((id) => answers[id] === kind).reverse();
  }

  function pileItem(id, onClick) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = byId[id].name;
    b.addEventListener("click", onClick);
    li.append(b);
    return li;
  }

  function renderBins() {
    const side = document.querySelector(".bins");
    side.classList.remove("unstick");
    // Stick just below the header, whatever height it wraps to.
    side.style.top = `${document.querySelector(".top").offsetHeight + 16}px`;
    for (const [n, unsure] of PREVIEWS) {
      fillBins(n, unsure);
      if (sideFits(side)) return;
    }
    // Still too tall for this window: let the panel scroll with the page.
    side.classList.add("unstick");
  }

  function sideFits(side) {
    const css = getComputedStyle(side);
    if (css.display === "contents") return true; // one column: the bins sit below the board
    return side.offsetHeight + (parseFloat(css.top) || 0) + 16 <= window.innerHeight;
  }

  function fillBins(preview, unsurePreview) {
    const fill = (list, kind, preview) => {
      const ids = pileIds(kind);
      const items = ids.slice(0, preview).map((id) => pileItem(id, () => openDetail(id)));
      if (ids.length > preview) {
        const li = document.createElement("li");
        const more = document.createElement("button");
        more.type = "button";
        more.className = "more";
        more.textContent = `See all ${ids.length}`;
        more.addEventListener("click", () => openPile(kind));
        li.append(more);
        items.push(li);
      }
      list.replaceChildren(...items);
    };
    fill(trashPile, "no", preview);
    fill(wooPile, "yes", preview);
    fill(unsurePile, "unsure", unsurePreview);
  }

  function openPile(kind) {
    const dlg = $("pile-dialog");
    const ids = pileIds(kind);
    $("pile-title").textContent = `${PILES[kind].title} (${ids.length})`;
    dlg.classList.toggle("trash", kind === "no");
    $("pile-all").replaceChildren(
      ...ids.map((id) =>
        pileItem(id, () => {
          dlg.close();
          openDetail(id);
        })
      )
    );
    dlg.showModal();
  }

  function renderMeter() {
    const s = score();
    $("pct").textContent = `${s.pct}%`;
    $("verdict").textContent = verdictFor(s.pct, s.answered);
    $("trash-count").textContent = s.trash;
    $("woo-count").textContent = s.woo;
    $("unsure-count").textContent = s.unsure;
    $("mini-trash-count").textContent = s.trash;
    $("mini-woo-count").textContent = s.woo;
    $("mini-unsure-count").textContent = s.unsure;
    showMiniUnsure(s.unsure > 0);
    $("mini-pct").textContent = `${s.pct}%`;
    // -90deg is all the way left (0%), +90deg all the way right (100%).
    $("needle").style.transform = `rotate(${-90 + s.pct * 1.8}deg)`;
    renderCat(Cat.stageFor(s.pct));
  }

  // The bottom bar's Don't Know count appears once there's something in it;
  // on small phones the other two then drop their words to make room.
  function showMiniUnsure(show) {
    $("mini-unsure").hidden = !show;
    $("mini-unsure").parentElement.classList.toggle("has-unsure", show);
  }

  // A different cat for every 5% of woo.
  function renderCat(stage) {
    if (stage === catStage) return;
    const art = $("cat-art");
    const first = catStage === null;
    catStage = stage;
    art.innerHTML = Cat.svg(stage);
    $("mini-cat").innerHTML = Cat.svg(stage);
    $("cat-name").textContent = Cat.name(stage);
    $("cat").title = `${Cat.name(stage)}. Tap to see every cat.`;
    if (!first) {
      art.classList.remove("cat-pop");
      void art.offsetWidth; // restart the animation
      art.classList.add("cat-pop");
    }
  }

  // Percent range that rounds to each stage: 0-2%, 3-7%, ... 98-100%.
  function stageRange(stage) {
    const lo = stage === 0 ? 0 : stage * 5 - 2;
    const hi = stage === 20 ? 100 : stage * 5 + 2;
    return `${lo}–${hi}%`;
  }

  function openCats() {
    const dlg = $("cats");
    const items = [];
    for (let stage = 0; stage <= 20; stage++) {
      const li = document.createElement("li");
      li.className = "cat-tile";
      const art = document.createElement("span");
      art.className = "cat-tile-art";
      art.innerHTML = Cat.svg(stage);
      const range = document.createElement("span");
      range.className = "cat-tile-range";
      range.textContent = stageRange(stage);
      const name = document.createElement("span");
      name.className = "cat-tile-name";
      name.textContent = Cat.name(stage);
      li.append(art, range, name);
      if (stage === catStage) {
        li.classList.add("current");
        li.setAttribute("aria-current", "true");
        const you = document.createElement("span");
        you.className = "cat-tile-you";
        you.textContent = "You";
        li.append(you);
      }
      items.push(li);
    }
    $("cat-grid").replaceChildren(...items);
    dlg.showModal();
    dlg.querySelector(".current")?.scrollIntoView({ block: "nearest" });
  }

  $("cat").addEventListener("click", openCats);
  $("mini-cat").addEventListener("click", openCats);
  $("mini-cat").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openCats();
    }
  });

  function renderAll() {
    renderGrid();
    renderBins();
    renderMeter();
  }

  // Answering

  function answer(id, value, card) {
    if (answers[id] === value) return;
    // A changed answer counts as the newest one in its new pile.
    delete answers[id];
    answers[id] = value;
    save();
    emit("answer", { id, value });
    if (value === "yes") Sounds.woo();
    else if (value === "no") Sounds.trash();
    else Sounds.unsure();

    // On narrow screens the bins are below the grid, so aim for the bottom bar instead.
    const BINS = { yes: ["woo-bin", "mini-woo"], no: ["trash-bin", "mini-trash"], unsure: ["unsure-bin", "mini-unsure"] };
    let bin = $(BINS[value][0]);
    if (!isOnScreen(bin)) {
      // The bottom bar's Don't Know count only shows once it has something in it.
      if (value === "unsure") showMiniUnsure(true);
      bin = $(BINS[value][1]);
    }
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
    $("detail-undo").hidden = !answers[id];
    detail.showModal();
    emit("detail", { id });
  }

  $("detail-undo").addEventListener("click", () => {
    if (detailId) {
      delete answers[detailId];
      save();
      renderAll();
      emit("remove", { id: detailId });
    }
    detail.close();
  });

  // Share and reset

  $("share").addEventListener("click", async () => {
    const s = score();
    // With accounts on, cloud.js supplies a personal link that shows this result.
    const personal = window.Woometer.shareUrl && window.Woometer.shareUrl();
    const link = personal || location.origin + location.pathname;
    const text = s.answered
      ? `I'm ${s.pct}% woo on the Woometer: I reject ${100 - s.pct}% of the ${s.answered} claims I've answered. ${personal ? "See my results and compare with yours:" : "How much woo do you believe?"} ${link}`
      : `How much woo do you believe? ${link}`;
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
    emit("reset", {});
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

  $("search").addEventListener("input", (e) => {
    query = e.target.value.trim().toLowerCase();
    renderGrid();
  });

  // Search lives behind the 🔍 at the start of the filter row and opens inline.
  const searchPop = $("search-pop");
  const searchToggle = $("search-toggle");
  function openSearch() {
    searchPop.hidden = false;
    searchToggle.setAttribute("aria-expanded", "true");
    fitFilters();
    $("search").focus();
  }
  function closeSearch() {
    searchPop.hidden = true;
    searchToggle.setAttribute("aria-expanded", "false");
    fitFilters();
    if (query) {
      $("search").value = "";
      query = "";
      renderGrid();
    }
  }
  searchToggle.addEventListener("click", () => (searchPop.hidden ? openSearch() : closeSearch()));
  $("search-close").addEventListener("click", () => {
    closeSearch();
    searchToggle.focus();
  });
  $("search").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
      searchToggle.focus();
    }
  });
  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest && e.target.closest("input, textarea, [contenteditable]");
    if (e.key === "/" && !typing && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      openSearch();
    }
  });

  // Hooks for cloud.js (accounts, stats and friends). Events fire on document
  // as "woometer:answer", "woometer:remove", "woometer:reset" and "woometer:detail".
  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent(`woometer:${name}`, { detail }));
  }

  window.Woometer = {
    getAnswers: () => ({ ...answers }),
    // Replace every answer at once, e.g. after loading them from an account.
    setAnswers(next) {
      answers = Object.fromEntries(Object.entries(next).filter(([id]) => byId[id]));
      save();
      renderAll();
    },
    toast,
    openDetail,
  };

  renderFilters();
  renderAll();
})();
