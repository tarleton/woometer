// Checks the numbered citations on every page that has a source list
// (<ol class="sources">), e.g. about.html. Run: node tools/check-citations.js
//
// Fails if:
// - the superscript numbers, read top to bottom, ever go backwards
//   (they must read 1, 2, 3, ... with a source re-cited only right after itself)
// - a new source is introduced out of turn (e.g. 1, 3 before 2)
// - a superscript points to a source that isn't in the list
// - a source in the list is never cited
// - the list entries aren't numbered ref-1, ref-2, ... in order
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pages = fs.readdirSync(root).filter((f) => f.endsWith(".html"));
let problems = 0;
const fail = (page, msg) => { problems++; console.error(`${page}: ${msg}`); };

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  const listStart = html.search(/<ol class="sources">/);
  if (listStart === -1) continue;

  const body = html.slice(0, listStart);
  const cites = [...body.matchAll(/<sup>([^<]*)<\/sup>/g)]
    .flatMap((m) => m[1].split(",").map((n) => Number(n.trim())));
  const listed = [...html.slice(listStart).matchAll(/<li id="ref-(\d+)">/g)].map((m) => Number(m[1]));

  listed.forEach((n, i) => { if (n !== i + 1) fail(page, `source list entry ${i + 1} is numbered ref-${n}`); });

  let last = 0, highest = 0;
  for (const n of cites) {
    if (!Number.isInteger(n) || n < 1) { fail(page, `bad citation number "${n}"`); continue; }
    if (n < last) fail(page, `citation ${n} comes after ${last}, so the numbers go backwards`);
    if (n > highest + 1) fail(page, `citation ${n} appears before ${highest + 1}`);
    if (!listed.includes(n)) fail(page, `citation ${n} has no source in the list`);
    last = n; highest = Math.max(highest, n);
  }
  for (const n of listed) if (!cites.includes(n)) fail(page, `source ${n} is never cited`);

  if (!problems) console.log(`${page}: ${cites.length} citations, ${listed.length} sources, all in order`);
}

if (problems) { console.error(`${problems} citation problem(s) found`); process.exit(1); }
