"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useAuth } from "./useAuth";
import SignInModal from "./SignInModal";
import DisplayNamePrompt from "./DisplayNamePrompt";

/**
 * Header chip showing current auth state. Anonymous → "Sign in"
 * button opens the magic-link modal. Signed-in → display name (with
 * a click-out menu containing Sign out). First-time signed-in users
 * see the display-name prompt overlay until they pick one.
 */
export default function AuthChip() {
  const { loading, user } = useAuth();
  const [signInOpen, setSignInOpen] = useState(false);
  const [needsName, setNeedsName] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setDisplayName(null);
      setNeedsName(false);
      return;
    }
    const supabase = getSupabaseBrowser();
    supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(
        (res: {
          data: { display_name?: string | null } | null;
        }) => {
          if (res.data?.display_name) {
            setDisplayName(res.data.display_name);
            setNeedsName(false);
          } else {
            setNeedsName(true);
          }
        },
      );
  }, [user]);

  async function signOut() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    setMenuOpen(false);
  }

  if (loading) {
    return <span className="auth-chip auth-chip-loading">…</span>;
  }

  if (!user) {
    return (
      <>
        <button
          type="button"
          className="auth-chip auth-chip-signin"
          onClick={() => setSignInOpen(true)}
        >
          Sign in
        </button>
        <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
      </>
    );
  }

  return (
    <>
      <span className="auth-chip-wrap">
        <button
          type="button"
          className="auth-chip auth-chip-user"
          onClick={() => setMenuOpen((m) => !m)}
        >
          {displayName ?? user.email ?? "You"}
        </button>
        {menuOpen && (
          <div className="auth-chip-menu">
            <button
              type="button"
              className="auth-chip-menu-item"
              onClick={signOut}
            >
              Sign out
            </button>
          </div>
        )}
      </span>
      {needsName && (
        <DisplayNamePrompt
          userId={user.id}
          onComplete={() => {
            setNeedsName(false);
            // Re-fetch the name we just saved.
            const supabase = getSupabaseBrowser();
            supabase
              .from("profiles")
              .select("display_name")
              .eq("user_id", user.id)
              .maybeSingle()
              .then(
                (res: {
                  data: { display_name?: string | null } | null;
                }) => {
                  if (res.data?.display_name)
                    setDisplayName(res.data.display_name);
                },
              );
          }}
        />
      )}
    </>
  );
}
