"use client";

import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Magic-link sign-in modal. User enters email; Supabase sends them a
 * link; clicking the link drops them on /auth/callback which
 * exchanges the code for a session and redirects back here.
 */
export default function SignInModal({ open, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "err">(
    "idle",
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrMsg(null);
    const supabase = getSupabaseBrowser();
    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(
            window.location.pathname + window.location.search,
          )}`
        : undefined;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    });
    if (error) {
      setStatus("err");
      setErrMsg(error.message);
      return;
    }
    setStatus("sent");
  }

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true">
      <div className="auth-modal">
        <button
          type="button"
          className="auth-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
        <h2 className="auth-modal-title">Sign in to Pardle</h2>
        {status === "sent" ? (
          <div className="auth-modal-sent">
            <p>
              Check <strong>{email}</strong> for a sign-in link. Click it on
              this device to come back in.
            </p>
            <button
              type="button"
              className="auth-modal-btn-secondary"
              onClick={onClose}
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="auth-modal-form">
            <label className="auth-modal-label">
              <span>Email</span>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                inputMode="email"
              />
            </label>
            <p className="auth-modal-blurb">
              We&apos;ll send you a magic link. No password.
            </p>
            {errMsg && <p className="auth-modal-err">{errMsg}</p>}
            <button
              type="submit"
              className="auth-modal-btn"
              disabled={status === "sending"}
            >
              {status === "sending" ? "Sending…" : "Send magic link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
