"use client";

/**
 * Pre-event winner pick UI. Lives at /picks and is also linked
 * from the home-feed OffWeekLanding when an event is coming up
 * within 7 days. User picks one outright winner from the field;
 * pick locks at tee-off; settles to Sharp Score once the
 * tournament concludes.
 *
 * Anonymous-friendly — the authorKey is enough to attribute the
 * pick and earn Sharp Score credit. Display name is optional and
 * decorates the future leaderboard.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EventPickResponse } from "@/app/api/picks/event/route";
import { useToast } from "@/app/live/Toast";

const AUTHOR_KEY_STORAGE = "pardle_feed_author";
const NAME_STORAGE = "pardle_feed_name";

function getAuthorKey(): string {
  if (typeof window === "undefined") return "";
  let k = window.localStorage.getItem(AUTHOR_KEY_STORAGE);
  if (!k) {
    k = `a${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(AUTHOR_KEY_STORAGE, k);
  }
  return k;
}

export default function EventPickClient() {
  const toast = useToast();
  const [data, setData] = useState<EventPickResponse | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const authorKey = useRef("");
  const [name, setName] = useState("");

  useEffect(() => {
    authorKey.current = getAuthorKey();
    setName(window.localStorage.getItem(NAME_STORAGE) ?? "");
  }, []);

  const load = useCallback(async () => {
    try {
      const k = authorKey.current;
      const res = await fetch(
        `/api/picks/event${k ? `?v=${encodeURIComponent(k)}` : ""}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as EventPickResponse;
      setData(json);
      setLoadErr(false);
    } catch {
      setLoadErr(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = query.toLowerCase().trim();
    if (!needle) return data.field.slice(0, 12);
    return data.field
      .filter((p) => p.displayName.toLowerCase().includes(needle))
      .slice(0, 12);
  }, [data, query]);

  async function pick(playerId: string, playerName: string) {
    if (saving) return;
    if (!authorKey.current) authorKey.current = getAuthorKey();
    setSaving(true);
    try {
      const trimmedName = name.trim().slice(0, 30);
      if (trimmedName) {
        window.localStorage.setItem(NAME_STORAGE, trimmedName);
      }
      const res = await fetch("/api/picks/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authorKey: authorKey.current,
          playerId,
          playerName,
          displayName: trimmedName || undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          reason?: string;
          error?: string;
        };
        toast.error(
          j.reason ?? j.error ?? "Couldn't save that pick — try again.",
        );
        return;
      }
      toast.success(`Pick locked in: ${playerName}`);
      setQuery("");
      load();
    } catch {
      toast.error("Network hiccup — try again in a moment.");
    } finally {
      setSaving(false);
    }
  }

  if (loadErr && !data) {
    return (
      <p className="feed-empty">
        Couldn&apos;t load this week&apos;s pick — retry shortly.
      </p>
    );
  }
  if (!data) {
    return (
      <div className="picks-skeleton" aria-busy="true">
        <div className="skeleton-line picks-skel-title" />
        <div className="skeleton-block picks-skel-card" />
      </div>
    );
  }

  if (!data.tournament) {
    return (
      <section className="picks-empty">
        <p className="lb-offweek-eyebrow">No event scheduled</p>
        <h2 className="lb-offweek-title">Nothing to call right now.</h2>
        <p className="lb-offweek-blurb">
          Picks open as soon as the next PGA Tour event lands on the
          schedule. In the meantime, build your Sharp Score on
          putt-polls during live rounds.
        </p>
      </section>
    );
  }

  const tournament = data.tournament;
  const teeOff = new Date(tournament.startDate);
  const days = Math.max(
    0,
    Math.ceil((tournament.startDate - Date.now()) / 86_400_000),
  );
  const lockCopy = tournament.locked
    ? "Picks locked — tournament has teed off."
    : days === 0
      ? "Tees off today — last chance to call it."
      : days === 1
        ? "Tees off tomorrow."
        : `${days} days to tee-off.`;

  return (
    <section className="picks-page">
      <div className="picks-page-head">
        <p className="picks-eyebrow">⚡ Pick the winner</p>
        <h2 className="picks-page-title">{tournament.name}</h2>
        <p className="picks-page-sub">
          {teeOff.toLocaleDateString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
          })}{" "}
          · <strong>{lockCopy}</strong>
        </p>
        {data.pickCount > 0 && (
          <p className="picks-pickcount">
            {data.pickCount} {data.pickCount === 1 ? "caller has" : "callers have"}{" "}
            locked in their pick this week.
          </p>
        )}
      </div>

      {data.pick && (
        <div className="picks-current">
          <p className="picks-current-label">Your pick</p>
          <p className="picks-current-name">{data.pick.playerName}</p>
          {!tournament.locked && (
            <p className="picks-current-hint">
              Change it anytime before tee-off.
            </p>
          )}
        </div>
      )}

      {!tournament.locked && (
        <>
          <div className="picks-name-row">
            <label className="picks-name-label">
              Display name (optional)
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="So others know who called it"
                maxLength={30}
                className="picks-name-input"
              />
            </label>
          </div>

          <div className="picks-search-row">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the field…"
              className="picks-search-input"
              aria-label="Search the field"
            />
          </div>

          <ol className="picks-field">
            {filtered.length === 0 ? (
              <li className="picks-field-empty">
                No players match. Try a different name.
              </li>
            ) : (
              filtered.map((p) => {
                const isCurrent = data.pick?.playerId === p.playerId;
                return (
                  <li key={p.playerId}>
                    <button
                      type="button"
                      className={`picks-field-row ${
                        isCurrent ? "picks-field-row-on" : ""
                      }`}
                      disabled={saving}
                      onClick={() => pick(p.playerId, p.displayName)}
                    >
                      <span className="picks-field-name">{p.displayName}</span>
                      <span className="picks-field-cta">
                        {isCurrent ? "✓ Picked" : "Pick"}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ol>

          <p className="picks-foot">
            Picks settle automatically when the tournament concludes.
            Right or wrong, your call counts toward your Sharp Score.
          </p>
        </>
      )}
    </section>
  );
}
