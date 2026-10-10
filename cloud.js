// Accounts, "N% of people agree" stats and friend comparisons, backed by Supabase.
//
// Every visitor quietly gets an anonymous Supabase user, so stats and friend
// links work with no sign-up. Signing in with Google (or Facebook) links that
// same user, so nothing is lost and answers follow you to other devices. If config.js has no
// Supabase settings, or Supabase can't be reached, this file does nothing and
// the site keeps working from localStorage alone.
(function () {
  const cfg = window.WOOMETER_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.Woometer) return;
  // woometer.com/?facebook=1 shows Facebook sign-in for this tab even while
  // facebookSignIn is off, so Meta's app reviewers can try it before it's on
  // for everyone. It survives the trip to Facebook and back.
  try {
    if (new URLSearchParams(location.search).get("facebook") === "1") sessionStorage.setItem("woometer.facebookTest.v1", "1");
    if (sessionStorage.getItem("woometer.facebookTest.v1")) cfg.facebookSignIn = true;
  } catch {}

  const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js";
  const FRIEND_CODES_KEY = "woometer.friendCodes.v1";
  const LAST_USER_KEY = "woometer.lastUser.v1";
  // The answers this browser last knew the account to hold, and whose account.
  const SYNCED_KEY = "woometer.synced.v1";
  // The friend someone was adding when they left to sign in.
  const PENDING_FRIEND_KEY = "woometer.pendingFriend.v1";
  // Friends already shown in this browser's Friends list, and whose account.
  const FRIENDS_SEEN_KEY = "woometer.friendsSeen.v1";
  // Set just before the reload that follows "Delete my account", to say it worked.
  const DELETED_KEY = "woometer.accountDeleted";
  const TURNSTILE_JS = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
  // Per-tab check values for a trip to Google's sign-in page and back.
  const GOOGLE_TRIP_KEY = "woometer.googleTrip.v1";
  // Per-tab note of a sign-in through Supabase's redirect (Facebook, or Google
  // without googleClientId): which provider, and whether it was to sign in or
  // to link it to the account already signed in.
  const OAUTH_TRIP_KEY = "woometer.oauthTrip.v1";
  const PROVIDER_NAMES = { google: "Google", facebook: "Facebook" };
  // Set when someone taps "Not now" on the "Keep your answers safe" note.
  const SAVE_NOTE_KEY = "woometer.saveNoteHidden.v1";
  // Answers before that note shows, so first-time visitors can look around first.
  const SAVE_NOTE_AFTER = 3;
  // A spare copy of this browser's sign-in (see keepSession).
  const SESSION_KEY = "woometer.session.v1";

  const $ = (id) => document.getElementById(id);
  const byId = Object.fromEntries(CLAIMS.map((c) => [c.id, c]));
  const W = window.Woometer;

  let db = null;
  let user = null;
  let profile = { display_name: null, share_code: null };
  // The name being saved from the "What's your name?" box, and what to do once
  // there is one (see withName).
  let nameSaving = Promise.resolve();
  let afterName = null;
  // What the account holds, as far as this browser knows: { [claimId]: answer }.
  let synced = {};
  // True while signing out or deleting the account on purpose, so the spare
  // sign-in isn't kept or put back.
  let leaving = false;
  // The "answers aren't reaching woometer" note shows once per visit.
  let warned = false;

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
    db.auth.onAuthStateChange((event, session) => keepSession(session));

    // Back from signing in through Supabase's redirect (see oauthTrip).
    // Linking to this browser's anonymous user fails when that Google or
    // Facebook account already has its own woometer user (say, from another
    // device). Then sign in to that user instead; the answers in this browser
    // get merged in. Linking to an account that's already signed in just says so.
    const trip = takeOAuthTrip();
    const params = new URLSearchParams(location.hash.slice(1) + "&" + location.search.slice(1));
    let tripProblem = null;
    if (params.get("error")) {
      history.replaceState(null, "", location.pathname);
      const taken = params.get("error_code") === "identity_already_exists";
      if (taken && (!trip || trip.mode === "signin")) {
        await db.auth.signInWithOAuth({ provider: trip ? trip.provider : "google", options: { redirectTo: homeUrl() } });
        return;
      }
      // access_denied: they backed out on Google's or Facebook's page.
      if (trip && params.get("error") !== "access_denied") tripProblem = { taken, detail: params.get("error_description") || params.get("error") };
    }

    let { data } = await db.auth.getSession();
    // Lost the sign-in since last time? Put the same one back (see keepSession).
    if (!data.session) {
      const back = await restoreSession();
      if (back) data = { session: back };
    }
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
    keepSession(data.session);

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
    if (googleProblem) {
      const detail = googleProblem.message || googleProblem.code || String(googleProblem);
      footNote(`Google sign-in didn't work, so you're not signed in. (${detail})`);
    }
    if (trip) {
      const name = PROVIDER_NAMES[trip.provider] || trip.provider;
      if (tripProblem && trip.mode === "link") {
        W.toast(tripProblem.taken
          ? `That ${name} account already has its own woometer account, so it wasn't linked to this one.`
          : `${name} couldn't be linked just now. (${tripProblem.detail})`);
      } else if (tripProblem) {
        footNote(`${name} sign-in didn't work, so you're not signed in. (${tripProblem.detail})`);
      } else if (trip.mode === "link" && providersOf(user).includes(trip.provider)) {
        W.toast(`${name} is linked. You can sign in with either one.`);
      }
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

  // Merge this browser's answers with the account's. Answers given, changed or
  // put back on the board here since the last visit are sent up; everything
  // else comes from the account, so a change made on another device wins over
  // this browser's old copy. The first time an account is seen in this
  // browser (say, just after signing in), this browser wins wherever both
  // have an answer.
  async function syncAnswers() {
    const { data, error } = await db.from("answers").select("claim_id, answer").eq("user_id", user.id).range(0, 9999);
    if (error) throw error;
    const server = Object.fromEntries(data.map((r) => [r.claim_id, r.answer]));
    const local = W.getAnswers();
    const last = lastSynced();
    synced = { ...server };
    const merged = {};
    const toSend = [];
    const toRemove = [];
    for (const [id, value] of Object.entries(local)) {
      if (last && last[id] === value) {
        // Not changed here: keep whatever the account has now, if anything.
        if (id in server) merged[id] = server[id];
      } else {
        merged[id] = value;
        if (server[id] !== value) toSend.push(row(id, value));
      }
    }
    for (const [id, value] of Object.entries(server)) {
      if (id in merged) continue;
      if (last && id in last && !(id in local) && last[id] === value) toRemove.push(id);
      else merged[id] = value;
    }
    if (toSend.length) answersNotSaved(await saveRows(toSend));
    if (toRemove.length) logError({ error: await removeRows(toRemove) });
    keepSynced();
    W.setAnswers(merged);
  }

  // Brings the account in line with this browser: sends new and changed
  // answers and removes taken-back ones, including any that didn't get
  // through earlier. Returns the error, if any.
  async function sendChanges() {
    if (!(await stillSignedIn())) return { message: "not signed in" };
    const local = W.getAnswers();
    const send = Object.entries(local)
      .filter(([id, value]) => synced[id] !== value)
      .map(([id, value]) => row(id, value));
    // Answers to retired claims stay on the server; this page never shows them.
    const drop = Object.keys(synced).filter((id) => byId[id] && !(id in local));
    if (send.length) {
      let error = await saveRows(send);
      // One answer the database refuses (a check constraint, say) shouldn't
      // hold up the rest, so try them one by one.
      if (error && send.length > 1 && /^2[23]/.test(error.code || "")) {
        error = null;
        for (const r of send) error = (await saveRows([r])) || error;
      }
      if (error) return error;
    }
    if (drop.length) return removeRows(drop);
    return null;
  }

  // Keeping the sign-in
  //
  // supabase-js keeps the sign-in in this browser's storage. On 10 Oct 2026 an
  // iPhone lost it 12 seconds into a visit: every answer after that went out
  // signed out and was quietly refused, and signing in later made a brand-new
  // account with a new share link. So the page keeps a spare copy of its own
  // and puts the same sign-in back whenever supabase-js comes up empty.
  function keepSession(session) {
    if (leaving || !session || !session.refresh_token) return;
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ user: session.user.id, access_token: session.access_token, refresh_token: session.refresh_token })
      );
    } catch {}
  }

  function forgetSession() {
    leaving = true;
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {}
  }

  // Signs back in from the spare copy; with who, only as that user.
  async function restoreSession(who) {
    let spare = null;
    try {
      spare = JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch {}
    if (leaving || !spare || !spare.refresh_token || (who && spare.user !== who)) return null;
    const { data, error } = await db.auth.setSession({ access_token: spare.access_token, refresh_token: spare.refresh_token });
    if (error || !data.session) {
      console.warn("Woometer: couldn't put the sign-in back.", error);
      return null;
    }
    return data.session;
  }

  // Is this page still signed in as user? If the browser dropped the sign-in,
  // this puts it back first.
  let rescue = null;
  async function stillSignedIn() {
    const { data } = await db.auth.getSession();
    if (data.session) {
      keepSession(data.session);
      return data.session.user.id === user.id;
    }
    rescue ||= restoreSession(user.id).finally(() => (rescue = null));
    return !!(await rescue);
  }

  // Saves go to the database one at a time, in the order they were made, so a
  // quick change of mind can't be overtaken by the answer it replaced.
  let writes = Promise.resolve();
  function inOrder(write) {
    const done = writes.then(write);
    writes = done.catch(() => {});
    return done;
  }

  function lastSynced() {
    try {
      const s = JSON.parse(localStorage.getItem(SYNCED_KEY));
      return s && s.user === user.id ? s.answers : null;
    } catch {
      return null;
    }
  }
  function keepSynced() {
    try {
      localStorage.setItem(SYNCED_KEY, JSON.stringify({ user: user.id, answers: synced }));
    } catch {}
  }

  // Returns the error, if any.
  async function saveRows(rows) {
    const { error } = await db.from("answers").upsert(rows);
    if (error) return error;
    for (const r of rows) synced[r.claim_id] = r.answer;
    keepSynced();
    return null;
  }

  async function removeRows(ids) {
    const res = await db.from("answers").delete().eq("user_id", user.id).in("claim_id", ids);
    if (res.error) return res.error;
    for (const id of ids) delete synced[id];
    keepSynced();
  }

  function row(id, value) {
    return { user_id: user.id, claim_id: id, answer: value, updated_at: new Date().toISOString() };
  }

  function wireEvents() {
    document.addEventListener("woometer:answer", async (e) => {
      const { id, value } = e.detail;
      const error = await inOrder(sendChanges);
      if (error) return answersNotSaved(error);
      const s = await statsFor(id);
      // Only the latest tap on a claim gets a message. No Don't Know count
      // means the database isn't counting them yet.
      if (!s || W.getAnswers()[id] !== value || (value === "unsure" && !s.unsure)) return;
      const total = s.yes + s.no + s.unsure;
      const people = `${total.toLocaleString()} people`;
      if (total <= 1) W.toast("You're the first to answer this one.");
      else if (value === "unsure") W.toast(`${pct(s.unsure, total)}% of ${people} don't know either.`);
      else W.toast(`${pct(s[value], total)}% of ${people} agree with you.`);
    });

    document.addEventListener("woometer:remove", () => {
      inOrder(async () => answersNotSaved(await sendChanges()));
    });

    document.addEventListener("woometer:reset", () => {
      inOrder(async () => {
        if (!(await stillSignedIn())) return answersNotSaved({ message: "not signed in" });
        const res = await db.from("answers").delete().eq("user_id", user.id);
        if (res.error) return answersNotSaved(res.error);
        synced = {};
        keepSynced();
      });
    });

    document.addEventListener("woometer:detail", async (e) => {
      const el = $("detail-stats");
      const id = e.detail.id;
      el.hidden = false;
      el.textContent = "Counting everyone's answers";
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

    $("google-login").addEventListener("click", signIn);
    $("save-google").addEventListener("click", signInWithGoogle);
    $("save-facebook").addEventListener("click", signInWithFacebook);
    $("choice-google").addEventListener("click", () => {
      $("signin-choice").close();
      signInWithGoogle();
    });
    $("choice-facebook").addEventListener("click", () => {
      $("signin-choice").close();
      signInWithFacebook();
    });
    $("link-facebook").addEventListener("click", () => {
      setMenu(false);
      signInWithFacebook();
    });
    $("save-hide").addEventListener("click", () => {
      try {
        localStorage.setItem(SAVE_NOTE_KEY, "1");
      } catch {}
      renderSaveNote();
    });
    for (const name of ["answer", "remove", "reset"]) document.addEventListener(`woometer:${name}`, renderSaveNote);
    $("friends-google").addEventListener("click", signIn);
    $("friends-open").addEventListener("click", () => {
      $("friends").showModal();
      $("friends-count").hidden = true;
      refreshFriends(true);
    });
    // Your own link lives in the Share box; this saves hunting for Share up top.
    $("friends-share").addEventListener("click", () => {
      $("friends").close();
      openShare();
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
    $("reset-account").addEventListener("click", () => {
      setMenu(false);
      W.startOver();
    });
    $("delete-account").addEventListener("click", () => {
      setMenu(false);
      W.confirmDelete($("delete-dialog"));
    });
    $("delete-confirm").addEventListener("click", deleteAccount);
    $("copy-friend-link").addEventListener("click", copyFriendLink);
    $("share-copy").addEventListener("click", copyShareText);
    $("share-native").addEventListener("click", sendShareText);
    $("add-friend-btn").addEventListener("click", addFriendFromInput);
    $("add-friend-link").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addFriendFromInput();
      }
    });
    $("my-name").addEventListener("change", (e) => {
      if (e.target.value.trim()) return setName(e.target.value);
      e.target.value = profile.display_name || "";
      if (profile.display_name) W.toast("Your name can't be blank: friends see it in their list.");
    });
    $("name-save").addEventListener("click", saveNameFromDialog);
    for (const [id, go] of [["name-google-btn", signInWithGoogle], ["name-facebook-btn", signInWithFacebook]]) {
      $(id).addEventListener("click", () => {
        // Adding a friend when they left: finish it once they're back.
        if (afterName && afterName.friend) savePendingFriend(afterName.friend.code, afterName.friend.name);
        $("name-dialog").close();
        go();
      });
    }
    $("name-dialog").addEventListener("close", () => {
      if (afterName) afterName.resolve(false);
      afterName = null;
    });
    $("nickname-save").addEventListener("click", saveNickname);
    $("nickname-remove").addEventListener("click", removeFriend);
    // Enter saves (the form's first button is Cancel, which Enter would pick).
    $("name-input").addEventListener("keydown", (e) => e.key === "Enter" && saveNameFromDialog(e));
    $("nickname-input").addEventListener("keydown", (e) => e.key === "Enter" && saveNickname(e));
    $("invite-close").addEventListener("click", () => ($("invite").hidden = true));
    W.shareUrl = friendLink;
    W.withName = withName;
    W.openShare = openShare;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      // Back on the page: send anything that didn't get through, then refresh.
      inOrder(async () => answersNotSaved(await sendChanges())).then(() => refreshFriends());
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
    footNote(`Couldn't reach the woometer server, so your answers are only saved in this browser for now. (${detail})`);
  }

  // Answers that can't be saved get a note on screen too, once per visit, not
  // just the line at the bottom of the page.
  function answersNotSaved(error) {
    if (!error) return null;
    logError({ error });
    if (!warned) {
      warned = true;
      W.toast("Your answers aren't reaching woometer right now. They're kept on this device and will be sent when it's back.");
    }
    return null;
  }

  // The footer is just About · Privacy · Terms; a line above them appears
  // only when something has gone wrong.
  function footNote(text) {
    $("foot-note").textContent = text;
    $("foot-note").hidden = false;
  }

  // Account

  // What signing in does, for anyone not signed in who has answered a few.
  function renderSaveNote() {
    let hidden = false;
    try {
      hidden = localStorage.getItem(SAVE_NOTE_KEY) === "1";
    } catch {}
    const answered = Object.keys(W.getAnswers()).length;
    const hide = hidden || !user.is_anonymous || !(cfg.googleSignIn || cfg.facebookSignIn) || answered < SAVE_NOTE_AFTER;
    if ($("save-note").hidden === hide) return;
    $("save-note").hidden = hide;
    // The side column re-fits its piles to the window on resize.
    window.dispatchEvent(new Event("resize"));
  }

  function renderAccount() {
    renderSaveNote();
    const anon = user.is_anonymous;
    // Each sign-in button stays hidden until its provider is set up in
    // Supabase (googleSignIn and facebookSignIn in config.js). With both, the
    // top-bar Sign in offers a choice, so it shows a plain person instead of the G.
    const both = cfg.googleSignIn && cfg.facebookSignIn;
    $("google-login").hidden = !anon || !(cfg.googleSignIn || cfg.facebookSignIn);
    $("google-login").querySelector(".g-logo").toggleAttribute("hidden", !cfg.googleSignIn || both);
    $("google-login").querySelector(".person-logo").toggleAttribute("hidden", !cfg.facebookSignIn);
    $("google-login").setAttribute("aria-label", both ? "Sign in" : `Sign in with ${cfg.googleSignIn ? "Google" : "Facebook"}`);
    $("google-login").title = `${both ? "Sign in" : `Sign in with ${cfg.googleSignIn ? "Google" : "Facebook"}`} to keep your answers and friends on any device`;
    $("save-google").hidden = !cfg.googleSignIn;
    $("save-facebook").hidden = !cfg.facebookSignIn;
    $("save-how").textContent = both ? "Sign in with Google or Facebook" : `Sign in with ${cfg.googleSignIn ? "Google" : "Facebook"}`;
    $("choice-google").hidden = !cfg.googleSignIn;
    $("choice-facebook").hidden = !cfg.facebookSignIn;
    $("friends-google").textContent = both ? "Sign in" : `Sign in with ${cfg.googleSignIn ? "Google" : "Facebook"}`;
    $("account").hidden = anon;
    $("link-facebook").hidden = anon || !cfg.facebookSignIn || providersOf(user).includes("facebook");
    if (anon) return;

    const meta = user.user_metadata || {};
    const name = meta.full_name || meta.name || profile.display_name || "";
    const picture = meta.avatar_url || meta.picture;
    const avatar = $("avatar-pic");
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

  // The top-bar Sign in (and the Friends note): straight to Google, or a
  // choice of Google or Facebook when both are on.
  function signIn() {
    if (cfg.googleSignIn && cfg.facebookSignIn) return $("signin-choice").showModal();
    return cfg.googleSignIn ? signInWithGoogle() : signInWithFacebook();
  }

  async function signInWithGoogle() {
    // crypto.subtle (for the nonce) only exists on https pages.
    if (cfg.googleClientId && window.crypto && crypto.subtle) return goToGoogle();
    return oauthTrip("google", "signin");
  }

  // Facebook goes through Supabase's redirect; Facebook's screen names the
  // Meta app (woometer), not the Supabase address. Signed in already, this
  // links Facebook to the same account (Link Facebook in the account menu).
  function signInWithFacebook() {
    return oauthTrip("facebook", user.is_anonymous ? "signin" : "link");
  }

  // Keep the same user so answers and friends carry over. linkIdentity needs
  // "manual linking" on in Supabase; without it, fall back to a plain sign-in.
  async function oauthTrip(provider, mode) {
    const options = { redirectTo: homeUrl() };
    try {
      sessionStorage.setItem(OAUTH_TRIP_KEY, JSON.stringify({ provider, mode }));
    } catch {}
    const { error } = await db.auth.linkIdentity({ provider, options });
    if (!error) return;
    console.warn(`Woometer: linking ${provider} failed.`, error);
    if (mode === "signin") return db.auth.signInWithOAuth({ provider, options });
    takeOAuthTrip();
    W.toast(`${PROVIDER_NAMES[provider]} couldn't be linked just now. Try again in a moment.`);
  }

  function takeOAuthTrip() {
    try {
      const trip = JSON.parse(sessionStorage.getItem(OAUTH_TRIP_KEY));
      sessionStorage.removeItem(OAUTH_TRIP_KEY);
      return trip && trip.provider ? trip : null;
    } catch {
      return null;
    }
  }

  // The sign-ins on this account: "google", "facebook" (anonymous has none).
  function providersOf(u) {
    const meta = (u.app_metadata && u.app_metadata.providers) || [];
    return [...new Set([...meta, ...(u.identities || []).map((i) => i.provider)])];
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
    forgetSession();
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
      localStorage.removeItem(SYNCED_KEY);
      localStorage.removeItem(FRIENDS_SEEN_KEY);
    } catch {}
    location.replace(homeUrl());
  }

  // Deletes the sign-in itself; the database removes the profile, answers and
  // friend rows (both directions) along with it. See delete_my_account in
  // supabase/schema.sql.
  async function deleteAccount() {
    const button = $("delete-confirm");
    button.disabled = true;
    button.textContent = "Deleting";
    const { error } = await db.rpc("delete_my_account");
    if (error) {
      console.warn(error);
      button.disabled = false;
      button.textContent = "Delete";
      $("delete-dialog").close();
      W.toast("Couldn't delete your account just now. Nothing was deleted; try again in a moment.");
      return;
    }
    // The session is already gone on the server, so only clear it here.
    forgetSession();
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

  // Your name goes with your link and into your friends' lists, so sharing a
  // link or adding a friend needs one. With a name, runs then() right away;
  // without, asks for it first and runs then() from the Save tap itself, so
  // copying a link still works. Anyone not signed in can sign in with Google
  // instead, which brings their Google name; a Google account without a name
  // gets this box too. Resolves to what then() returns, or false if they cancel.
  // friend is the friend being added, if any, so signing in can finish adding them.
  function withName(then, friend) {
    if (profile.display_name) return Promise.resolve(then());
    const meta = user.user_metadata || {};
    $("name-input").value = (meta.full_name || meta.name || "").trim().slice(0, 40);
    const both = cfg.googleSignIn && cfg.facebookSignIn;
    $("name-google").hidden = !(user.is_anonymous && (cfg.googleSignIn || cfg.facebookSignIn));
    $("name-google-btn").hidden = !cfg.googleSignIn;
    $("name-facebook-btn").hidden = !cfg.facebookSignIn;
    $("name-or").textContent = `to use your ${both ? "Google or Facebook" : cfg.googleSignIn ? "Google" : "Facebook"} name, or type a name:`;
    return new Promise((resolve) => {
      afterName = { then, resolve, friend };
      $("name-dialog").showModal();
    });
  }

  function saveNameFromDialog(e) {
    e.preventDefault();
    const name = $("name-input").value.trim().slice(0, 40);
    if (!name) {
      $("name-input").focus();
      return;
    }
    const pending = afterName;
    afterName = null;
    profile.display_name = name;
    $("my-name").value = name;
    nameSaving = setName(name);
    $("name-dialog").close();
    if (pending) pending.resolve(pending.then());
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

  // A shared link is woometer.com/?f=CODE (from the Share box).
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
        : `${who} shared their woometer with you.`;
    $("invite-text").textContent = "Answer some claims yourself to see where you agree and differ.";
    $("invite-compare").textContent = `See ${name ? `${name}'s` : "their"} answers`;
    $("invite-compare").hidden = !theirs;
    $("invite-compare").onclick = () => openCompare({ code, display_name: name });
    const add = $("invite-add");
    add.textContent = `Add ${name || "them"} as a Friend`;
    add.disabled = false;
    // Friends need a name to show in each other's lists.
    add.hidden = !name;
    if (!name) $("invite-text").textContent = "They haven't added their name yet. Once they do, you can add them as a friend.";
    add.onclick = async () => {
      if (await addFriend(code, name)) {
        add.textContent = "Added to your friends ✓";
        add.disabled = true;
      }
    };
    $("invite").hidden = false;
  }

  // Adding is mutual: you appear in their list too, so either of you can compare.
  // Anyone can add a friend, signed in or not. Friends added in this browser
  // come along if it later signs in to a Google account (see handleInvite).
  async function addFriend(code, name) {
    if (code === profile.share_code) {
      W.toast("That's your own link.");
      return false;
    }
    if (!name) {
      W.toast("They haven't added their name on woometer yet. Once they do, ask them to send their link again.");
      return false;
    }
    return withName(() => addNamedFriend(code, name), { code, name });
  }

  async function addNamedFriend(code, name) {
    await nameSaving;
    const { data: friendId, error } = await db.rpc("add_friend", { code });
    if (error || !friendId) {
      W.toast("That link didn't work. Ask them to send it again.");
      return false;
    }
    rememberFriendCode(code);
    // You added them yourself, so they don't count as new on the badge.
    const seen = seenFriends();
    if (seen) saveSeenFriends(seen.add(friendId));
    W.toast(`${name || "Your friend"} is now in your friends.` + (keepFriendsNote() ? ` ${$("friends-google").textContent} to keep them safe on any device.` : ""));
    refreshFriends();
    return true;
  }

  // A gentle nudge for friends kept only by this browser's anonymous account.
  function keepFriendsNote() {
    return user.is_anonymous && Boolean(cfg.googleSignIn || cfg.facebookSignIn);
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

  // The Share box. Your link shows your name, so it asks for one first.
  function openShare() {
    withName(() => {
      $("my-name").value = profile.display_name || "";
      $("share-preview").textContent = W.shareText();
      // Phones can hand the message straight to Messages, WhatsApp and so on.
      const canSend = typeof navigator.share === "function";
      $("share-native").hidden = !canSend;
      $("share-copy").classList.toggle("ghost", canSend);
      $("share-dialog").showModal();
    });
  }

  async function copyShareText() {
    if (await W.copyText(W.shareText(), "Score and link copied. Paste it anywhere.", "Copy your score and link:")) {
      $("share-dialog").close();
    }
  }

  async function sendShareText() {
    try {
      await navigator.share({ text: W.shareText() });
      $("share-dialog").close();
    } catch (err) {
      if (err.name !== "AbortError") copyShareText();
    }
  }

  function copyFriendLink() {
    withName(async () => {
      if (await W.copyText(friendLink(), "Link copied.", "Copy your link:")) $("share-dialog").close();
    });
  }

  // opening: true when the person just opened Friends, so everyone listed has
  // now been seen even if they close it before the list finishes loading.
  async function refreshFriends(opening = false) {
    if (!db) return;
    const { data, error } = await db.rpc("my_friends");
    if (error) return logError({ error });
    const list = $("friend-list");
    $("friend-empty").hidden = data.length > 0;
    $("friend-hint").hidden = !data.length;
    $("friends-keep").hidden = !(data.length && keepFriendsNote());
    showNewFriends(data.map((f) => f.friend_id), opening);
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
        name.textContent = friendName(f) || "Unnamed friend";
        if (f.nickname && f.display_name && f.nickname !== f.display_name) name.title = f.display_name;
        // How much common ground, out of the claims you've both answered Yes or No.
        const meta = document.createElement("span");
        meta.className = "friend-meta";
        if (c.both) {
          const num = document.createElement("strong");
          num.className = "friend-pct";
          num.textContent = `${pct(c.agree, c.both)}%`;
          const word = document.createElement("span");
          word.textContent = "agree";
          meta.append(num, word);
          b.setAttribute("aria-label", `${name.textContent}, you agree on ${num.textContent}`);
        } else {
          meta.textContent = "Nothing to compare yet";
        }
        b.append(name, meta);
        b.addEventListener("click", () => openCompare({ ...f, display_name: friendName(f) }));
        li.append(b);
        // Nicknames need the current schema.sql; before that the list has no
        // nickname column, so there's nothing to rename with.
        if ("nickname" in f) {
          const rename = document.createElement("button");
          rename.type = "button";
          rename.className = "rename";
          rename.textContent = "✎";
          rename.title = "Rename or remove (only you see the name)";
          rename.setAttribute("aria-label", `Rename or remove ${friendName(f) || "this friend"}`);
          rename.addEventListener("click", () => openNickname(f));
          li.append(rename);
        }
        return li;
      })
    );
    list.replaceChildren(...items);
  }

  // The nickname you gave them, else the name they chose.
  function friendName(f) {
    return f.nickname || f.display_name || "";
  }

  let renaming = null;
  function openNickname(f) {
    renaming = f;
    $("nickname-title").textContent = `Rename ${friendName(f) || "your friend"}`;
    $("nickname-hint").textContent = f.display_name
      ? `Only you see this name. Leave it blank to go back to the name they chose, ${f.display_name}.`
      : "Only you see this name.";
    $("nickname-input").value = f.nickname || "";
    $("nickname-input").placeholder = f.display_name || "Their name";
    $("nickname-remove").textContent = `Remove ${friendName(f) || "them"} from my friends`;
    $("nickname-dialog").showModal();
  }

  // Tucked away in the ✎ box, since people rarely want it.
  async function removeFriend() {
    const f = renaming;
    if (!f) return;
    if (!confirm(`Remove ${friendName(f) || "this friend"} from your friend list?`)) return;
    const { error } = await db.from("friends").delete().eq("user_id", user.id).eq("friend_id", f.friend_id);
    if (error) {
      logError({ error });
      W.toast("Couldn't remove them just now. Try again in a moment.");
      return;
    }
    $("nickname-dialog").close();
    renaming = null;
    refreshFriends();
  }

  async function saveNickname(e) {
    e.preventDefault();
    const f = renaming;
    if (!f) return;
    const nickname = $("nickname-input").value.trim().slice(0, 40);
    const { error } = await db.rpc("set_friend_nickname", { friend: f.friend_id, new_nickname: nickname });
    if (error) {
      logError({ error });
      W.toast("Couldn't save that name just now. Try again in a moment.");
      return;
    }
    $("nickname-dialog").close();
    renaming = null;
    refreshFriends();
  }

  // The badge on the Friends button counts people who have added you since you
  // last opened Friends in this browser (by tapping Add on your link). Opening
  // Friends clears it.
  function showNewFriends(ids, opening) {
    let seen = seenFriends();
    // The first time this account's friends are listed here, nobody is new.
    if (!seen || opening || $("friends").open) {
      seen = new Set(ids);
      saveSeenFriends(seen);
    }
    const fresh = ids.filter((id) => !seen.has(id)).length;
    $("friends-count").hidden = fresh === 0;
    $("friends-count").textContent = fresh;
    $("friends-open").setAttribute("aria-label", fresh ? `Friends, ${fresh} new` : "Friends");
  }

  function seenFriends() {
    try {
      const saved = JSON.parse(localStorage.getItem(FRIENDS_SEEN_KEY));
      if (saved && saved.user === user.id) return new Set(saved.ids);
    } catch {}
    return null;
  }

  function saveSeenFriends(ids) {
    try {
      localStorage.setItem(FRIENDS_SEEN_KEY, JSON.stringify({ user: user.id, ids: [...ids] }));
    } catch {}
  }

  async function answersOf(friendId) {
    const { data, error } = await db.rpc("friend_answers", { friend: friendId }).range(0, 9999);
    if (error) return logError({ error });
    return Object.fromEntries(data.map((r) => [r.claim_id, r.answer]));
  }

  // Common ground: only claims you've both answered Yes or No count, so Don't
  // Know and anything still on either board stay out of it.
  function compare(mine, theirs) {
    const agreements = [];
    const differences = [];
    const sure = (v) => (v === "yes" || v === "no" ? v : null);
    for (const c of CLAIMS) {
      const a = sure(mine[c.id]);
      const b = sure(theirs[c.id]);
      if (a && b) (a === b ? agreements : differences).push({ claim: c, mine: a, theirs: b });
    }
    const agree = agreements.length;
    const differ = differences.length;
    return { both: agree + differ, agree, differ, agreements, differences };
  }

  async function openCompare(friend) {
    const dlg = $("compare");
    const them = friend.display_name || "Them";
    $("compare-name").textContent = friend.display_name || "Unnamed friend";
    $("agree-on").hidden = true;
    $("compare-bar").hidden = true;
    $("compare-woo").hidden = true;
    $("compare-summary").textContent = "Loading their answers";
    $("agree-box").hidden = true;
    $("differ-box").hidden = true;
    $("their-pile").hidden = true;
    $("compare-add").hidden = Boolean(friend.friend_id);
    dlg.showModal();

    const theirs = friend.friend_id ? await answersOf(friend.friend_id) : await answersForCode(friend.code);
    if (!theirs) {
      $("compare-summary").textContent = "Couldn't load their answers. Try again in a moment.";
      return;
    }
    const c = compare(W.getAnswers(), theirs);

    const agreed = pct(c.agree, c.both);
    $("agree-on").hidden = !c.both;
    $("compare-bar").hidden = !c.both;
    $("compare-pct").textContent = `${agreed}%`;
    $("compare-summary").textContent = c.both
      ? `Of the ${c.both === 1 ? "one claim" : `${c.both} claims`} you both answered Yes or No.`
      : "Nothing to compare yet. Once you've both answered some of the same claims Yes or No, you'll see how much you agree.";
    $("compare-agree").style.flexBasis = `${agreed}%`;

    const yesNo = (v) => (v === "yes" ? "Yes" : "No");
    const pill = (v, text) => {
      const el = document.createElement("span");
      el.className = `pill ${v}`;
      el.textContent = text;
      return el;
    };
    const fill = (box, title, label, list, rows, pills) => {
      $(box).hidden = rows.length === 0;
      $(box).open = false;
      $(title).textContent = `${label} (${rows.length})`;
      $(list).replaceChildren(
        ...rows.map((d) => {
          const li = document.createElement("li");
          const label = document.createElement("span");
          label.textContent = d.claim.name;
          li.append(label, ...pills(d));
          return li;
        })
      );
    };
    fill("agree-box", "agree-title", "Agree on", "compare-agrees", c.agreements, (d) => [pill(d.mine, `Both: ${yesNo(d.mine)}`)]);
    fill("differ-box", "differ-title", "Differ on", "compare-diffs", c.differences, (d) => [
      pill(d.mine, `You: ${yesNo(d.mine)}`),
      pill(d.theirs, `${them}: ${yesNo(d.theirs)}`),
    ]);

    // Each woo score, small beside the explanation rather than a line of its own.
    const s = scoreOf(theirs);
    const mine = scoreOf(W.getAnswers());
    const woo = (who, sc) => {
      const el = document.createElement("span");
      const b = document.createElement("b");
      b.textContent = `${sc.pct}%`;
      el.append(`${who} `, b, " woo");
      return el;
    };
    const scores = [mine.answered && woo("You", mine), s.answered && woo(them, s)].filter(Boolean);
    if (!s.answered) {
      const none = document.createElement("span");
      none.textContent = `${friend.display_name ? `${friend.display_name} hasn't` : "They haven't"} answered anything yet.`;
      scores.push(none);
    }
    $("compare-woo").replaceChildren(...scores);
    $("compare-woo").hidden = false;
    if (s.woo.length) {
      $("their-pile-title").textContent = `${friend.display_name ? `${friend.display_name}'s` : "Their"} ✨ Believe It (${s.woo.length})`;
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
  }
})();
