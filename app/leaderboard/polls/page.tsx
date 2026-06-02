"use client";

/**
 * /leaderboard/polls — Top putt-prediction callers for the active
 * tournament. Loads /api/leaderboard/polls with the caller's
 * authorKey so the "you" row appears alongside the public list.
 *
 * Anonymous-first: no auth, no signup. Display name is editable
 * inline and persisted to Redis via /api/leaderboard/polls/name.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { BRAND } from "@/lib/brand";
import AuthChip from "../../live/auth/AuthChip";
import MainNav from "../../MainNav";

const AUTHOR_KEY_STORAGE = "pardle_feed_author";

interface LbRow {
  authorKey: string;
  displayName: string;
  correct: number;
  total: number;
  accuracy: number;
}

interface LbResponse {
  ok: true;
  tournament: { id: string; name: string } | null;
  rows: LbRow[];
  me: {
    total: number;
    correct: number;
    currentStreak: number;
    longestStreak: number;
    tournament?: { total: number; correct: number };
    tournamentRank?: number | null;
  } | null;
  minPolls: number;
}

function getAuthorKey(): string {
  if (typeof window === "undefined") return "";
  let k = window.localStorage.getItem(AUTHOR_KEY_STORAGE);
  if (!k) {
    k = `a${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(AUTHOR_KEY_STORAGE, k);
  }
  return k;
}

export default function PollsLeaderboardPage() {
  const [data, setData] = useState<LbResponse | null>(null);
  const [error, setError] = useState(false);
  const authorKey = useRef("");
  const [nameDraft, setNameDraft] = useState("");
  const [nameStatus, setNameStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  const load = useCallback(async () => {
    try {
      const k = authorKey.current;
      const res = await fetch(
        `/api/leaderboard/polls?v=${encodeURIComponent(k)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as LbResponse;
      setData(json);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    authorKey.current = getAuthorKey();
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  async function saveName() {
    const name = nameDraft.trim().slice(0, 30);
    if (!name) return;
    setNameStatus("saving");
    try {
      await fetch("/api/leaderboard/polls/name", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorKey: authorKey.current, name }),
      });
      setNameStatus("saved");
      setTimeout(() => setNameStatus("idle"), 1400);
      load();
    } catch {
      setNameStatus("idle");
    }
  }

  return (
    <main className="container container-wide v4-theme pv-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="leaderboard" />
          <AuthChip />
        </div>
      </header>
      <p className="lb-page-tournament">
        Putt-call leaderboard
        {data?.tournament ? ` · ${data.tournament.name}` : ""}
      </p>

      {error && !data && (
        <p className="feed-empty">
          Couldn&apos;t load the leaderboard. It&apos;ll retry automatically.
        </p>
      )}
      {!data && !error && (
        <ul className="lb-skeleton-list" aria-label="Loading leaderboard">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="lb-skeleton-row">
              <div className="skeleton-line lb-skeleton-pos" />
              <div className="skeleton-avatar lb-skeleton-avatar" />
              <div className="skeleton-line lb-skeleton-name" />
              <div className="lb-skeleton-score">
                <div className="skeleton-line lb-skeleton-total" />
                <div className="skeleton-line lb-skeleton-thru" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && (
        <>
          {data.me && (data.me.tournament?.total ?? 0) > 0 && (
            <section className="puttlb-you">
              <p className="puttlb-you-label">You so far this tournament</p>
              <div className="puttlb-you-row">
                <span className="puttlb-you-record">
                  {data.me.tournament?.correct ?? 0}/{data.me.tournament?.total ?? 0}
                </span>
                <span className="puttlb-you-acc">
                  {Math.round(
                    ((data.me.tournament?.correct ?? 0) /
                      Math.max(1, data.me.tournament?.total ?? 0)) *
                      100,
                  )}
                  %
                </span>
                {data.me.currentStreak >= 2 && (
                  <span className="puttlb-you-streak">
                    🔥 {data.me.currentStreak} in a row
                  </span>
                )}
                {typeof data.me.tournamentRank === "number" ? (
                  <span className="puttlb-you-rank">
                    #{data.me.tournamentRank} this week
                  </span>
                ) : (
                  <span className="puttlb-you-need">
                    Need {data.minPolls - (data.me.tournament?.total ?? 0)}{" "}
                    more poll{(data.me.tournament?.total ?? 0) === data.minPolls - 1 ? "" : "s"}{" "}
                    to qualify
                  </span>
                )}
              </div>
              <div className="puttlb-name-row">
                <input
                  className="tipster-input"
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="Set a display name (so others know who you are)"
                  maxLength={30}
                />
                <button
                  type="button"
                  className="puttlb-name-save"
                  onClick={saveName}
                  disabled={nameStatus === "saving" || nameDraft.trim().length === 0}
                >
                  {nameStatus === "saved" ? "Saved" : nameStatus === "saving" ? "Saving…" : "Save"}
                </button>
              </div>
            </section>
          )}

          <h2 className="puttlb-h">Top callers this week</h2>
          {data.rows.length === 0 ? (
            <p className="feed-empty">
              No qualified callers yet. Cast {data.minPolls}+ poll votes to qualify.
            </p>
          ) : (
            <ol className="puttlb-list">
              {data.rows.map((row, i) => (
                <li
                  key={row.authorKey}
                  className={`puttlb-row ${
                    row.authorKey === authorKey.current ? "puttlb-row-me" : ""
                  }`}
                >
                  <span className="puttlb-rank">{i + 1}</span>
                  <span className="puttlb-name">{row.displayName}</span>
                  <span className="puttlb-acc">
                    {Math.round(row.accuracy * 100)}%
                  </span>
                  <span className="puttlb-record">
                    {row.correct}/{row.total}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </main>
  );
}
