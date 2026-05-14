"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

export default function AuthForm() {
  const params = useSearchParams();
  const error = params.get("error");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    try {
      await fetch("/api/fantasy/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <section className="fantasy-auth-sent">
        <h2 className="fantasy-hero-title">Check your email</h2>
        <p className="fantasy-hero-sub">
          We sent a sign-in link to <strong>{email}</strong>. Tap the
          button in the email to come back here signed in. The link
          expires in 15 minutes.
        </p>
        <p className="fantasy-hero-sub" style={{ fontSize: 13, marginTop: 12 }}>
          Don&apos;t see it? Check your spam folder. From{" "}
          <code>onboarding@resend.dev</code>.
        </p>
      </section>
    );
  }

  return (
    <section className="fantasy-auth-form">
      <h2 className="fantasy-hero-title">Sign in to play</h2>
      <p className="fantasy-hero-sub">
        We&apos;ll email you a one-tap sign-in link. No passwords, no
        accounts to manage.
      </p>

      {error === "expired" && (
        <p className="fantasy-auth-error">
          That link expired or was already used. Enter your email again.
        </p>
      )}
      {error === "missing" && (
        <p className="fantasy-auth-error">
          That sign-in link was missing its token. Try again below.
        </p>
      )}

      <form onSubmit={submit} className="fantasy-auth-form-row">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="fantasy-auth-input"
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="fantasy-cta-primary"
        >
          {busy ? "Sending…" : "Send sign-in link"}
        </button>
      </form>
    </section>
  );
}
