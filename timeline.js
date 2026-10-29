// The timeline page: every claim placed in the era it first appeared, from
// eras.js. Each era opens like an accordion, so the page starts small, and
// tapping an idea opens its card with the date and where it comes from.
(function () {
  const STORAGE_KEY = "woometer.answers.v1";
  const $ = (id) => document.getElementById(id);

  // Era bands, oldest first. A claim belongs to the first band its year is
  // under; "Age-old" holds the ones with no single starting point.
  const AGES = [
    { name: "Age-old", end: null, blurb: "Roots too old or too widespread to date" },
    { name: "Before 500 BC", end: -500 },
    { name: "500 BC to 500 AD", end: 500 },
    { name: "500 to 1500", end: 1500 },
    { name: "1500s to 1700s", end: 1800 },
    { name: "1800s", end: 1900 },
    { name: "1900 to 1949", end: 1950 },
    { name: "1950s", end: 1960 },
    { name: "1960s", end: 1970 },
    { name: "1970s", end: 1980 },
    { name: "1980s", end: 1990 },
    { name: "1990s", end: 2000 },
    { name: "2000s", end: 2010 },
    { name: "2010s", end: 2020 },
    { name: "2020s", end: Infinity },
  ];
  const PILE = { yes: ["✨", "Believe It"], no: ["🗑️", "Trash Bin"], unsure: ["🤷", "Not Sure"] };

  function savedAnswers() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  // A rough date like "1870s" sorts at the start of its decade, so the list
  // reads in order (1870s, 1870, 1875) rather than by the guess behind it.
  function sortKey(era) {
    const decade = /^(?:early )?(\d{3,4})s$/.exec(era.when);
    return decade ? Number(decade[1]) : era.y;
  }

  const ideas = CLAIMS.filter((c) => ERAS[c.id]).map((c) => ({ claim: c, era: ERAS[c.id], key: sortKey(ERAS[c.id]) }));
  const groups = AGES.map((age) => ({ age, ideas: [] }));
  for (const idea of ideas) {
    const y = idea.key;
    const g = y === null ? groups[0] : groups.find((g, i) => i > 0 && y < g.age.end);
    g.ideas.push(idea);
  }
  for (const g of groups) {
    g.ideas.sort((a, b) => (a.key ?? 0) - (b.key ?? 0) || /s$/.test(b.era.when) - /s$/.test(a.era.when) || a.claim.name.localeCompare(b.claim.name));
  }
  const most = Math.max(...groups.map((g) => g.ideas.length));

  function render() {
    const answers = savedAnswers();
    $("ages").replaceChildren(
      ...groups.filter((g) => g.ideas.length).map((g) => {
        const li = document.createElement("li");
        li.className = "age";

        const head = document.createElement("button");
        head.type = "button";
        head.className = "age-head";
        head.setAttribute("aria-expanded", "false");
        const n = g.ideas.length;
        head.innerHTML = `<span class="age-title"><span class="age-name"></span><span class="age-count"></span><span class="age-chev" aria-hidden="true">›</span></span><span class="age-bar" aria-hidden="true"><i></i></span><span class="age-peek"></span>`;
        head.querySelector(".age-name").textContent = g.age.name;
        head.querySelector(".age-count").textContent = `${n} ${n === 1 ? "idea" : "ideas"}`;
        head.querySelector(".age-bar i").style.width = `${Math.max(4, (n / most) * 100)}%`;
        head.querySelector(".age-peek").textContent = g.age.blurb || g.ideas.slice(0, 4).map((i) => i.claim.name).join(", ") + (n > 4 ? ", …" : "");

        const list = document.createElement("ul");
        list.className = "age-list";
        list.hidden = true;
        list.append(
          ...g.ideas.map((idea) => {
            const item = document.createElement("li");
            const b = document.createElement("button");
            b.type = "button";
            b.className = "idea";
            const cat = CATEGORIES[idea.claim.category];
            b.innerHTML = `<span class="idea-when"></span><span class="idea-text"><span class="idea-name"></span><span class="idea-note"></span></span><span class="idea-mine"></span>`;
            b.querySelector(".idea-when").textContent = idea.era.when;
            b.querySelector(".idea-name").textContent = `${cat.icon} ${idea.claim.name}`;
            b.querySelector(".idea-note").textContent = idea.era.note;
            const pile = PILE[answers[idea.claim.id]];
            if (pile) {
              const mine = b.querySelector(".idea-mine");
              mine.textContent = pile[0];
              mine.title = `In your ${pile[1]}`;
              mine.setAttribute("aria-label", `In your ${pile[1]}`);
            }
            b.addEventListener("click", () => openCard(idea));
            item.append(b);
            return item;
          })
        );

        head.addEventListener("click", () => {
          const open = list.hidden;
          list.hidden = !open;
          li.classList.toggle("open", open);
          head.setAttribute("aria-expanded", String(open));
        });

        li.append(head, list);
        return li;
      })
    );
  }

  function openCard(idea) {
    const { claim, era } = idea;
    const cat = CATEGORIES[claim.category];
    $("detail-cat").textContent = `${cat.icon} ${cat.label}`;
    $("detail-name").textContent = claim.name;
    $("detail-when").textContent = era.when;
    $("detail-note").textContent = era.note;
    $("detail-roots").textContent = era.roots ? `Grew from: ${era.roots}` : "";
    $("detail-about").textContent = claim.about || "";
    $("detail-verdict").textContent = claim.verdict;
    $("detail-link").href = claim.link;
    $("detail-src-wrap").hidden = !era.src;
    if (era.src) $("detail-src").href = era.src;
    const pile = PILE[savedAnswers()[claim.id]];
    $("detail-yours").textContent = pile ? `${pile[0]} It's in your ${pile[1]}.` : "You haven't answered this one yet.";
    $("detail").showModal();
  }

  render();
  // Answers given in another tab show up here too.
  window.addEventListener("storage", (e) => e.key === STORAGE_KEY && render());
})();
