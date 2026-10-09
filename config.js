// Supabase settings for accounts, stats and friend comparisons.
// Both values are public by design (they ship to every browser); the data is
// protected by the row-level security rules in supabase/schema.sql.
// Leave them empty and the site runs entirely in the browser with no backend.
window.WOOMETER_CONFIG = {
  supabaseUrl: "https://jtzwtqzsevsiuyobkvaw.supabase.co",
  supabaseAnonKey: "sb_publishable_39EacCvjF_hic0TeNsP9Kw_jKoHzOQ2",
  // Set to true once Google is enabled under Supabase Authentication > Providers.
  googleSignIn: true,
  // The Google OAuth client ID (public; ends in .apps.googleusercontent.com).
  // With it, sign-in goes straight from woometer.com to Google and back, so
  // Google's screens name woometer.com instead of the Supabase project's
  // address. Needs https://woometer.com as an authorized redirect URI on the
  // client. Leave empty to sign in through Supabase's redirect instead.
  googleClientId: "458207142283-nm9ussa779v4th6hpgf8871kphc11s4q.apps.googleusercontent.com",
  // Cloudflare Turnstile site key (public), for the spam check on new sign-ins.
  // Set this first, then turn on CAPTCHA protection in Supabase (Authentication
  // > Attack Protection) with the matching secret. Empty means no spam check.
  turnstileSiteKey: "0x4AAAAAAFSlZf_xX0l1X1eK",
};
