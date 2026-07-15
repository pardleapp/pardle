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
 * 2. Supabase auth-session refresh — canonical @supabase/ssr pattern
 *    from supabase.com/docs. Without this, the access token expires
 *    after ~1h and `auth.getUser()` in route handlers / server
 *    components starts returning null until the user re-signs-in.
 *    The setAll handler propagates rotated cookies onto the response
 *    so the browser stores the refreshed token; getUser() triggers
 *    the rotation as a side effect.
 */
export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // Path 1: root challenge-link rewrite.
  if (pathname === "/" && searchParams.has("c")) {
    const target = req.nextUrl.clone();
    target.pathname = "/pros";
    return NextResponse.rewrite(target);
  }

  // Path 2: Supabase session refresh — canonical pattern.
  // Skip when Supabase env vars are missing (local dev without a
  // populated .env.local) or on demo-only routes that don't need
  // auth. Prevents the middleware from crashing the whole app when
  // creds aren't set up locally.
  if (
    pathname.startsWith("/demo/") ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return NextResponse.next({ request: req });
  }
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
          for (const { name, value } of items) {
            req.cookies.set(name, value);
          }
          response = NextResponse.next({ request: req });
          for (const { name, value, options } of items) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );
  // IMPORTANT: don't remove. getUser() validates the access token
  // and triggers token rotation; without it the cookie goes stale.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    // Run on every route except Next internals and static assets so
    // the auth-cookie refresh has a chance to fire on each request.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)",
  ],
};
