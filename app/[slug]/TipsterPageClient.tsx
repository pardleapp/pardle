"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/app/live/auth/useAuth";
import FeedClient from "@/app/live/FeedClient";

interface ChannelView {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  bio: string | null;
  isPublic: boolean;
  inviteCode?: string;
  followerCount: number;
  viewer: {
    isOwner: boolean;
    isFollower: boolean;
    notifyOnNewTip: boolean;
  } | null;
}

interface Tip {
  id: string;
  kind: string;
  placedAt: number;
  rationale: string | null;
  // Variable-shape bet fields (player, odds, etc.) — preserved verbatim.
  [k: string]: unknown;
}

interface ChatMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string | null;
  ts: number;
  text: string;
  refBetId: string | null;
}

const REFRESH_MS = 5_000;

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

function summariseTip(t: Tip): string {
  const odds = (t.oddsTakenLabel as string) ?? "";
  const stake = (t.stake as number) ?? null;
  const stakeStr = stake ? ` · ${gbp.format(stake)}` : "";
  if (t.kind === "outright") {
    return `${(t.playerName as string) ?? "?"} to win${odds ? ` @ ${odds}` : ""}${stakeStr}`;
  }
  if (t.kind === "top-finish") {
    return `${(t.playerName as string) ?? "?"} top ${t.cutoff ?? "?"}${odds ? ` @ ${odds}` : ""}${stakeStr}`;
  }
  if (t.kind === "round-score") {
    return `${(t.playerName as string) ?? "?"} R${t.round ?? "?"} ${t.side ?? ""} ${t.line ?? ""}${odds ? ` @ ${odds}` : ""}${stakeStr}`;
  }
  if (t.kind === "winning-score") {
    return `Winning score ${t.side ?? ""} ${t.line ?? ""}${odds ? ` @ ${odds}` : ""}${stakeStr}`;
  }
  return "Tip";
}

