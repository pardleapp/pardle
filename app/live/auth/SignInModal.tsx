"use client";

import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useDismissibleOverlay } from "@/app/_hooks/useDismissibleOverlay";

interface Props {
  open: boolean;
  onClose: () => void;
}

const VERIFY_TIMEOUT_MS = 12_000;

/** Wrap a promise with a timeout race so a stuck network call
 *  surfaces as an error instead of leaving the button on
 *  "Signing in…" forever. The explicit `<T>` annotation on the
 *  rejecting promise keeps TS's union narrowing happy — without
 *  it the race result widens to unknown. */
async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Promise<never> lets Promise.race resolve cleanly to T —
  // the timeout branch only ever rejects, so it contributes
  // nothing to the resolved value's type union.
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out`)),
      ms,
    );
  });
  try {
    return await Promise.race([p, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Email sign-in modal. After requesting the magic link the user gets
 * BOTH a one-tap link AND a 6–8 digit code in the same email. The
 * link works on desktop / when the email opens in the same browser
 * that requested it; the code is the cross-device fallback for the
 * common case of "tapped the link from Gmail's in-app browser and
 * the PKCE verifier isn't there."
 */
export default function SignInModal({ open, onClose }: Props) {
  useDismissibleOverlay(open, onClose);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<
    "idle" | "sending" | "sent" | "verifying" | "err"
  >("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  if (!open) return null;

  async function submitEmail(e: React.FormEvent) {
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

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length < 6) {
      setErrMsg("Enter the full code from the email.");
      return;
    }
    setStatus("verifying");
    setErrMsg(null);
    try {
      // POST to a server route handler instead of verifying via the
      // browser client. The route sets Supabase cookies via real
      // HTTP Set-Cookie response headers, which the browser persists
      // reliably across the reload below — fixing the bug where the
      // session cookie disappeared on the very next request.
      const verifyFetch = fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), token: trimmed }),
      });
      const res = await withTimeout(
        verifyFetch,
        VERIFY_TIMEOUT_MS,
        "Sign-in verify",
      );
      if (!res.ok) {
        const { error: msg } = (await res
          .json()
          .catch(() => ({ error: "Unknown error" }))) as { error?: string };
        setStatus("sent");
        setErrMsg(
          msg && /invalid|expired|incorrect/i.test(msg)
            ? "That code didn't work — check it again, or tap the link in the email."
            : msg ?? "Sign-in failed. Try the link in the email.",
        );
        setCode("");
        return;
      }
      // Hard reload so the next request carries the freshly-set
      // auth cookies and the server-rendered Groups gate re-runs
      // on the signed-in branch.
      onClose();
      window.location.reload();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[SignInModal] verify request threw", e);
      setStatus("sent");
      setErrMsg(
        e instanceof Error && e.message.includes("timed out")
          ? "Took too long. Check your connection and try again — or tap the link in the email."
          : "Couldn't sign in. Try the link in the email instead.",
      );
    }
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
        <h2 className="auth-modal-title">
          Save your bets across devices
        </h2>
        {status === "sent" || status === "verifying" ? (
          <div className="auth-modal-sent">
            <p>
              We sent a link <strong>and</strong> a code to{" "}
              <strong>{email}</strong>. Tap the link, or enter the
              code below if the link doesn&apos;t sign you in.
            </p>
            <form onSubmit={submitCode} className="auth-modal-form">
              <label className="auth-modal-label">
                <span>Code from email</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6,8}"
                  maxLength={8}
                  placeholder="00000000"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 8))
                  }
                  autoFocus
                  autoComplete="one-time-code"
                />
              </label>
              {errMsg && <p className="auth-modal-err">{errMsg}</p>}
              <button
                type="submit"
                className="auth-modal-btn"
                disabled={status === "verifying" || code.length < 6}
              >
                {status === "verifying" ? "Signing in…" : "Sign in with code"}
              </button>
            </form>
            <button
              type="button"
              className="auth-modal-btn-secondary"
              onClick={() => {
                setStatus("idle");
                setCode("");
                setErrMsg(null);
              }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={submitEmail} className="auth-modal-form">
            <ul className="auth-modal-benefits">
              <li>
                <strong>Save your bets across devices</strong> — phone, laptop,
                same view
              </li>
              <li>
                <strong>Push when your bets move</strong> — big swings + final
                settlement
              </li>
              <li>
                <strong>Post tips on your own channel</strong> — share picks
                with followers
              </li>
              <li>
                <strong>Climb the Putt-IQ leaderboard</strong> — accuracy
                ranked by tournament
              </li>
            </ul>
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
              We&apos;ll send a sign-in link and a code. No password.
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
