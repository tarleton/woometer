# Woometer

A place to measure your woo. Live at [woometer.com](https://woometer.com).

The page is a grid of well-known pseudoscience, paranormal, conspiracy and religious claims. Click **Yes** if you believe it or **No** if you don't, and the card flies into your **Woo Pile** or your **Trash Bin**. The meter at the top shows what percentage of your answers were Yes: how hoodwinked you are. Next to the meter is a cartoon cat that gets one step scruffier for every 5% (21 stages, drawn as inline SVG in [`cat.js`](cat.js)): a professor in glasses and a tie at 0%, a tinfoil-hatted furball at 100%. Tap anything in a pile to read what the evidence says, or to put it back on the board.

Answers are saved in the visitor's own browser (`localStorage`). There is no backend, no account and no tracking.

## Running it locally

It's plain HTML, CSS and JavaScript with no build step. Open `index.html` directly, or serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Adding or editing claims

Everything on the grid comes from [`claims.js`](claims.js). Each claim looks like this:

```js
{
  id: "astrology",            // unique, and never rename it once live (saved answers use it)
  name: "Astrology",          // card title
  category: "divination",     // a key from CATEGORIES at the top of the file
  question: "Do the positions of the planets ...?",
  verdict: "What the evidence says, in a sentence or two.",
  link: "https://en.wikipedia.org/wiki/Astrology_and_science",
},
```

New categories go in `CATEGORIES` at the top of the same file.

## Hosting on GitHub Pages

1. In the repo, go to **Settings → Pages** and set the source to **Deploy from a branch**, branch `main`, folder `/ (root)`.
2. The `CNAME` file already points Pages at `woometer.com`. At your domain registrar, add the DNS records GitHub lists in [Managing a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) (four `A` records for the apex, and a `CNAME` for `www` pointing at `tarleton.github.io`).
   - **DreamHost:** in the panel, set woometer.com to **DNS only** hosting (so DreamHost stops serving its own page), then under **Websites → Manage Websites → DNS** add `A` records for `woometer.com` pointing to `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`, and a `CNAME` record for `www` pointing to `tarleton.github.io.`. Remove any old `A` records DreamHost created for the domain.
3. Once DNS resolves, tick **Enforce HTTPS** on the Pages settings page.

Any other static host (Netlify, Cloudflare Pages, S3) works too: upload the folder as is.
