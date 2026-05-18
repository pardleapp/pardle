"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useAuth } from "@/app/live/auth/useAuth";
import { validateSlug } from "@/lib/channels/reserved-slugs";

interface ApiError {
  error: string;
  reason?: string;
}

interface CreateResponse {
  channel?: {
    slug: string;
    inviteCode?: string;
  };
}

export default function CreateTipsterForm() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const slugCheck = useMemo(
    () => (slug ? validateSlug(slug) : { ok: true as const }),
    [slug],
  );

  if (authLoading) {
    return <p className="feed-empty">Loading…</p>;
  }
  if (!user) {
    return (
      <div className="tipster-create-gate">
        <p>
          Sign in to create your tipster page. We use a one-tap magic
          link — no password.
        </p>
        <p className="tipster-create-hint">
          (Tap the auth chip in the top right of the home page to sign in,
          then come back here.)
        </p>
      </div>
    );
  }

  const canSubmit =
    !submitting &&
    slug.trim().length >= 3 &&
    slugCheck.ok &&
    name.trim().length > 0 &&
    name.trim().length <= 60;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: slug.trim().toLowerCase(),
          name: name.trim(),
          bio: bio.trim() || undefined,
          isPublic,
        }),
      });
      const json = (await res.json()) as CreateResponse & ApiError;
      if (!res.ok) {
        setErr(json.reason ?? json.error ?? "Couldn't create the page");
        setSubmitting(false);
        return;
      }
      const createdSlug = json.channel?.slug ?? slug.trim().toLowerCase();
      const invite = json.channel?.inviteCode;
      const url = invite
        ? `/${createdSlug}?invite=${encodeURIComponent(invite)}&new=1`
        : `/${createdSlug}?new=1`;
      router.push(url);
    } catch {
      setErr("Network error — try again");
      setSubmitting(false);
    }
  }

  return (
    <form className="tipster-form" onSubmit={submit}>
      <label className="tipster-field">
        <span className="tipster-field-label">Handle</span>
        <div className="tipster-handle-row">
          <span className="tipster-handle-at">pardle.app/</span>
          <input
            className="tipster-input"
            value={slug}
            onChange={(e) =>
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
            }
            placeholder="golf-edge"
            maxLength={40}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        {slug && !slugCheck.ok && (
          <span className="tipster-field-err">{slugCheck.reason}</span>
        )}
        {slug && slugCheck.ok && (
          <span className="tipster-field-hint">
            People will find you at pardle.app/{slug}
          </span>
        )}
      </label>

      <label className="tipster-field">
        <span className="tipster-field-label">Page name</span>
        <input
          className="tipster-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Golf Edge"
          maxLength={60}
        />
      </label>

      <label className="tipster-field">
        <span className="tipster-field-label">
          Bio <span className="tipster-field-optional">(optional)</span>
        </span>
        <textarea
          className="tipster-input tipster-textarea"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="What you bet on, your win rate, anything you want followers to know."
          rows={3}
          maxLength={500}
        />
      </label>

      <fieldset className="tipster-field tipster-radio-group">
        <legend className="tipster-field-label">Who can join?</legend>
        <label className="tipster-radio">
          <input
            type="radio"
            checked={!isPublic}
            onChange={() => setIsPublic(false)}
          />
          <span>
            <strong>Invite only.</strong> Followers join via a private link you
            share. Recommended for paid services or close groups.
          </span>
        </label>
        <label className="tipster-radio">
          <input
            type="radio"
            checked={isPublic}
            onChange={() => setIsPublic(true)}
          />
          <span>
            <strong>Public.</strong> Anyone can find your page and follow.
            Recommended for free tipsters building an audience.
          </span>
        </label>
      </fieldset>

      {err && <p className="tipster-form-err">{err}</p>}

      <button
        type="submit"
        className="tipster-submit"
        disabled={!canSubmit}
      >
        {submitting ? "Creating…" : "Create my page"}
      </button>
    </form>
  );
}
