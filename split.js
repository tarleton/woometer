// How everyone answered a claim, as one bar, for the claim popup on the main
// page and on the stats page: Yes, Not Sure and No in the same order as the
// answer buttons under it, each with its share inside.
window.AnswerSplit = {
  // n of total as a whole percent. A share that would round to 0% or 100%
  // while others answered differently says <1% or >99% instead.
  share(n, total) {
    const p = Math.round((n / total) * 100);
    if (p === 0 && n > 0) return "<1%";
    if (p === 100 && n < total) return ">99%";
    return `${p}%`;
  },

  // counts: { yes, no, unsure }, at least one answer. mine: your answer, if
  // any, outlined like your button.
  bar(counts, mine) {
    const total = counts.yes + counts.no + counts.unsure;
    const share = (n) => this.share(n, total);
    const people = `${total.toLocaleString()} ${total === 1 ? "person" : "people"}`;
    const bar = document.createElement("span");
    bar.className = "answer-split";
    // Said in words for screen readers, as the line was before the bar.
    bar.setAttribute("role", "img");
    bar.setAttribute(
      "aria-label",
      counts.unsure
        ? `${share(counts.yes)} of ${people} said Yes, ${share(counts.no)} said No and ${share(counts.unsure)} aren't sure.`
        : `${share(counts.yes)} of ${people} said Yes and ${share(counts.no)} said No.`
    );
    const said = {
      yes: () => "said Yes",
      unsure: (n) => (n === 1 ? "isn't sure" : "aren't sure"),
      no: () => "said No",
    };
    for (const value of ["yes", "unsure", "no"]) {
      const n = counts[value];
      if (!n) continue;
      const part = document.createElement("span");
      part.className = value + "-part" + (value === mine ? " mine" : "");
      part.style.flexGrow = n;
      part.textContent = share(n);
      part.title = `${n.toLocaleString()} of ${total.toLocaleString()} ${said[value](n)}`;
      bar.append(part);
    }
    return bar;
  },
};
