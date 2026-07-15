/**
 * Browser Supabase client. Use this from any client component or
 * hook — it reads/writes auth state via cookies that the SSR client
 * can also see.
 */
"use client";

import { createBrowserClient } from "@supabase/ssr";

let cached: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Returns the Supabase browser client, or null when the env vars are
 * missing (local-dev with an unpopulated .env.local). Callers that
 * used to blindly deref the client should null-check first — auth
 * simply reads as "signed out" in that mode.
 */
export function getSupabaseBrowser() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return null;
  }
  if (!cached) {
    cached = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  }
  return cached;
}
