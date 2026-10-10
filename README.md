# Woometer

A place to measure your woo. Live at [woometer.com](https://woometer.com).

The page is a grid of well-known pseudoscience, paranormal, conspiracy and religious claims. Click **Yes** if you believe it or **No** if you don't, and the card flies into your **Believe It** list or your **Trash Bin**. Not sure? **Don't Know** puts it in a third pile that doesn't count toward your woo. The meter at the top shows how woo you are, the percentage of your Yes and No answers that were Yes, and how much of the list you reject. Most people turn down most of it. Next to the meter is a cartoon cat that changes every 5% (21 different cats, drawn as inline SVG in [`cat.js`](cat.js)): a professor with a book at 0%, through crystals, tarot, wands and D&D dice, up to a UFO pilot at 100%. Click the cat to see them all. Tap anything in a pile to read what the evidence says, or to put it back on the board.

Answers are saved in the visitor's own browser (`localStorage`). When Supabase is configured (see below), they are also saved to the visitor's Supabase user, which powers the "N% of people agree" numbers, friend comparisons and optional Google or Facebook sign-in. With no Supabase settings the site runs entirely in the browser.

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

[`cloud.js`](cloud.js) adds these on top of the static site:

- **Everyone is saved, nobody has to sign up.** Each visitor quietly gets an anonymous Supabase user. **Sign in** (Google or Facebook) links that same user to that account, so answers and friends carry over and follow you to other devices. With both turned on, the Sign in button opens a small chooser. If the Google or Facebook account already has its own woometer account, sign-in switches to it and the answers from this browser are merged in. Someone signed in with Google can also choose **Link Facebook** in the account menu, so either one signs in to the same account (it never switches accounts: a Facebook login that already has its own woometer account is left alone, with a short note). If the browser loses supabase-js's copy of the sign-in mid-visit (seen once on an iPhone), `cloud.js` puts the same sign-in back from its own spare copy (`woometer.session.v1`) and re-sends any answers that didn't get through, so the account and share link stay the same.
- **"N% of people agree with you"** after each answer, and Yes/No/Don't Know totals in each claim's detail view. A Don't Know on either side counts as "not both answered" in friend comparisons.
- **Shared links and friends.** Everyone has a link (`woometer.com/?f=CODE`). Share opens a box with your name and ways to send it (your woo % plus the link, just the link, or the phone's share sheet); it asks for a name first, since the link shows it. Opening someone's link shows their woo % and Believe It list and lets you compare, without adding anyone. Adding a friend is a deliberate tap: "Add as a Friend" on their link, or pasting their link in the Friends popup. Anyone can add a friend, signed in or not (it needs a name, typed or from Google or Facebook). That puts each of you in the other's friend list. Someone not signed in sees a gentle note that signing in keeps their friends safe on any device; friends added in a browser are re-added if it later signs in to an existing account, and if they pick Google or Facebook in the name box, the add finishes when they come back. Clicking a friend shows their woo meter and yours side by side at the top (gauge, cat, cat, gauge, so the two cats sit together; on phones the cats sit above the two gauges); tapping either gauge turns both over to pies of the answers. Then one line says how much you agree, out of the claims you've both answered Yes or No (Don't Know and unanswered claims are left out), with both woo percentages in small type beside it and lists of where you agree and differ below. Each friend in the list shows that percentage too.
- **Delete my account** in the signed-in account menu permanently deletes the sign-in, and with it the profile, answers and friend rows (the `delete_my_account` function in `supabase/schema.sql`). **Delete all answers** deletes just the answers. It's kept out of the way: in red in the account menu above Delete my account when signed in, otherwise linked from the Privacy page (`./?delete=answers` opens the confirmation on the main page). Both confirmations count down 3, 2, 1 before the Delete button works.

Answers are stored by claim `id`, so adding claims needs no database change.

### Setting it up

1. Create a Supabase project. Under **Authentication → Sign In / Providers**, turn on **Anonymous sign-ins** and **Allow manual linking** (that's what lets Google sign-in keep the anonymous user's answers).
2. Under **Authentication → URL Configuration**, set the Site URL to `https://woometer.com`.
3. Open the **SQL editor**, paste in all of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. It creates the tables, row-level security rules and functions, and is safe to run again after changes.
4. Set up Google: create an OAuth client (type *Web application*) in Google Cloud Console with `https://woometer.com` as a JavaScript origin and the callback URL from Supabase's Google provider page as the redirect URI, then paste the client ID and secret into that Supabase page and enable it. Also add `https://woometer.com` as a redirect URI and put the client ID (public) in `googleClientId` in [`config.js`](config.js): sign-in then goes straight from woometer.com to Google and back with an ID token (`signInWithIdToken`), so Google's screens say "woometer.com" instead of the Supabase project's address. Without it, sign-in goes through Supabase's own redirect.
5. Set up Facebook (optional): in the Meta app (developers.facebook.com) add the use case **Authenticate and request data from users with Facebook Login** with the `email` permission, put `https://jtzwtqzsevsiuyobkvaw.supabase.co/auth/v1/callback` under **Facebook Login → Settings → Valid OAuth Redirect URIs**, set the App domain to `woometer.com` and the Privacy Policy and User data deletion URLs to `https://woometer.com/privacy`, add the square logo as the app icon, answer the data handling questions and **Publish** the app (until then only the app's own admins can sign in). Then paste the App ID and App Secret into Supabase's Facebook provider page, turn on **Allow users without an email**, enable it, and set `facebookSignIn: true` in [`config.js`](config.js). Facebook sign-in goes through Supabase's redirect; Facebook's screen names the Meta app (woometer). Before the flag is on, `woometer.com/?facebook=1` turns Facebook sign-in on for that browser tab only, for Meta's app reviewers.
6. Put the **Project URL** and the **anon public** key (Supabase → Project Settings → API) into [`config.js`](config.js). Both are meant to be public. Never put the `service_role` key, database password, Google client secret or Facebook app secret in this repo.

### Spam check (Cloudflare Turnstile)

New sign-ins can require a Cloudflare Turnstile token, so bots can't create piles of anonymous users and skew the stats. Put the Turnstile **site key** (public) in `turnstileSiteKey` in [`config.js`](config.js) first, then in Supabase under **Authentication → Attack Protection** turn on CAPTCHA protection, choose Turnstile and paste the **secret key** there (never in this repo). In that order nothing breaks: with the key set but CAPTCHA off, Supabase ignores the token.

### Keeping the free plan awake

Supabase's free plan pauses a project after about a week with no activity. [`.github/workflows/keep-supabase-awake.yml`](.github/workflows/keep-supabase-awake.yml) makes one tiny read three times a week. GitHub turns scheduled workflows off after 60 days with no commits; if that happens, re-enable it under the repo's **Actions** tab.

## Link previews

`index.html` has Open Graph and Twitter tags pointing at [`icons/og-image.png`](icons/og-image.png). Its source is [`tools/og-image.html`](tools/og-image.html); re-render it with `node tools/render-og-image.js` (needs Playwright).

## Logo

The top-bar logo is also a PNG at [`woometer.com/logo.png`](logo.png) (wide) and [`woometer.com/logo-square.png`](logo-square.png) (1024x1024, for app icons). Both are rendered from the logo in `index.html` and `styles.css`; re-render them with `node tools/render-logo.js` (needs Playwright).

## Hosting on GitHub Pages

1. In the repo, go to **Settings → Pages** and set the source to **Deploy from a branch**, branch `main`, folder `/ (root)`.
2. The `CNAME` file already points Pages at `woometer.com`. At your domain registrar, add the DNS records GitHub lists in [Managing a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) (four `A` records for the apex, and a `CNAME` for `www` pointing at `<your-github-username>.github.io`).
   - **DreamHost:** in the panel, set woometer.com to **DNS only** hosting (so DreamHost stops serving its own page), then under **Websites → Manage Websites → DNS** add `A` records for `woometer.com` pointing to `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`, and a `CNAME` record for `www` pointing to `<your-github-username>.github.io.`. Remove any old `A` records DreamHost created for the domain.
3. Once DNS resolves, tick **Enforce HTTPS** on the Pages settings page.

Any other static host (Netlify, Cloudflare Pages, S3) works too: upload the folder as is.
