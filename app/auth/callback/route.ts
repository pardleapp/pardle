import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * Magic-link callback. Supabase redirects the user here after they
 * click the email link, with a one-time `code` (PKCE) in the query
 * string. We exchange the code for a session, set the auth cookies,
 * and redirect them back to wherever they were trying to go.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/live";

  if (!code) {
    return NextResponse.redirect(new URL("/live?auth=missing-code", url.origin));
  }

  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Common mobile cause: the email opened the link in an in-app
    // browser (Gmail / Apple Mail webview) that doesn't share
    // cookies/localStorage with the browser that requested the
    // link, so the PKCE code verifier isn't there. The sign-in
    // modal also accepts the 6-digit code from the email as a
    // fallback that bypasses this entirely.
    console.error("[auth/callback]", error);
    return NextResponse.redirect(
      new URL(
        `/live?auth=link-failed&msg=${encodeURIComponent(error.message)}`,
        url.origin,
      ),
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
