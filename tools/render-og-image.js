// Renders tools/og-image.html to icons/og-image.png (1200x630) with Playwright.
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto("file://" + path.join(__dirname, "og-image.html"));
  await page.screenshot({ path: path.join(__dirname, "..", "icons", "og-image.png") });
  await browser.close();
})();
