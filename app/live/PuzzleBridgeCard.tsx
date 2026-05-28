"use client";

/**
 * Bridge card shown on the end-of-puzzle screen for /pros, /holes,
 * /faces. Turns the dopamine moment from solving today's puzzle
 * into a one-tap entry into the live-feed gamification loop
 * (putt-polls + Sharp Score) so daily-puzzle regulars actually
 * discover the live surface.
 *
 * Picks the loudest hook available in this order:
 *   1. Open putt poll on right now → "Call Scheffler's birdie putt"
 *   2. The user's puzzle-answer players are in the live field →
 *      "You knew Rory — he's T3 thru 11, watch live →"
 *   3. Tournament live but no specific hook → "Live: The Open R2 →"
 *   4. Pre-tournament within 3 days → "Tees off in 2 days →"
 *   5. No tournament window → null (no card rendered)
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BridgeStateResponse } from "@/app/api/bridge/state/route";

interface Props {
  /** Optional puzzle-answer player names so the card can match
   *  against the live leaderboard and personalise the pitch. Pros
   *  passes the mystery player; Faces passes the day's 12 names. */
  players?: string[];
  /** Which game spawned this — drives the personalised copy
   *  (you knew Rory / you matched 12 faces / you guessed Augusta). */
  game: "pros" | "holes" | "faces";
}

// Per-session cache so re-rendering the post-game screen doesn't
// re-fetch; the data changes too slowly for it to matter.
const cache = new Map<string, BridgeStateResponse>();

export default function PuzzleBridgeCard({ players, game }: Props) {
  const cacheKey = `${game}::${(players ?? []).join("|")}`;
  const [data, setData] = useState<BridgeStateResponse | null>(
    () => cache.get(cacheKey) ?? null,
  );

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    const qs =
      players && players.length > 0
        ? `?players=${encodeURIComponent(players.join(","))}`
        : "";
    (async () => {
      try {
        const res = await fetch(`/api/bridge/state${qs}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as BridgeStateResponse;
        if (cancelled) return;
        cache.set(cacheKey, json);
        setData(json);
      } catch {
        // No card if the probe fails — the rest of the post-game
        // screen still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, data, players]);

  if (!data) return null;
  if (!data.isLive && !data.daysToNextEvent) return null;

  // ── Variant 1: open putt poll right now (loudest hook) ──────
  if (data.openPoll) {
    const p = data.openPoll;
    const distance =
      p.puttDistanceFt != null ? `${p.puttDistanceFt}ft ` : "";
    return (
      <Link
        href={`/?poll=${encodeURIComponent(p.pollId)}#feed`}
        className="bridge-card bridge-card-poll"
      >
        <div className="bridge-card-tag">⚡ Live putt</div>
        <p className="bridge-card-title">
          {p.playerName} has a {distance}
          {p.puttFor} on the {ordinal(p.holeNum)}.
        </p>
        <p className="bridge-card-sub">
          Call it before it drops — builds your Sharp Score.
        </p>
        <span className="bridge-card-cta">Cast a call →</span>
      </Link>
    );
  }

  // ── Variant 2: personalised player match ────────────────────
  if (data.isLive && data.activePlayers.length > 0) {
    const first = data.activePlayers[0];
    const extra = data.activePlayers.length - 1;
    const ledIn = personalLeadIn(game, first.name, extra);
    return (
      <Link
        href={`/live/player/${encodeURIComponent(first.playerId)}`}
        className="bridge-card bridge-card-player"
      >
        <div className="bridge-card-tag">⛳ Live now</div>
        <p className="bridge-card-title">{ledIn}</p>
        <p className="bridge-card-sub">
          <strong>{first.name}</strong> · {first.position} ·{" "}
          {first.total} thru {first.thru}
          {extra > 0 && (
            <>
              {" "}· +{extra} more of yours in the field
            </>
          )}
        </p>
        <span className="bridge-card-cta">Watch their round →</span>
      </Link>
    );
  }

  // ── Variant 3: tournament live, no player match ─────────────
  if (data.isLive && data.tournament) {
    return (
      <Link href="/" className="bridge-card bridge-card-generic">
        <div className="bridge-card-tag">⛳ Live now</div>
        <p className="bridge-card-title">
          {data.tournament.name} is live.
        </p>
        <p className="bridge-card-sub">
          Putt polls fire every few minutes — call them right to
          build your Sharp Score.
        </p>
        <span className="bridge-card-cta">Open the live feed →</span>
      </Link>
    );
  }

  // ── Variant 4: tees off soon ───────────────────────────────
  if (
    data.tournament &&
    data.daysToNextEvent != null &&
    data.daysToNextEvent <= 3
  ) {
    const dayCopy =
      data.daysToNextEvent === 0
        ? "tees off today"
        : data.daysToNextEvent === 1
          ? "tees off tomorrow"
          : `tees off in ${data.daysToNextEvent} days`;
    return (
      <Link href="/sharp" className="bridge-card bridge-card-upcoming">
        <div className="bridge-card-tag">📅 Up next</div>
        <p className="bridge-card-title">
          {data.tournament.name} {dayCopy}.
        </p>
        <p className="bridge-card-sub">
          Get sharp before the gun — see who&apos;s topping the
          credibility leaderboard.
        </p>
        <span className="bridge-card-cta">See Sharp Score →</span>
      </Link>
    );
  }

  return null;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/** Per-game lead-in line so the card reads like it knows what the
 *  user just did. Pros + Faces personalise to the answer; Holes is
 *  generic since the puzzle is course-based not player-based. */
function personalLeadIn(
  game: "pros" | "holes" | "faces",
  topName: string,
  extra: number,
): string {
  if (game === "pros") {
    return `You guessed ${topName}.`;
  }
  if (game === "faces") {
    if (extra === 0) return `${topName} is in the field.`;
    return `${extra + 1} of today's faces are in the field.`;
  }
  // Holes — the puzzle is about a course, not a player; the live
  // tournament is rarely at the same course, so the hook is just
  // generic "see who's out there".
  return `${topName} is out there now.`;
}