function relTime(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function TipsterPageClient({
  channel: initialChannel,
  initialInvite,
  isFresh,
}: {
  channel: ChannelView;
  initialInvite: string | null;
  isFresh: boolean;
}) {
  const { user, loading: authLoading } = useAuth();
  const [channel, setChannel] = useState<ChannelView>(initialChannel);
  // Default to "feed" so when followers land during live play they
  // see the action immediately. Tips + Chat are one tap away.
  const [tab, setTab] = useState<"feed" | "tips" | "chat">("feed");
  const [tips, setTips] = useState<Tip[]>([]);
  const [tipsLoading, setTipsLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [bannerCopied, setBannerCopied] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const isMember = channel.viewer?.isOwner || channel.viewer?.isFollower;

  const reload = useCallback(async () => {
    if (!isMember) {
      setTips([]);
      setMessages([]);
      setTipsLoading(false);
      return;
    }
    try {
      const [t, m] = await Promise.all([
        fetch(`/api/channels/${channel.slug}/tips`, { cache: "no-store" }),
        fetch(`/api/channels/${channel.slug}/messages`, { cache: "no-store" }),
      ]);
      if (t.ok) {
        const j = (await t.json()) as { tips: Tip[] };
        setTips(j.tips ?? []);
      }
      if (m.ok) {
        const j = (await m.json()) as { messages: ChatMessage[] };
        setMessages(j.messages ?? []);
      }
    } catch {
      // Network blip — next tick will retry.
    } finally {
      setTipsLoading(false);
    }
  }, [channel.slug, isMember]);

  useEffect(() => {
    reload();
    const id = setInterval(reload, REFRESH_MS);
    return () => clearInterval(id);
  }, [reload]);

  // Auto-scroll the chat to the latest message when new ones arrive.
  useEffect(() => {
    if (tab !== "chat") return;
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, tab]);

  async function follow() {
    if (followBusy) return;
    setFollowBusy(true);
    try {
      const res = await fetch(`/api/channels/${channel.slug}/follow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteCode: initialInvite ?? undefined }),
      });
      if (res.ok) {
        // Refetch channel view to pick up new follower state.
        const r = await fetch(`/api/channels/${channel.slug}`, {
          cache: "no-store",
        });
        if (r.ok) {
          const j = (await r.json()) as {
            channel: ChannelView["viewer"] extends infer V
              ? Omit<ChannelView, "viewer" | "followerCount"> & {
                  inviteCode?: string;
                }
              : never;
            followerCount: number;
            viewer: ChannelView["viewer"];
          };
          setChannel((c) => ({
            ...c,
            followerCount: j.followerCount,
            viewer: j.viewer,
          }));
        }
      } else {
        const j = (await res.json()) as { reason?: string; error?: string };
        alert(j.reason ?? j.error ?? "Couldn't follow");
      }
    } catch {
      alert("Network error");
    } finally {
      setFollowBusy(false);
    }
  }

  async function unfollow() {
    if (followBusy || !confirm(`Unfollow @${channel.slug}?`)) return;
    setFollowBusy(true);
    try {
      await fetch(`/api/channels/${channel.slug}/unfollow`, {
        method: "POST",
      });
      setChannel((c) => ({
        ...c,
        viewer: c.viewer
          ? { ...c.viewer, isFollower: false, notifyOnNewTip: false }
          : null,
        followerCount: Math.max(0, c.followerCount - 1),
      }));
    } finally {
      setFollowBusy(false);
    }
  }

  async function track(tip: Tip) {
    if (trackingId) return;
    setTrackingId(tip.id);
    try {
      const res = await fetch(
        `/api/channels/${channel.slug}/tips/${tip.id}/track`,
        { method: "POST" },
      );
      if (!res.ok) {
        const j = (await res.json()) as { reason?: string };
        alert(j.reason ?? "Couldn't track that tip");
      } else {
        // Success feedback handled by the button label flip.
        setTimeout(() => setTrackingId(null), 1200);
        return;
      }
    } catch {
      alert("Network error");
    }
    setTrackingId(null);
  }

  async function sendChat(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (chatSending) return;
    const text = chatInput.trim();
    if (!text) return;
    setChatSending(true);
    // Optimistic — drop a placeholder so the bubble appears instantly.
    const optimisticId = `opt-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: optimisticId,
      channelId: channel.id,
      authorId: user?.id ?? "self",
      authorName: "You",
      ts: Date.now(),
      text,
      refBetId: null,
    };
    setMessages((m) => [...m, optimistic]);
    setChatInput("");
    try {
      const res = await fetch(`/api/channels/${channel.slug}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        setMessages((m) => m.filter((x) => x.id !== optimisticId));
        const j = (await res.json()) as { reason?: string };
        alert(j.reason ?? "Couldn't send");
      } else {
        // Real row lands on next reload tick (≤5s). Replace optimistic
        // with the server message id so the dedup is correct.
        const j = (await res.json()) as { message: ChatMessage };
        setMessages((m) =>
          m.map((x) => (x.id === optimisticId ? j.message : x)),
        );
      }
    } finally {
      setChatSending(false);
    }
  }

  function copyInvite() {
    if (!channel.inviteCode) return;
    const url = `${window.location.origin}/${channel.slug}?invite=${channel.inviteCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setBannerCopied(true);
      setTimeout(() => setBannerCopied(false), 1500);
    });
  }

  return (
    <section className="tipster-page">
      <header className="tipster-header">
        <div className="tipster-header-main">
          <h2 className="tipster-name">{channel.name}</h2>
          <p className="tipster-handle">@{channel.slug}</p>
          {channel.bio && <p className="tipster-bio">{channel.bio}</p>}
          <p className="tipster-meta">
            {channel.followerCount}{" "}
            {channel.followerCount === 1 ? "follower" : "followers"} ·{" "}
            {channel.isPublic ? "Public" : "Invite only"}
          </p>
        </div>
        <div className="tipster-header-actions">
          {authLoading ? null : !user ? (
            <Link href="/" className="tipster-cta">
              Sign in to follow
            </Link>
          ) : channel.viewer?.isOwner ? (
            <button
              type="button"
              className="tipster-cta tipster-cta-secondary"
              onClick={copyInvite}
            >
              {bannerCopied ? "Copied ✓" : "Copy invite link"}
            </button>
          ) : channel.viewer?.isFollower ? (
            <button
              type="button"
              className="tipster-cta tipster-cta-secondary"
              onClick={unfollow}
              disabled={followBusy}
            >
              {followBusy ? "…" : "Following ✓"}
            </button>
          ) : (
            <button
              type="button"
              className="tipster-cta"
              onClick={follow}
              disabled={followBusy}
            >
              {followBusy ? "…" : "Follow"}
            </button>
          )}
        </div>
      </header>

      {isFresh && channel.viewer?.isOwner && (
        <div className="tipster-onboard">
          <p>
            <strong>Page created.</strong> Share the invite link to bring in
            your first followers — tap “Copy invite link” above.
          </p>
        </div>
      )}

      {!isMember && !channel.isPublic && (
        <div className="tipster-locked">
          <p>This page is invite only.</p>
          <p className="tipster-locked-hint">
            If you have an invite link, open it and the Follow button will
            appear above. Otherwise ask @{channel.slug} directly.
          </p>
        </div>
      )}

      {!isMember && channel.isPublic && (
        <div className="tipster-locked">
          <p>Follow @{channel.slug} to see their tips and join the chat.</p>
        </div>
      )}

      {isMember && (
        <>
          <nav className="tipster-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "feed"}
              className={`feed-tab ${tab === "feed" ? "feed-tab-on" : ""}`}
              onClick={() => setTab("feed")}
            >
              Feed
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "tips"}
              className={`feed-tab ${tab === "tips" ? "feed-tab-on" : ""}`}
              onClick={() => setTab("tips")}
            >
              Tips {tips.length > 0 && `· ${tips.length}`}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "chat"}
              className={`feed-tab ${tab === "chat" ? "feed-tab-on" : ""}`}
              onClick={() => setTab("chat")}
            >
              Chat
            </button>
          </nav>

          {tab === "feed" && (
            <div className="tipster-feed-tab">
              <FeedClient />
            </div>
          )}

          {tab === "tips" && (
            <div className="tipster-tips">
              {channel.viewer?.isOwner && (
                <p className="tipster-tips-hint">
                  Post a tip from your bet tracker on the live feed — open a
                  bet, scroll to the bottom, “Post as tip on @{channel.slug}”.
                  (Coming in the next update — for now, every bet you place is
                  visible only to you.)
                </p>
              )}
              {tipsLoading && tips.length === 0 ? (
                <p className="feed-empty">Loading tips…</p>
              ) : tips.length === 0 ? (
                <p className="feed-empty">
                  No tips yet. Followers will see new tips here as they land.
                </p>
              ) : (
                <ul className="tipster-tip-list">
                  {tips.map((t) => (
                    <li key={t.id} className="tipster-tip-card">
                      <div className="tipster-tip-headline">
                        {summariseTip(t)}
                      </div>
                      {t.rationale && (
                        <p className="tipster-tip-rationale">{t.rationale}</p>
                      )}
                      <div className="tipster-tip-foot">
                        <span className="tipster-tip-ts">
                          {relTime(t.placedAt)}
                        </span>
                        {!channel.viewer?.isOwner && (
                          <button
                            type="button"
                            className="tipster-tip-track"
                            onClick={() => track(t)}
                            disabled={trackingId === t.id}
                          >
                            {trackingId === t.id ? "Tracked ✓" : "Track this"}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "chat" && (
            <div className="tipster-chat">
              <div className="tipster-chat-scroll" ref={chatScrollRef}>
                {messages.length === 0 ? (
                  <p className="feed-empty tipster-chat-empty">
                    No messages yet. Say something.
                  </p>
                ) : (
                  messages.map((m) => {
                    const mine = m.authorId === user?.id;
                    return (
                      <div
                        key={m.id}
                        className={`tipster-msg ${mine ? "tipster-msg-mine" : ""}`}
                      >
                        {!mine && (
                          <span className="tipster-msg-author">
                            {m.authorName ?? "Someone"}
                          </span>
                        )}
                        <span className="tipster-msg-body">{m.text}</span>
                        <span className="tipster-msg-ts">{relTime(m.ts)}</span>
                      </div>
                    );
                  })
                )}
              </div>
              <form className="tipster-chat-input-row" onSubmit={sendChat}>
                <input
                  className="tipster-chat-input"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Say something…"
                  maxLength={1000}
                  disabled={chatSending}
                />
                <button
                  type="submit"
                  className="tipster-chat-send"
                  disabled={chatSending || !chatInput.trim()}
                >
                  Send
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </section>
  );
}
