"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";

interface Props {
  userId: string;
  onComplete: () => void;
}

/**
 * Full-screen prompt shown on first sign-in. The user picks a display
 * name we'll show on their bets, comments, reactions. Skipping isn't
 * offered — without a name the social fabric reads as anonymous IDs.
 */
export default function DisplayNamePrompt({ userId, onComplete }: Props) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "err">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // Skip the prompt if the user already has a display_name. Avoids
  // showing it every time auth state refreshes.
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", userId)
      .maybeSingle()
      .then(
        (res: { data: { display_name?: string | null } | null }) => {
          if (res.data?.display_name) {
            onComplete();
          }
          setChecking(false);
        },
      );
  }, [userId, onComplete]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 24) {
      setErrMsg("Pick something between 2 and 24 characters.");
      setStatus("err");
      return;
    }
    setStatus("saving");
    setErrMsg(null);
    const supabase = getSupabaseBrowser();
    const authorKey =
      typeof window !== "undefined"
        ? window.localStorage.getItem("pardle_feed_author")
        : null;
    const { error } = await supabase
      .from("profiles")
      .upsert(
        {
          user_id: userId,
          display_name: trimmed,
          author_key: authorKey,
        },
        { onConflict: "user_id" },
      );
    if (error) {
      setStatus("err");
      setErrMsg(error.message);
      return;
    }
    onComplete();
  }

  if (checking) return null;

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true">
      <div className="auth-modal">
        <h2 className="auth-modal-title">Pick a display name</h2>
        <p className="auth-modal-blurb">
          Other Pardle users will see this on your bets and comments.
        </p>
        <form onSubmit={submit} className="auth-modal-form">
          <label className="auth-modal-label">
            <span>Display name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              autoFocus
              autoComplete="off"
              required
            />
          </label>
          {errMsg && <p className="auth-modal-err">{errMsg}</p>}
          <button
            type="submit"
            className="auth-modal-btn"
            disabled={status === "saving"}
          >
            {status === "saving" ? "Saving…" : "Save"}
          </button>
        </form>
      </div>
    </div>
  );
}
