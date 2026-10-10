// Builds world-map.js (the map on /stats), plus tools/country-continents.sql,
// the values to paste into country_continents in supabase/schema.sql. Run it only to change the map; the site never needs it.
//   npm i world-atlas@2.0.2 world-countries@5.1.0 topojson-client@3.1.0 d3-geo@3.1.1
//   node tools/build-world-map.js
const fs = require("fs");
const path = require("path");
const topojson = require("topojson-client");
const { geoNaturalEarth1, geoPath } = require("d3-geo");
const world = require("world-atlas/countries-110m.json");
const countries = require("world-countries/countries.json");

const W = 1000;
const CONTINENTS = {
  "north-america": "North America",
  "south-america": "South America",
  europe: "Europe",
  africa: "Africa",
  asia: "Asia",
  oceania: "Oceania",
};

function continentOf(c) {
  if (c.region === "Americas") return c.subregion === "South America" ? "south-america" : "north-america";
  return { Europe: "europe", Africa: "africa", Asia: "asia", Oceania: "oceania" }[c.region] || null;
}

const byNumeric = Object.fromEntries(countries.map((c) => [c.ccn3, c]));
// Shapes on the map with no numeric code.
const UNNUMBERED = { "N. Cyprus": "asia", Somaliland: "africa", Kosovo: "europe" };
const land = topojson.feature(world, world.objects.countries);
land.features = land.features.filter((f) => f.properties.name !== "Antarctica");

const projection = geoNaturalEarth1().fitWidth(W, land);
const pathFor = geoPath(projection);
const [[, y0], [, y1]] = pathFor.bounds(land);
const H = Math.ceil(y1 - y0);
projection.translate([projection.translate()[0], projection.translate()[1] - y0]);
const round = (d) => d.replace(/(\d+\.\d)\d+/g, "$1");

// One merged outline per continent, so a tap anywhere in it picks the continent.
const shapes = {};
for (const key of Object.keys(CONTINENTS)) {
  const geoms = world.objects.countries.geometries.filter((g) => {
    const c = byNumeric[g.id];
    return (c ? continentOf(c) : UNNUMBERED[g.properties.name]) === key;
  });
  shapes[key] = round(pathFor(topojson.merge(world, geoms)));
}

// Where each country's star goes, and its continent: { CL: [x, y, "south-america"] }.
const points = {};
for (const c of countries) {
  const key = continentOf(c);
  if (!key || !c.latlng || !c.latlng.length) continue;
  const [x, y] = projection([c.latlng[1], c.latlng[0]]);
  points[c.cca2] = [Math.round(x), Math.round(y), key];
}

const out = `// Made by tools/build-world-map.js from Natural Earth (via world-atlas) and
// world-countries. Don't edit by hand.
window.WORLD_MAP = ${JSON.stringify({ width: W, height: H, continents: CONTINENTS, shapes, points })};
`;
fs.writeFileSync(path.join(__dirname, "..", "world-map.js"), out);

// The same continents for the database, as SQL values.
const rows = Object.entries(points).map(([code, [, , key]]) => `('${code}', '${key}')`);
const lines = [];
for (let i = 0; i < rows.length; i += 10) lines.push("  " + rows.slice(i, i + 10).join(", "));
fs.writeFileSync(path.join(__dirname, "country-continents.sql"), lines.join(",\n") + "\n");
console.log(`world-map.js: ${(out.length / 1024).toFixed(0)} KB, ${H}px tall, ${rows.length} countries`);
