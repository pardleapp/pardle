"use client";

/**
 * DesktopRailChat — site-wide "Pardle Global" chat surface that
 * lives in the desktop right rail. Reuses GroupChat (realtime,
 * optimistic send, composer) against the well-known PARDLE_GLOBAL
 * group id; the global channel is just a regular group that every
 * user is auto-joined to (migration 0012).
 *
 * Lifecycle:
 *   1. on mount, ask /api/auth for the current session — when
 *      signed-out we render a compact sign-in CTA instead of the
 *      chat surface
 *   2. when signed-in, fetch the most recent N messages once via
 *      the existing /api/groups/[id]/messages route (which already
 *      gates on membership, dedups, and includes author_name /
 *      bet attachments)
 *   3. mount GroupChat with those initialMessages; it takes over
 *      realtime, composer state, dedup, etc.
 *
 * Layout: a fixed-height card so the chat scrolls inside itself
 * and doesn't push the rail's earlier blocks off-screen. The card
 * lives at the top of the rail to make it the rail's primary draw.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { GroupMessageRow } from "@/lib/groups/server";
import { useAuth } from "@/app/live/auth/useAuth";
import { PARDLE_GLOBAL_GROUP_ID } from "@/lib/chat/site";

// Lazy-load GroupChat — it pulls in @supabase/supabase-js for the
// realtime client. The right rail's other blocks don't depend on
// supabase-js so dynamic-importing keeps the rail's initial bundle
// lean for non-chat users.
const GroupChat = dynamic(() => import("@/app/groups/GroupChat"), {
  ssr: false,
  loading: () => <div className="rail-chat-loading">Loading…</div>,
});

const INITIAL_LIMIT = 50;

export default function DesktopRailChat() {
  const auth = useAuth();
  const [initial, setInitial] = useState<GroupMessageRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (auth.loading || !auth.user) return;
    let cancelled = false;
    fetch(
      `/api/groups/${PARDLE_GLOBAL_GROUP_ID}/messages?limit=${INITIAL_LIMIT}`,
      { cache: "no-store" },
    )
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<{ messages: GroupMessageRow[] }>;
      })
      .then((j) => {
        if (cancelled) return;
        setInitial(j.messages ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : "Couldn't load chat");
      });
    return () => {
      cancelled = true;
    };
  }, [auth.loading, auth.user]);

  return (
    <section className="desktop-ctx-block rail-chat">
      <div className="desktop-ctx-label desktop-ctx-label-row">
        <span>Global chat</span>
        <span className="rail-chat-live" aria-hidden="true">
          <span className="rail-chat-dot" /> Live
        </span>
      </div>
      <div className="rail-chat-card">
        {auth.loading ? (
          <div className="rail-chat-loading">Loading…</div>
        ) : !auth.user ? (
          <div className="rail-chat-signedout">
            <p className="rail-chat-signedout-copy">
              Sign in to chat with everyone watching this tournament.
            </p>
            <Link href="/groups" className="rail-chat-signedout-btn">
              Sign in
            </Link>
          </div>
        ) : err ? (
          <div className="rail-chat-loading">Chat is unavailable.</div>
        ) : initial == null ? (
          <div className="rail-chat-loading">Loading…</div>
        ) : (
          <GroupChat
            groupId={PARDLE_GLOBAL_GROUP_ID}
            currentUserId={auth.user.id}
            initialMessages={initial}
            placeholder="Say something to the room…"
          />
        )}
      </div>
    </section>
  );
}
