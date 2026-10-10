// Renders the top-bar logo from index.html and styles.css to logo.png (wide)
// and logo-square.png (1024x1024, for app icons) with Playwright.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const logo = fs.readFileSync(path.join(root, "index.html"), "utf8").match(/<h1 class="logo"[\s\S]*?<\/h1>/)[0];
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const page = (extra) => `<!doctype html><html><head><style>${css}</style><style>
  html, body { margin: 0; background: transparent; }
  .brand h1 { font-family: Inter, system-ui, sans-serif; white-space: nowrap; }
  ${extra}</style></head><body><div class="brand" id="box">${logo}</div></body></html>`;

(async () => {
  const browser = await chromium.launch();
  // Wide: the wordmark on the site's dark background, with room for the glow.
  let p = await browser.newPage({ viewport: { width: 2000, height: 600 } });
  await p.setContent(page(`
    #box { display: inline-block; background: #15111c; padding: 70px 90px 80px; }
    .brand h1 { font-size: 220px; }`));
  await p.locator("#box").screenshot({ path: path.join(root, "logo.png") });
  // Square: the same wordmark centred (nudged up to sit on the optical middle).
  p = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await p.setContent(page(`
    #box { width: 1024px; height: 1024px; display: flex; align-items: center; justify-content: center; background: #15111c; }
    .brand h1 { font-size: 160px; transform: translateY(-5px); }`));
  await p.screenshot({ path: path.join(root, "logo-square.png") });
  await browser.close();
})();
