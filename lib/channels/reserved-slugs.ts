/**
 * Reserved slugs that cannot be used as tipster handles. These are
 * either existing top-level routes (would hijack the page if a user
 * registered them) or future-proofing for routes we know we'll want.
 *
 * Used by both the server-side validator (definitive — must accept
 * an insert) and the client-side form validator (immediate feedback).
 *
 * Adding a new top-level route? Add it here.
 */

const RESERVED = new Set<string>([
  // Existing top-level routes
  "api",
  "games",
  "live",
  "today",
  "pros",
  "holes",
  "clubs",
  "clubhouses",
  "connections",
  "trivia",
  "faces",
  "blend",
  "share",
  "c",
  "r",
  "tipster",

  // Auth / account
  "signin",
  "signup",
  "login",
  "logout",
  "auth",
  "account",
  "profile",
  "settings",

  // Common product surfaces we might add
  "feed",
  "home",
  "explore",
  "search",
  "discover",
  "trending",
  "browse",
  "leaderboard",
  "history",
  "me",
  "you",

  // Bet-flow nouns we use everywhere
  "bet",
  "bets",
  "tip",
  "tips",
  "chat",
  "following",
  "followers",
  "notifications",

  // Domain nouns we might want as pages
  "golf",
  "pga",
  "lpga",
  "tournament",
  "tournaments",
  "schedule",
  "results",
  "player",
  "players",

  // Brand / admin
  "pardle",
  "app",
  "admin",
  "dashboard",
  "manage",
  "help",
  "about",
  "terms",
  "privacy",
  "contact",
  "support",
  "faq",
  "press",

  // Static files / system
  "favicon",
  "robots",
  "sitemap",
  "manifest",
  "sw",
  "static",
  "public",
  "_next",
]);

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export interface SlugValidation {
  ok: boolean;
  /** Customer-facing reason — show this in the form when ok=false. */
  reason?: string;
}

export function validateSlug(raw: string): SlugValidation {
  const s = raw.trim().toLowerCase();
  if (!s) return { ok: false, reason: "Handle is required" };
  if (s.length < 3) return { ok: false, reason: "Too short (minimum 3 characters)" };
  if (s.length > 40) return { ok: false, reason: "Too long (maximum 40 characters)" };
  if (!SLUG_RE.test(s)) {
    return {
      ok: false,
      reason: "Only lowercase letters, numbers and hyphens; must start and end with a letter or number",
    };
  }
  if (RESERVED.has(s)) {
    return { ok: false, reason: "That handle is reserved" };
  }
  return { ok: true };
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug.trim().toLowerCase());
}
