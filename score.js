// The woo score, shared by every page: the share of all your answers that are
// Yes. Don't Know counts as an answer, so it pulls the score down just like No.
// The stats page's database functions (site_stats, map_stats) use the same rule.
window.WooScore = {
  // values: a list of "yes" / "no" / "unsure" answers.
  of(values) {
    const woo = values.filter((v) => v === "yes").length;
    const trash = values.filter((v) => v === "no").length;
    const unsure = values.filter((v) => v === "unsure").length;
    const answered = woo + trash + unsure;
    const share = (n) => (answered ? Math.round((n / answered) * 100) : 0);
    // decided: Yes and No answers only, for the "at least 10" stats rule.
    return { answered, decided: woo + trash, woo, trash, unsure, pct: share(woo), rejectPct: share(trash), fraction: answered ? woo / answered : 0 };
  },
};
