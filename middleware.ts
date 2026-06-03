import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

/**
 * Two responsibilities:
 *
 * 1. Legacy challenge-link rewrite. The original Pardle launched at
 *    the root URL with the player-guesser game living at "/". Shared
 *    challenge links look like `pardle.app/?c=<token>`. After the
 *    refactor the game lives at `/pros`; old links must still work,
 *    so we rewrite the root → `/pros` while keeping the URL bar at
 *    "/" for friendliness.
 *
 * 2. Supabase auth-session refresh. Without this, the access token
 *    expires after ~1h and `auth.getUser()` in route handlers starts
 *    returning null until the user manually refreshes. Calling
 *    `supabase.auth.getUser()` here lets the SSR cookie helper
 *    rotate the token in-flight and keep the session live.
 */
export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // Path 1: root challenge-link rewrite.
  if (pathname === "/" && searchParams.has("c")) {
    const target = req.nextUrl.clone();
    target.pathname = "/pros";
    return NextResponse.rewrite(target);
  }

  // Path 2: Supabase session refresh for any other request.
  // The setAll handler filters out deletion items (empty value
  // or maxAge:0) so an auth-validation failure during getUser()
  // can't nuke the user's cookie. This was the root cause of
  // the "sign in → reload → still signed out" bug: on the first
  // request after verifyOtp, getUser() couldn't validate the
  // newly-set token (likely a race between the cookie being
  // committed and the middleware reading it), so supabase's
  // session handler tried to clean up by writing a deletion to
  // every sb-* cookie. Filtering deletions keeps the freshly-
  // issued cookie alive long enough for the next request to
  // succeed.
  let response = NextResponse.next({ request: req });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(items) {
          // Drop any item that looks like a cookie deletion —
          // empty value, or maxAge: 0, or expires in the past.
          // We never want the middleware to clear an existing
          // session; that's only valid for an explicit signOut
          // flow which doesn't go through this path.
          const writes = items.filter(({ value, options }) => {
            if (!value) return false;
            if (options?.maxAge === 0) return false;
            if (
              options?.expires instanceof Date &&
              options.expires.getTime() < Date.now()
            ) {
              return false;
            }
            return true;
          });
          for (const { name, value } of writes) {
            req.cookies.set(name, value);
          }
          response = NextResponse.next({ request: req });
          for (const { name, value, options } of writes) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );
  // Wrap in try/catch so a thrown validation error doesn't
  // bubble up and 500 the request. The session stays as-is
  // and the next request can retry.
  try {
    await supabase.auth.getUser();
  } catch {
    // ignore — keep cookies, let the page-level code render
  }
  return response;
}

export const config = {
  matcher: [
    // Run on every route except Next internals and static assets so
    // the auth-cookie refresh has a chance to fire on each request.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)",
  ],
};
