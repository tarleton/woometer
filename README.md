# Woometer

A place to measure your woo. Live at [woometer.com](https://woometer.com).

The page is a grid of well-known pseudoscience, paranormal, conspiracy and religious claims. Click **Yes** if you believe it or **No** if you don't, and the card flies into your **Woo Pile** or your **Trash Bin**. The meter at the top shows your woo score, the percentage of your answers that were Yes, and how much of the list you reject. Most people turn down most of it. Next to the meter is a cartoon cat that changes every 5% (21 different cats, drawn as inline SVG in [`cat.js`](cat.js)): a professor with a book at 0%, through crystals, tarot, wands and D&D dice, up to a UFO pilot at 100%. Click the cat to see them all. Tap anything in a pile to read what the evidence says, or to put it back on the board.

Answers are saved in the visitor's own browser (`localStorage`). When Supabase is configured (see below), they are also saved to the visitor's Supabase user, which powers the "N% of people agree" numbers, friend comparisons and optional Google sign-in. With no Supabase settings the site runs entirely in the browser.

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

## Accounts, stats and friends (Supabase)

[`cloud.js`](cloud.js) adds three things on top of the static site:

- **Everyone is saved, nobody has to sign up.** Each visitor quietly gets an anonymous Supabase user. **Sign in with Google** links that same user to a Google account, so answers and friends carry over and follow you to other devices.
- **"N% of people agree with you"** after each answer, and Yes/No totals in each claim's detail view.
- **Shared links and friends.** Everyone has a link (`woometer.com/?f=CODE`), copied by Share or from the Friends popup. Opening someone's link shows their woo score and Woo Pile and lets you compare, without adding anyone. Adding a friend is a deliberate tap: "Add as a Friend" on their link, or pasting their link in the Friends popup. Adding a friend needs Google sign-in (when `googleSignIn` is on), so friends stay with the account; someone not signed in is asked to sign in, and the add finishes when they come back from Google. That puts each of you in the other's friend list. Clicking a friend shows the percentage of claims you agree on, differ on, and haven't both answered (out of every claim currently on the list, so the three add up to 100 as new claims are added), plus the list of differences.

Answers are stored by claim `id`, so adding claims needs no database change.

### Setting it up

1. Create a Supabase project. Under **Authentication → Sign In / Providers**, turn on **Anonymous sign-ins** and **Allow manual linking** (that's what lets Google sign-in keep the anonymous user's answers).
2. Under **Authentication → URL Configuration**, set the Site URL to `https://woometer.com`.
3. Open the **SQL editor**, paste in all of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. It creates the tables, row-level security rules and functions, and is safe to run again after changes.
4. Set up Google: create an OAuth client (type *Web application*) in Google Cloud Console with `https://woometer.com` as a JavaScript origin and the callback URL from Supabase's Google provider page as the redirect URI, then paste the client ID and secret into that Supabase page and enable it. Also add `https://woometer.com` as a redirect URI and put the client ID (public) in `googleClientId` in [`config.js`](config.js): sign-in then goes straight from woometer.com to Google and back with an ID token (`signInWithIdToken`), so Google's screens say "woometer.com" instead of the Supabase project's address. Without it, sign-in goes through Supabase's own redirect.
5. Put the **Project URL** and the **anon public** key (Supabase → Project Settings → API) into [`config.js`](config.js). Both are meant to be public. Never put the `service_role` key, database password or Google client secret in this repo.

## Hosting on GitHub Pages

1. In the repo, go to **Settings → Pages** and set the source to **Deploy from a branch**, branch `main`, folder `/ (root)`.
2. The `CNAME` file already points Pages at `woometer.com`. At your domain registrar, add the DNS records GitHub lists in [Managing a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) (four `A` records for the apex, and a `CNAME` for `www` pointing at `tarleton.github.io`).
   - **DreamHost:** in the panel, set woometer.com to **DNS only** hosting (so DreamHost stops serving its own page), then under **Websites → Manage Websites → DNS** add `A` records for `woometer.com` pointing to `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`, and a `CNAME` record for `www` pointing to `tarleton.github.io.`. Remove any old `A` records DreamHost created for the domain.
3. Once DNS resolves, tick **Enforce HTTPS** on the Pages settings page.

Any other static host (Netlify, Cloudflare Pages, S3) works too: upload the folder as is.
