import { NextRequest, NextResponse } from "next/server";

/**
 * Pardle launched at the root URL with the player-guesser game living at "/".
 * Challenge links shared in the wild look like `pardle.app/?c=<token>`.
 * After the platform refactor that game lives at `/pros`, but those old links
 * must keep working. This middleware rewrites root-level requests with a
 * `?c=` param to the new `/pros` route, keeping the URL bar at `/` so the
 * recipient sees the friendly domain without any visible redirect.
 */
export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  if (pathname === "/" && searchParams.has("c")) {
    const target = req.nextUrl.clone();
    target.pathname = "/pros";
    return NextResponse.rewrite(target);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
