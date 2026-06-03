/**
 * Browser Supabase client. Use this from any client component or
 * hook — it reads/writes auth state via cookies that the SSR client
 * can also see.
 */
"use client";

import { createBrowserClient } from "@supabase/ssr";

let cached: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowser() {
  if (!cached) {
    cached = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        // Explicit cookie attributes so the session cookie
        // survives a reload regardless of which path the user
        // signed in from. The diagnostic on 2026-06-03 showed
        // the `sb-…-auth-token` cookie present immediately
        // after verifyOtp but gone on reload — most likely
        // because the default cookie was scoped to the
        // signing-in URL's directory rather than `/`.
        //   - path:    "/" so every route can see it.
        //   - sameSite "lax" so cross-site clicks (e.g. magic
        //                    link from Gmail) still ship the
        //                    cookie back.
        //   - secure   prod-only — localhost cookies must be
        //                    insecure to work over http.
        //   - maxAge   one year, refreshed in middleware on
        //                    every request.
        cookieOptions: {
          path: "/",
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          maxAge: 60 * 60 * 24 * 365,
        },
      },
    );
  }
  return cached;
}
