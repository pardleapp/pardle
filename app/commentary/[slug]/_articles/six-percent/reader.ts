/**
 * Shared contract between the server-rendered article pages and the
 * client-side email gate.
 *
 * The gate is deliberately a *cookie*, not localStorage. The paid half
 * of an article is withheld on the server: if this cookie is absent the
 * markup is never sent to the browser at all, so "view source" doesn't
 * defeat it. localStorage can't do that — the server can't read it.
 *
 * This is a lead-capture gate, not a paywall. Someone who knows to set
 * a cookie by hand can walk past it, and that's an acceptable trade for
 * not making people create an account. If we ever gate something that
 * genuinely must not leak, it needs a real session behind Supabase auth.
 */
export const READER_COOKIE = "pardle_reader";

/** One year. Long enough that a returning reader is never re-asked. */
export const READER_MAX_AGE = 60 * 60 * 24 * 365;
