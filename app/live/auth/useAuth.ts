"use client";

import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthState {
  loading: boolean;
  user: AuthUser | null;
}

/**
 * Subscribe to the current Supabase auth state. Returns loading
 * until the initial getUser call resolves, then keeps the user
 * synced via onAuthStateChange (covers magic-link redirects,
 * sign-out from another tab, etc.).
 */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ loading: true, user: null });

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let cancelled = false;

    supabase.auth.getUser().then((res: { data: { user: User | null } }) => {
      if (cancelled) return;
      const u = res.data.user;
      setState({
        loading: false,
        user: u ? { id: u.id, email: u.email ?? null } : null,
      });
    });

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: string, session: Session | null) => {
        const u = session?.user;
        setState({
          loading: false,
          user: u ? { id: u.id, email: u.email ?? null } : null,
        });
      },
    );

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
