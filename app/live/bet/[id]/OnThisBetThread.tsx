"use client";

/**
 * OnThisBetThread — chat-on-a-bet surface inside the bet-detail
 * page. Connects the prototype's "On this bet · N tailing" social
 * row to the real group_messages backend so commenting on a bet
 * and group chat are one system, not two.
 *
 * Flow:
 *   1. Fetch the signed-in user's groups (/api/groups/me).
 *   2. If they're in zero groups → render nothing (a non-member
 *      shouldn't see a comments composer for a private surface).
 *   3. If they're in ≥1 group, default to the first one and load
 *      that group's messages filtered to bet_id = this bet.
 *   4. Mount <GroupChat> with betIdFilter + defaultBetId so every
 *      message sent here attaches to this bet and lands in the
 *      group's main chat with the inline bet chip rendered.
 *
 * Multi-group picker is a follow-up; v1 defaults to "your first
 * group" which matches the natural mental model (most users will
 * be in one private crew during launch).
 */

import { useEffect, useState } from "react";
import GroupChat from "@/app/groups/GroupChat";
import { useAuth } from "@/app/live/auth/useAuth";
import type { GroupMessageRow } from "@/lib/groups/server";

interface Props {
  betId: string;
}

interface MyGroup {
  id: string;
  name: string;
}

export default function OnThisBetThread({ betId }: Props) {
  const { loading: authLoading, user } = useAuth();
  const [group, setGroup] = useState<MyGroup | null>(null);
  const [messages, setMessages] = useState<GroupMessageRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/groups/me");
        if (!res.ok) throw new Error(`groups (${res.status})`);
        const json = (await res.json()) as {
          groups: Array<{ id: string; name: string }>;
        };
        const first = json.groups[0];
        if (cancelled) return;
        if (!first) {
          setGroup(null);
          setMessages([]);
          return;
        }
        setGroup({ id: first.id, name: first.name });
        const m = await fetch(
          `/api/groups/${encodeURIComponent(first.id)}/messages?bet_id=${encodeURIComponent(betId)}`,
        );
        if (!m.ok) throw new Error(`messages (${m.status})`);
        const mJson = (await m.json()) as { messages: GroupMessageRow[] };
        if (!cancelled) setMessages(mJson.messages);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, betId]);

  if (authLoading) return null;
  if (!user) return null;
  if (messages === null && !err) {
    return (
      <section className="bd-thread-card">
        <h4 className="bd-thread-h">On this bet</h4>
        <p className="bd-thread-loading">Loading comments…</p>
      </section>
    );
  }
  if (err) {
    return (
      <section className="bd-thread-card">
        <h4 className="bd-thread-h">On this bet</h4>
        <p className="bd-thread-loading">Couldn&rsquo;t load — {err}</p>
      </section>
    );
  }
  if (!group) {
    return (
      <section className="bd-thread-card">
        <h4 className="bd-thread-h">On this bet</h4>
        <p className="bd-thread-loading">
          Join or create a private group on{" "}
          <a href="/groups" className="bd-thread-link">
            /groups
          </a>{" "}
          to talk about this bet with your crew.
        </p>
      </section>
    );
  }

  return (
    <section className="bd-thread-card">
      <h4 className="bd-thread-h">
        On this bet · <span className="bd-thread-grp">{group.name}</span>
      </h4>
      <GroupChat
        groupId={group.id}
        currentUserId={user.id}
        initialMessages={messages ?? []}
        betIdFilter={betId}
        placeholder="Comment on this bet…"
        defaultBetId={betId}
      />
    </section>
  );
}
