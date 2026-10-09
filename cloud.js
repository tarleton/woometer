// Accounts, "N% of people agree" stats and friend comparisons, backed by Supabase.
//
// Every visitor quietly gets an anonymous Supabase user, so stats and friend
// links work with no sign-up. Signing in with Google links that same user, so
// nothing is lost and answers follow you to other devices. If config.js has no
// Supabase settings, or Supabase can't be reached, this file does nothing and
// the site keeps working from localStorage alone.
(function () {
  const cfg = window.WOOMETER_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.Woometer) return;

  const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js";
  const FRIEND_CODES_KEY = "woometer.friendCodes.v1";
  const LAST_USER_KEY = "woometer.lastUser.v1";
  // The friend someone was adding when they left to sign in with Google.
  const PENDING_FRIEND_KEY = "woometer.pendingFriend.v1";
  // Set just before the reload that follows "Delete my account", to say it worked.
  const DELETED_KEY = "woometer.accountDeleted";
  const TURNSTILE_JS = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
  // Per-tab check values for a trip to Google's sign-in page and back.
  const GOOGLE_TRIP_KEY = "woometer.googleTrip.v1";

  const $ = (id) => document.getElementById(id);
  const byId = Object.fromEntries(CLAIMS.map((c) => [c.id, c]));
  const W = window.Woometer;

  let db = null;
  let user = null;
  let profile = { display_name: null, share_code: null };

  loadScript(SUPABASE_JS)
    .then(start)
    .catch((err) => {
      console.warn("Woometer: accounts are off.", err);
      showProblem(err);
    });

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.append(s);
    });
  }

  async function start() {
    // Read Google's reply before supabase-js looks at the address bar.
    const google = takeGoogleReply();
    db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

    // Linking Google to this browser's anonymous user fails when that Google
    // account already has its own Woometer user (say, from another device).
    // Then sign in to that user instead; the answers in this browser get merged in.
    const params = new URLSearchParams(location.hash.slice(1) + "&" + location.search.slice(1));
    if (params.get("error_code") === "identity_already_exists") {
      history.replaceState(null, "", location.pathname);
      await db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: homeUrl() } });
      return;
    }

    let { data } = await db.auth.getSession();
    let googleProblem = null;
    if (google) {
      googleProblem = await useGoogleToken(google, data.session);
      ({ data } = await db.auth.getSession());
    }
    if (!data.session) {
      const res = await db.auth.signInAnonymously({ options: await captcha() });
      if (res.error) throw res.error;
      data = res.data;
    }
    user = data.session.user;

    const { data: rows, error } = await db.rpc("ensure_profile");
    if (error) throw error;
    profile = rows[0];
    if (!profile.display_name && !user.is_anonymous) {
      const meta = user.user_metadata || {};
      const name = (meta.full_name || meta.name || "").trim();
      if (name) await setName(name);
    }

    await syncAnswers();
    wireEvents();
    renderAccount();
    $("friends-open").hidden = false;
    $("my-name").value = profile.display_name || "";
    $("foot-note").textContent = user.is_anonymous
      ? "Your answers are saved anonymously so you can see what others think and compare with friends."
      : "Your answers are saved to your account.";
    if (googleProblem) {
      const detail = googleProblem.message || googleProblem.code || String(googleProblem);
      $("foot-note").textContent = `Google sign-in didn't work, so you're not signed in. (${detail})`;
    }
    try {
      if (sessionStorage.getItem(DELETED_KEY)) {
        sessionStorage.removeItem(DELETED_KEY);
        W.toast("Your account and everything in it are deleted.");
      }
    } catch {}

    await handleInvite();
    await refreshFriends();
    await finishPendingFriend();
  }

  // Spam check (Cloudflare Turnstile). Supabase asks for a fresh token on
  // every new sign-in once CAPTCHA protection is on in its Auth settings.
  // With no turnstileSiteKey in config.js this returns {} and nothing changes.
  // Most visitors never see it; Cloudflare only shows a checkbox when unsure.
  let turnstileLoad = null;
  async function captcha() {
    if (!cfg.turnstileSiteKey) return {};
    try {
      turnstileLoad = turnstileLoad || loadScript(TURNSTILE_JS);
      await turnstileLoad;
      return { captchaToken: await turnstileToken() };
    } catch (err) {
      // Sign in without a token: works while CAPTCHA is off in Supabase.
      console.warn("Woometer: spam check didn't load.", err);
      return {};
    }
  }

  function turnstileToken() {
    return new Promise((resolve, reject) => {
      let box = $("captcha");
      if (box) box.remove();
      box = document.createElement("div");
      box.id = "captcha";
      box.className = "captcha";
      document.body.append(box);
      const done = (fn, value) => {
        clearTimeout(timer);
        box.remove();
        fn(value);
      };
      const timer = setTimeout(() => done(reject, new Error("Spam check timed out")), 120000);
      window.turnstile.render(box, {
        sitekey: cfg.turnstileSiteKey,
        appearance: "interaction-only",
        callback: (token) => done(resolve, token),
        "error-callback": (code) => done(reject, new Error(`Spam check failed (${code})`)),
      });
    });
  }

  function homeUrl() {
    return location.origin + location.pathname;
  }

  // Answers

  // Merge this browser's answers with the account's. This browser wins where
  // both have an answer, since it holds whatever was clicked most recently here.
  async function syncAnswers() {
    const { data, error } = await db.from("answers").select("claim_id, answer").eq("user_id", user.id).range(0, 9999);
    if (error) throw error;
    const server = Object.fromEntries(data.map((r) => [r.claim_id, r.answer]));
    const local = W.getAnswers();
    const toSend = Object.entries(local)
      .filter(([id, value]) => server[id] !== value)
      .map(([id, value]) => row(id, value));
    if (toSend.length) await saveRows(toSend);
    W.setAnswers({ ...server, ...local });
  }

  // Don't Know answers are saved in their own batch. Until supabase/schema.sql
  // has been re-run, the database refuses them; then the claim's old Yes or No
  // is removed instead, so the server doesn't keep an answer that was changed.
  // Returns the error from saving Yes and No answers, if any.
  async function saveRows(rows) {
    const sure = rows.filter((r) => r.answer !== "unsure");
    const unsure = rows.filter((r) => r.answer === "unsure");
    if (sure.length) {
      const { error } = await db.from("answers").upsert(sure);
      if (error) return error;
    }
    if (unsure.length) {
      const { error } = await db.from("answers").upsert(unsure);
      if (error) {
        console.warn("Woometer: the database doesn't take Don't Know answers yet.", error);
        await db.from("answers").delete().eq("user_id", user.id).in("claim_id", unsure.map((r) => r.claim_id));
      }
    }
    return null;
  }

  function row(id, value) {
    return { user_id: user.id, claim_id: id, answer: value, updated_at: new Date().toISOString() };
  }

  function wireEvents() {
    document.addEventListener("woometer:answer", async (e) => {
      const { id, value } = e.detail;
      const error = await saveRows([row(id, value)]);
      if (error) return logError({ error });
      const s = await statsFor(id);
      // No Don't Know count means the database isn't counting them yet.
      if (!s || (value === "unsure" && !s.unsure)) return;
      const total = s.yes + s.no + s.unsure;
      const people = `${total.toLocaleString()} people`;
      if (total <= 1) W.toast("You're the first to answer this one.");
      else if (value === "unsure") W.toast(`${pct(s.unsure, total)}% of ${people} don't know either.`);
      else W.toast(`${pct(s[value], total)}% of ${people} agree with you.`);
    });

    document.addEventListener("woometer:remove", (e) => {
      db.from("answers").delete().eq("user_id", user.id).eq("claim_id", e.detail.id).then(logError);
    });

    document.addEventListener("woometer:reset", () => {
      db.from("answers").delete().eq("user_id", user.id).then(logError);
    });

    document.addEventListener("woometer:detail", async (e) => {
      const el = $("detail-stats");
      const id = e.detail.id;
      el.hidden = false;
      el.textContent = "Counting everyone's answers…";
      const s = await statsFor(id);
      let mine = W.getAnswers()[id];
      if (!s) {
        el.hidden = true;
        return;
      }
      const total = s.yes + s.no + s.unsure;
      const people = `${total.toLocaleString()} ${total === 1 ? "person" : "people"}`;
      const split = s.unsure
        ? `${pct(s.yes, total)}% of ${people} said Yes, ${pct(s.no, total)}% said No and ${pct(s.unsure, total)}% don't know.`
        : `${pct(s.yes, total)}% of ${people} said Yes and ${pct(s.no, total)}% said No.`;
      // A database that isn't counting Don't Know yet hasn't counted yours either.
      if (mine === "unsure" && !s.unsure) mine = null;
      if (!mine) el.textContent = total ? split : "Nobody has answered this one yet.";
      else if (total <= 1) el.textContent = "You're the only one who has answered this so far.";
      else if (mine === "unsure") el.textContent = split;
      else el.textContent = `${split} ${pct(s[mine], total)}% agree with you.`;
    });

    $("google-login").addEventListener("click", signInWithGoogle);
    $("signin-google").addEventListener("click", () => {
      savePendingFriend($("signin-prompt").dataset.code, $("signin-prompt").dataset.name);
      signInWithGoogle();
    });
    $("friends-open").addEventListener("click", () => {
      $("friends").showModal();
      refreshFriends();
    });
    $("avatar").addEventListener("click", (e) => {
      e.stopPropagation();
      setMenu($("account-menu").hidden);
    });
    document.addEventListener("click", (e) => {
      if (!$("account").contains(e.target)) setMenu(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setMenu(false);
    });
    $("sign-out").addEventListener("click", signOut);
    $("delete-account").addEventListener("click", () => {
      setMenu(false);
      $("delete-dialog").showModal();
    });
    $("delete-confirm").addEventListener("click", deleteAccount);
    $("copy-friend-link").addEventListener("click", copyFriendLink);
    $("add-friend-btn").addEventListener("click", addFriendFromInput);
    $("add-friend-link").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addFriendFromInput();
      }
    });
    $("my-name").addEventListener("change", (e) => setName(e.target.value));
    $("invite-name").addEventListener("change", (e) => {
      setName(e.target.value);
      $("my-name").value = e.target.value;
    });
    $("invite-close").addEventListener("click", () => ($("invite").hidden = true));
    W.shareUrl = friendLink;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshFriends();
    });
  }

  async function statsFor(id) {
    const { data, error } = await db.rpc("claim_stats", { only_ids: [id] });
    if (error) return logError({ error });
    const r = data[0];
    // unsure is missing until supabase/schema.sql has been re-run.
    return r ? { yes: Number(r.yes), no: Number(r.no), unsure: Number(r.unsure || 0) } : { yes: 0, no: 0, unsure: 0 };
  }

  function pct(n, total) {
    return total ? Math.round((n / total) * 100) : 0;
  }

  function logError(res) {
    if (res && res.error) {
      console.warn(res.error);
      showProblem(res.error);
    }
    return null;
  }

  // Say so on the page when the server can't be reached, so problems are
  // visible without opening the browser console.
  function showProblem(err) {
    const detail = (err && (err.message || err.msg || err.code)) || String(err);
    $("foot-note").textContent =
      `Couldn't reach the Woometer server, so your answers are only saved in this browser for now. (${detail})`;
  }

  // Account

  function renderAccount() {
    const anon = user.is_anonymous;
    // The sign-in button stays hidden until the Google provider is set up in
    // Supabase (googleSignIn in config.js).
    $("google-login").hidden = !anon || !cfg.googleSignIn;
    $("google-login").title = "Sign in with Google to keep your answers and friends on any device";
    $("account").hidden = anon;
    if (anon) return;

    const meta = user.user_metadata || {};
    const name = meta.full_name || meta.name || profile.display_name || "";
    const picture = meta.avatar_url || meta.picture;
    const avatar = $("avatar");
    if (picture) {
      const img = document.createElement("img");
      img.src = picture;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.onerror = () => (avatar.textContent = initial(name || user.email));
      avatar.replaceChildren(img);
    } else {
      avatar.textContent = initial(name || user.email);
    }
    $("account-name").textContent = name;
    $("account-email").textContent = user.email || "";
  }

  function initial(text) {
    return (text || "?").trim().charAt(0).toUpperCase();
  }

  function setMenu(open) {
    $("account-menu").hidden = !open;
    $("avatar").setAttribute("aria-expanded", String(open));
  }

  async function signInWithGoogle() {
    // crypto.subtle (for the nonce) only exists on https pages.
    if (cfg.googleClientId && window.crypto && crypto.subtle) return goToGoogle();
    const options = { redirectTo: homeUrl() };
    // Keep the same user so answers and friends carry over. linkIdentity needs
    // "manual linking" on in Supabase; without it, fall back to a plain sign-in.
    const { error } = await db.auth.linkIdentity({ provider: "google", options });
    if (error) await db.auth.signInWithOAuth({ provider: "google", options });
  }

  // Sign in on Google's own page and come straight back with an ID token, so
  // Google shows woometer.com as the site asking (not the Supabase address).
  async function goToGoogle() {
    const nonce = randomHex();
    const state = randomHex();
    try {
      sessionStorage.setItem(GOOGLE_TRIP_KEY, JSON.stringify({ nonce, state }));
    } catch {}
    const query = new URLSearchParams({
      client_id: cfg.googleClientId,
      redirect_uri: location.origin,
      response_type: "id_token",
      scope: "openid email profile",
      // Google puts this hash in the token; Supabase checks it against the nonce.
      nonce: await sha256Hex(nonce),
      state,
      prompt: "select_account",
    });
    location.assign(`${GOOGLE_AUTH}?${query}`);
  }

  // Back from Google: woometer.com/#id_token=…&state=… (or #error=… if they
  // backed out). Take it out of the address either way.
  function takeGoogleReply() {
    const reply = new URLSearchParams(location.hash.slice(1));
    if (!reply.has("state")) return null;
    let trip = null;
    try {
      trip = JSON.parse(sessionStorage.getItem(GOOGLE_TRIP_KEY));
      sessionStorage.removeItem(GOOGLE_TRIP_KEY);
    } catch {}
    if (!trip || reply.get("state") !== trip.state) return null;
    history.replaceState(null, "", location.pathname + location.search);
    const token = reply.get("id_token");
    return token ? { token, nonce: trip.nonce } : null;
  }

  // Link Google to this browser's anonymous user, so its answers stay put. If
  // that Google account already has a Woometer user (say, from another device),
  // sign in to that one instead; this browser's answers get merged in.
  async function useGoogleToken({ token, nonce }, session) {
    const creds = { provider: "google", token, nonce };
    if (session && session.user.is_anonymous) {
      const { error } = await db.auth.linkIdentity({ ...creds, options: await captcha() });
      if (!error) return null;
      console.warn("Woometer: linking Google failed, signing in instead.", error);
    }
    const { error } = await db.auth.signInWithIdToken({ ...creds, options: await captcha() });
    if (error) console.warn(error);
    return error || null;
  }

  function randomHex() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function sha256Hex(text) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function signOut() {
    await db.auth.signOut();
    startFresh();
  }

  // The answers live in the account; after signing out or deleting it, this
  // browser starts over as a new anonymous visitor.
  function startFresh() {
    W.setAnswers({});
    try {
      localStorage.removeItem(FRIEND_CODES_KEY);
      localStorage.removeItem(LAST_USER_KEY);
      localStorage.removeItem(PENDING_FRIEND_KEY);
    } catch {}
    location.replace(homeUrl());
  }

  // Deletes the sign-in itself; the database removes the profile, answers and
  // friend rows (both directions) along with it. See delete_my_account in
  // supabase/schema.sql.
  async function deleteAccount() {
    const button = $("delete-confirm");
    button.disabled = true;
    button.textContent = "Deleting…";
    const { error } = await db.rpc("delete_my_account");
    if (error) {
      console.warn(error);
      button.disabled = false;
      button.textContent = "Delete my account";
      $("delete-dialog").close();
      W.toast("Couldn't delete your account just now. Nothing was deleted; try again in a moment.");
      return;
    }
    // The session is already gone on the server, so only clear it here.
    await db.auth.signOut({ scope: "local" });
    try {
      sessionStorage.setItem(DELETED_KEY, "1");
    } catch {}
    startFresh();
  }

  async function setName(name) {
    const clean = name.trim().slice(0, 40);
    const { error } = await db.rpc("set_display_name", { new_name: clean });
    if (error) return logError({ error });
    profile.display_name = clean || null;
  }

  // Friends

  function friendCodes() {
    try {
      return JSON.parse(localStorage.getItem(FRIEND_CODES_KEY)) || [];
    } catch {
      return [];
    }
  }

  function rememberFriendCode(code) {
    try {
      const codes = friendCodes();
      if (!codes.includes(code)) localStorage.setItem(FRIEND_CODES_KEY, JSON.stringify(codes.concat(code)));
    } catch {}
  }

  // A shared link is woometer.com/?f=CODE (from Share or Copy my friend link).
  // Opening one only shows the sharer's results; adding them as a friend is a
  // separate tap. Friends added in this browser are remembered, so they can be
  // re-added when this browser switches to a different (existing) account.
  async function handleInvite() {
    const url = new URL(location.href);
    const code = url.searchParams.get("f");
    if (code) {
      url.searchParams.delete("f");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }

    let lastUser = null;
    try {
      lastUser = localStorage.getItem(LAST_USER_KEY);
      localStorage.setItem(LAST_USER_KEY, user.id);
    } catch {}
    if (lastUser && lastUser !== user.id) {
      for (const c of friendCodes()) {
        if (c !== code) await db.rpc("add_friend", { code: c });
      }
    }
    if (!code) return;

    if (code === profile.share_code) {
      W.toast("That's your own link. Send it to someone else!");
      return;
    }
    const { data: name } = await db.rpc("name_for_code", { code });
    const theirs = await answersForCode(code);
    const who = name || "Someone";
    const s = theirs && scoreOf(theirs);
    $("invite-title").textContent =
      s && s.answered
        ? `${who} is ${s.pct}% woo, rejecting ${100 - s.pct}% of the ${s.answered} claims they've answered.`
        : `${who} shared their Woometer with you.`;
    $("invite-text").textContent = "Answer some claims yourself to see where you agree and differ.";
    $("invite-compare").textContent = `See ${name ? `${name}'s` : "their"} answers`;
    $("invite-compare").hidden = !theirs;
    $("invite-compare").onclick = () => openCompare({ code, display_name: name });
    const add = $("invite-add");
    add.textContent = `Add ${name || "them"} as a Friend`;
    add.disabled = false;
    add.onclick = async () => {
      if (await addFriend(code, name)) {
        add.textContent = "Added to your friends ✓";
        add.disabled = true;
      }
    };
    $("invite-name-row").hidden = Boolean(profile.display_name);
    $("invite").hidden = false;
  }

  // Adding is mutual: you appear in their list too, so either of you can compare.
  // Friends belong to a Google account, so anyone not signed in is asked to
  // sign in first, and the add finishes when they come back.
  async function addFriend(code, name) {
    if (code === profile.share_code) {
      W.toast("That's your own link.");
      return false;
    }
    if (user.is_anonymous && cfg.googleSignIn) {
      askToSignIn(code, name);
      return false;
    }
    const { data: friendId, error } = await db.rpc("add_friend", { code });
    if (error || !friendId) {
      W.toast("That link didn't work. Ask them to send it again.");
      return false;
    }
    rememberFriendCode(code);
    W.toast(`${name || "Your friend"} is now in your friends.`);
    refreshFriends();
    return true;
  }

  function askToSignIn(code, name) {
    const dlg = $("signin-prompt");
    dlg.dataset.code = code;
    dlg.dataset.name = name || "";
    $("signin-title").textContent = `Sign in to add ${name || "your friend"}`;
    dlg.showModal();
  }

  function savePendingFriend(code, name) {
    try {
      localStorage.setItem(PENDING_FRIEND_KEY, JSON.stringify({ code, name: name || null }));
    } catch {}
  }

  // Back from Google: finish adding the friend they picked before signing in.
  // Still anonymous means they backed out of signing in, so drop it.
  async function finishPendingFriend() {
    let pending = null;
    try {
      pending = JSON.parse(localStorage.getItem(PENDING_FRIEND_KEY));
      localStorage.removeItem(PENDING_FRIEND_KEY);
    } catch {}
    if (!pending || !pending.code || user.is_anonymous) return;
    if (await addFriend(pending.code, pending.name)) $("friends").showModal();
  }

  // Accepts a whole link (woometer.com/?f=CODE) or just the code.
  function codeFromInput(text) {
    const t = text.trim();
    try {
      const fromUrl = new URL(t).searchParams.get("f");
      if (fromUrl) return fromUrl;
    } catch {}
    const m = t.match(/[?&]f=([A-Za-z0-9]+)/);
    if (m) return m[1];
    return /^[A-Za-z0-9]{6,40}$/.test(t) ? t : null;
  }

  async function addFriendFromInput() {
    const input = $("add-friend-link");
    const code = codeFromInput(input.value);
    if (!code) {
      W.toast("Paste the link your friend sent you.");
      return;
    }
    const { data: name } = await db.rpc("name_for_code", { code });
    if (await addFriend(code, name)) input.value = "";
  }

  // Like the main score, only Yes and No count; Don't Know sits it out.
  function scoreOf(answers) {
    const answered = CLAIMS.filter((c) => answers[c.id] === "yes" || answers[c.id] === "no");
    const woo = answered.filter((c) => answers[c.id] === "yes");
    return { answered: answered.length, woo, pct: pct(woo.length, answered.length) };
  }

  // Anyone with a shared link can read that person's answers.
  async function answersForCode(code) {
    const { data, error } = await db.rpc("answers_for_code", { code }).range(0, 9999);
    if (error) {
      console.warn(error);
      return null;
    }
    return Object.fromEntries(data.map((r) => [r.claim_id, r.answer]));
  }

  function friendLink() {
    return `${homeUrl()}?f=${profile.share_code}`;
  }

  async function copyFriendLink() {
    const link = friendLink();
    if (!profile.display_name) $("my-name").focus();
    try {
      await navigator.clipboard.writeText(link);
      W.toast(profile.display_name ? "Friend link copied." : "Link copied. Add your name so friends know it's you.");
    } catch {
      window.prompt("Copy your friend link:", link);
    }
  }

  async function refreshFriends() {
    if (!db) return;
    const { data, error } = await db.rpc("my_friends");
    if (error) return logError({ error });
    const list = $("friend-list");
    $("friend-empty").hidden = data.length > 0;
    $("friends-count").hidden = data.length === 0;
    $("friends-count").textContent = data.length;
    const mine = W.getAnswers();
    const items = await Promise.all(
      data.map(async (f) => {
        const theirs = await answersOf(f.friend_id);
        const c = compare(mine, theirs || {});
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        const name = document.createElement("span");
        name.className = "friend-name";
        name.textContent = f.display_name || "Unnamed friend";
        const meta = document.createElement("span");
        meta.className = "friend-meta";
        // Out of the claims you've both answered; with hundreds of claims the
        // share of the whole list would read 0% for a long time.
        meta.textContent = c.both
          ? `Agree on ${pct(c.agree, c.both)}% of ${c.both} shared`
          : "Nothing to compare yet";
        b.append(name, meta);
        b.addEventListener("click", () => openCompare(f));
        li.append(b);
        return li;
      })
    );
    list.replaceChildren(...items);
  }

  async function answersOf(friendId) {
    const { data, error } = await db.rpc("friend_answers", { friend: friendId }).range(0, 9999);
    if (error) return logError({ error });
    return Object.fromEntries(data.map((r) => [r.claim_id, r.answer]));
  }

  // Percentages are out of every claim currently on the list, so they add up
  // to 100 and stay honest as new claims are added that neither has answered.
  // A Don't Know on either side counts as "not both answered".
  function compare(mine, theirs) {
    const total = CLAIMS.length;
    const differences = [];
    const sure = (v) => (v === "yes" || v === "no" ? v : null);
    let agree = 0;
    let onlyMe = 0;
    let onlyThem = 0;
    for (const c of CLAIMS) {
      const a = sure(mine[c.id]);
      const b = sure(theirs[c.id]);
      if (a && b) {
        if (a === b) agree++;
        else differences.push({ claim: c, mine: a, theirs: b });
      } else if (a && !theirs[c.id]) onlyMe++;
      else if (b && !mine[c.id]) onlyThem++;
    }
    const differ = differences.length;
    const both = agree + differ;
    return {
      total,
      both,
      agree,
      differ,
      onlyMe,
      onlyThem,
      differences,
      agreePct: pct(agree, total),
      differPct: pct(differ, total),
      notBothPct: total ? 100 - pct(agree, total) - pct(differ, total) : 0,
    };
  }

  async function openCompare(friend) {
    const dlg = $("compare");
    const name = friend.display_name || "your friend";
    $("compare-name").textContent = friend.display_name || "Unnamed friend";
    $("compare-summary").textContent = "Loading…";
    $("compare-diffs").replaceChildren();
    dlg.showModal();

    $("compare-score").textContent = "";
    $("their-pile").hidden = true;
    $("compare-remove").hidden = !friend.friend_id;
    $("compare-add").hidden = Boolean(friend.friend_id);

    const theirs = friend.friend_id ? await answersOf(friend.friend_id) : await answersForCode(friend.code);
    if (!theirs) {
      $("compare-summary").textContent = "Couldn't load their answers. Try again in a moment.";
      return;
    }
    const c = compare(W.getAnswers(), theirs);

    // Their own results, so a shared link shows what they believe, not just the overlap.
    const s = scoreOf(theirs);
    const mine = scoreOf(W.getAnswers());
    $("compare-score").textContent = s.answered
      ? `${friend.display_name || "They"}: ${s.pct}% woo, rejecting ${100 - s.pct}% of ${s.answered} answered.` +
        (mine.answered ? ` You: ${mine.pct}% woo.` : "")
      : `${friend.display_name || "They"} haven't answered anything yet.`;
    if (s.woo.length) {
      $("their-pile-title").textContent = `${friend.display_name ? `${friend.display_name}'s` : "Their"} Woo Pile (${s.woo.length})`;
      $("their-pile-list").replaceChildren(
        ...s.woo.map((claim) => {
          const li = document.createElement("li");
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = claim.name;
          b.addEventListener("click", () => W.openDetail(claim.id));
          li.append(b);
          return li;
        })
      );
      $("their-pile").hidden = false;
    }
    if (friend.code) {
      $("compare-add").onclick = async () => {
        if (await addFriend(friend.code, friend.display_name)) $("compare-add").hidden = true;
      };
    }

    $("compare-agree").style.flexBasis = `${c.agreePct}%`;
    $("compare-differ").style.flexBasis = `${c.differPct}%`;
    $("compare-none").style.flexBasis = `${c.notBothPct}%`;
    $("compare-agree-pct").textContent = `${c.agreePct}%`;
    $("compare-differ-pct").textContent = `${c.differPct}%`;
    $("compare-none-pct").textContent = `${c.notBothPct}%`;

    const lines = [];
    lines.push(
      c.both
        ? `Of the ${c.both} claims you've both answered, you agree on ${pct(c.agree, c.both)}%.`
        : `You haven't both answered any of the same claims yet.`
    );
    const claims = (n) => (n === 1 ? "1 claim" : `${n} claims`);
    const are = (n) => (n === 1 ? "is" : "are");
    if (c.onlyThem) lines.push(`${claims(c.onlyThem)} they've answered ${are(c.onlyThem)} still on your board.`);
    if (c.onlyMe) lines.push(`${claims(c.onlyMe)} you've answered ${are(c.onlyMe)} still on ${name}'s board.`);
    $("compare-summary").textContent = lines.join(" ");

    $("compare-diffs-title").hidden = c.differences.length === 0;
    $("compare-diffs").replaceChildren(
      ...c.differences.map((d) => {
        const li = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = d.claim.name;
        const you = document.createElement("span");
        you.className = `pill ${d.mine}`;
        you.textContent = `You: ${d.mine === "yes" ? "Yes" : "No"}`;
        const them = document.createElement("span");
        them.className = `pill ${d.theirs}`;
        them.textContent = `${friend.display_name || "Them"}: ${d.theirs === "yes" ? "Yes" : "No"}`;
        li.append(label, you, them);
        return li;
      })
    );

    $("compare-remove").onclick = async () => {
      if (!confirm(`Remove ${name} from your friend list?`)) return;
      await db.from("friends").delete().eq("user_id", user.id).eq("friend_id", friend.friend_id);
      dlg.close();
      refreshFriends();
    };
  }
})();
