/**
 * Server-side Supabase clients. Two variants:
 *   - getSupabaseServer(): reads the user's auth session from request
 *     cookies, used by route handlers and server components that need
 *     to act as the logged-in user (RLS policies apply).
 *   - getSupabaseAdmin(): uses the service_role key, bypassing RLS.
 *     Only use this from server code that needs to act on behalf of
 *     other users (e.g. cron jobs, migration scripts). NEVER expose
 *     this client or the service role key in any client bundle.
 *
 * Server-only — both functions throw if imported into client code.
 */
import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function getSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(items) {
          try {
            for (const { name, value, options } of items) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server components can't set cookies — that's fine,
            // middleware / route handlers will.
          }
        },
      },
    },
  );
}

let cachedAdmin: ReturnType<typeof createClient> | null = null;
export function getSupabaseAdmin() {
  if (!cachedAdmin) {
    cachedAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }
  return cachedAdmin;
}
