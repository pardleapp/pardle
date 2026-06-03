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

  // TEMPORARY DIAGNOSTIC PATH — disabled supabase session
  // refresh. The previous debug round confirmed the auth-token
  // cookie disappears between the post-verifyOtp moment and
  // the reload landing. Filtering "deletion" items in setAll
  // didn't help, so we suspect the underlying supabase-ssr
  // refresh code is clearing cookies via some path other than
  // setAll. Skipping the middleware refresh entirely lets us
  // test whether the cookie survives a clean reload without any
  // server-side auth processing — if it does, we restore a
  // patched refresh; if not, the issue is elsewhere (browser-
  // client storage / response headers from page.tsx).
  return NextResponse.next({ request: req });
}

export const config = {
  matcher: [
    // Run on every route except Next internals and static assets so
    // the auth-cookie refresh has a chance to fire on each request.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)",
  ],
};
