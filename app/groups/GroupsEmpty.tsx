"use client";

/**
 * Cold-start empty state for /groups — shown when the signed-in
 * user is in zero groups. Offers two paths:
 *   1. Create a new private group (POST /api/groups/create) — opens
 *      a small inline form for the group name, then refreshes the
 *      page so the populated Groups view renders.
 *   2. Join with an invite code (POST /api/groups/join) — same
 *      page-refresh on success.
 *
 * Visual language matches the prototype's GroupsEmpty card (line
 * 436 of design-handoff/Pardle Social v2.html): big emoji, single
 * headline, blurb, two-button row. Light .pv tokens throughout.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "menu" | "create" | "join";

export default function GroupsEmpty() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("menu");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/groups/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't create group");
      setBusy(false);
    }
  }

  async function submitJoin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const normalised = code.trim().toUpperCase();
      const res = await fetch("/api/groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalised }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't join group");
      setBusy(false);
    }
  }

  return (
    <section className="groups-pv">
      <div className="groups-soon">
        <div className="groups-soon-emoji" aria-hidden="true">
          🏌️
        </div>
        <div className="groups-soon-title">You&rsquo;re not in a crew</div>
        <p className="groups-soon-blurb">
          Create a private group or join one with an invite code to start
          a shared P&amp;L race and chat.
        </p>

        {mode === "menu" && (
          <div className="groups-soon-cta-row">
            <button
              type="button"
              className="groups-soon-cta"
              onClick={() => setMode("create")}
            >
              Create a group
            </button>
            <button
              type="button"
              className="groups-soon-cta-quiet"
              onClick={() => setMode("join")}
            >
              Join with a code
            </button>
          </div>
        )}

        {mode === "create" && (
          <form className="groups-create-form" onSubmit={submitCreate}>
            <label className="groups-create-label" htmlFor="grp-name">
              Group name
            </label>
            <input
              id="grp-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Lads"
              maxLength={60}
              autoFocus
              disabled={busy}
              className="groups-create-input"
            />
            {err && <div className="groups-create-err">{err}</div>}
            <div className="groups-create-actions">
              <button
                type="button"
                className="groups-create-cancel"
                onClick={() => {
                  setMode("menu");
                  setErr(null);
                }}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="groups-soon-cta"
                disabled={busy || name.trim().length === 0}
              >
                {busy ? "Creating…" : "Create group"}
              </button>
            </div>
          </form>
        )}

        {mode === "join" && (
          <form className="groups-create-form" onSubmit={submitJoin}>
            <label className="groups-create-label" htmlFor="grp-code">
              Invite code
            </label>
            <input
              id="grp-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="WXMQ4K2P"
              maxLength={8}
              autoFocus
              disabled={busy}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="groups-create-input groups-create-input-mono"
            />
            {err && <div className="groups-create-err">{err}</div>}
            <div className="groups-create-actions">
              <button
                type="button"
                className="groups-create-cancel"
                onClick={() => {
                  setMode("menu");
                  setErr(null);
                }}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="groups-soon-cta"
                disabled={busy || code.trim().length < 8}
              >
                {busy ? "Joining…" : "Join group"}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
