"use client";

/**
 * Reactive bridge between client-side Supabase auth and server-
 * rendered pages. Drop this into any client component that's
 * gating on a server-side auth check (e.g. GroupsSignedOut,
 * any future "sign in to continue" surface).
 *
 *   useAuthRefresh();
 *
 * Mechanics:
 *  - Subscribes to supabase.auth.onAuthStateChange.
 *  - When `SIGNED_IN` fires with a real session → calls
 *    router.refresh(). The page's server component re-runs;
 *    this time getSupabaseServer().auth.getUser() sees the
 *    newly-written cookie and renders the signed-in branch.
 *  - Same for `SIGNED_OUT` so a sign-out flow on one surface
 *    propagates to every other server-rendered gate.
 *  - Token refresh / user updates don't trigger a refetch —
 *    they don't change the signed-in vs signed-out branch.
 *
 * Background: the Groups page (and any other auth-gated server
 * component) reads getUser() once per request. The signed-out
 * page renders <GroupsSignedOut/>, which opens SignInModal.
 * verifyOtp succeeds — but the server component already rendered
 * with no session. Without this hook the user has to manually
 * refresh to see the signed-in branch. router.refresh() asks
 * Next.js to re-fetch server components for the current route,
 * picking up the new session cookie this time.
 *
 * Why this lives on the client and not in the modal: the modal's
 * router.refresh() can race with the cookie write, AND signing
 * in via another tab / a magic-link click in a different browser
 * wouldn't be caught at all. Listening on the gate itself is the
 * safety net.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";

export function useAuthRefresh(): void {
  const router = useRouter();
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    const { data: sub } = supabase.auth.onAuthStateChange(
      (event: string, session: Session | null) => {
        if (event === "SIGNED_IN" && session) {
          router.refresh();
        } else if (event === "SIGNED_OUT") {
          router.refresh();
        }
      },
    );
    return () => {
      sub.subscription.unsubscribe();
    };
  }, [router]);
}
