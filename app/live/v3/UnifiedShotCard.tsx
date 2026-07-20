"use client";

/**
 * ONE card component used for EVERY shot event in v3 on desktop.
 *
 * Fixed skeleton — accent stripe · avatar · [ name / hole / time · verb
 * · context ] · score — same height (82 px) for every card so the
 * 2-column grid aligns cleanly.
 *
 * The card is intentionally information-dense but visually restrained:
 *   • Only the score number is coloured (green/red/muted).
 *   • The 3 px accent stripe carries priority: gold = Mine (followed
 *     or bet-tracked), blue = notable moment (ace/eagle/big move),
 *     invisible = default.
 *   • Everything else — hole, time, tag chip, context text — is
 *     monochrome muted so the eye locks onto the score.
 *   • Actions (react, share) live on a hover overlay so the card at
 *     rest reads clean.
 *
 * Diagrams, impact chips, poll widgets etc. that ShotPost carries are
 * intentionally OMITTED — this card is a streaming update, not a
 * detail view. Tap the card to open ShotDetail if needed.
 */

import type { FeedEvent } from "@/lib/feed/types";
import PlayerAvatar from "../PlayerAvatar";

interface Props {
  event: FeedEvent;
  /** Optional context tag ("Now solo leader", "3rd bogey", …) —
   *  shown as muted secondary text under the verb. Truncated with
   *  ellipsis; keep it short. */
  contextTag?: string | null;
  /** Priority signals from the ranker. Used ONLY for accent-stripe
   *  colour; card size stays uniform regardless. */
  isMine: boolean;
  isNotable: boolean;
  onOpen?: () => void;
  onReact?: () => void;
  onShare?: () => void;
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function holeLabel(hole: number | undefined): string {
  if (typeof hole !== "number") return "";
  const s = (n: number) => {
    if (n % 100 >= 11 && n % 100 <= 13) return "th";
    if (n % 10 === 1) return "st";
    if (n % 10 === 2) return "nd";
    if (n % 10 === 3) return "rd";
    return "th";
  };
  return `${hole}${s(hole)}`;
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function scorePolarity(toPar: string | undefined): "under" | "over" | "even" | "none" {
  if (!toPar) return "none";
  const t = toPar.trim();
  if (t === "" || t === "-") return "none";
  if (/^e$/i.test(t)) return "even";
  if (t.startsWith("+")) return "over";
  if (t.startsWith("-") || t.startsWith("−")) return "under";
  return "none";
}

function formatScore(toPar: string | undefined): string {
  if (!toPar) return "—";
  return toPar.replace(/^-/, "−");
}

/** Format the anchor number for a shot event — shot-type appropriate:
 *   drive/tee → distance in yards (e.g. "342 y")
 *   putt      → distance in feet  (e.g. "12 ft")
 *   approach/chip/sand → proximity to pin AFTER the shot (e.g. "4 ft")
 *  Falls back to the collector's `imgToPin` display string, then to a
 *  neutral em-dash. Returns null when the caller should use the
 *  normal score anchor instead (non-shot events, or shots with no
 *  usable enrichment). */
function formatShotAnchor(ev: FeedEvent, kind: string): string | null {
  if (ev.type !== "shot") return null;
  // Putts and drives use imgShotDistance directly.
  if (kind === "putt") {
    if (
      typeof ev.imgShotDistance === "number" &&
      ev.imgShotDistanceUnit === "ft"
    ) {
      return `${Math.round(ev.imgShotDistance)} ft`;
    }
    // Fallback: proximity BEFORE the putt = putt distance.
    if (typeof ev.proximityInches === "number") {
      return `${Math.round(ev.proximityInches / 12)} ft`;
    }
  }
  if (kind === "drive" || kind === "tee") {
    if (
      typeof ev.imgShotDistance === "number" &&
      ev.imgShotDistanceUnit === "yds"
    ) {
      return `${Math.round(ev.imgShotDistance)} y`;
    }
    if (typeof ev.shotYards === "number") {
      return `${Math.round(ev.shotYards)} y`;
    }
  }
  // Approach / chip / sand — show proximity AFTER the shot (how close
  // it finished to the pin). If the shot event carries `proximityInches`,
  // that IS post-shot proximity from the collector's shot record.
  if (typeof ev.proximityInches === "number") {
    const ft = ev.proximityInches / 12;
    if (ft < 100) return `${Math.round(ft)} ft`;
    return `${Math.round(ft / 3)} y`;
  }
  // Last resort: the collector's own display string.
  if (ev.imgToPin) return ev.imgToPin;
  return "—";
}

/** Shot-type classifier for live IMG-sourced shot events. Uses the
 *  surface + shot-number signal from the collector to distinguish
 *  drive / approach / putt / chip / bunker. Falls back to a generic
 *  SHOT tag when the enrichment fields are absent. */
function shotTag(ev: FeedEvent): { text: string; kind: string } {
  const surface = (ev.imgSurface ?? "").toLowerCase();
  const shotNum = ev.imgShotNum ?? 0;
  const par = ev.par ?? 0;
  // Putts always start from the green — cheapest signal.
  if (surface === "green" || surface === "putting green" || surface === "fringe") {
    return { text: "PUTT", kind: "putt" };
  }
  if (surface.includes("sand") || surface.includes("bunker")) {
    return { text: "SAND", kind: "sand" };
  }
  // Tee shot on a par-4/5 = drive. Par-3 tee shot is an approach.
  if (shotNum === 1) {
    if (par === 3) return { text: "TEE", kind: "tee" };
    return { text: "DRIVE", kind: "drive" };
  }
  // Short-game shots off the green — proximity is small, surface is
  // fairway/rough/fringe within pitching distance.
  if (
    ev.imgShotDistance != null &&
    ev.imgShotDistanceUnit === "yds" &&
    ev.imgShotDistance <= 40
  ) {
    return { text: "CHIP", kind: "chip" };
  }
  // Default second+ stroke = approach.
  if (shotNum >= 2) return { text: "APPR", kind: "approach" };
  return { text: "SHOT", kind: "shot" };
}

function tagText(ev: FeedEvent): { text: string; kind: string } {
  if (ev.ace) return { text: "ACE", kind: "ace" };
  if (ev.result === "albatross") return { text: "ALB", kind: "albatross" };
  if (ev.result === "eagle") return { text: "EAGLE", kind: "eagle" };
  if (ev.result === "birdie") return { text: "BIRDIE", kind: "birdie" };
  if (ev.result === "bogey") return { text: "BOGEY", kind: "bogey" };
  if (ev.result === "double") return { text: "DBL", kind: "double" };
  if (ev.result === "triple-plus") return { text: "TRIP+", kind: "triple-plus" };
  if (ev.type === "shot") return shotTag(ev);
  if (ev.type === "position") return { text: "MOVE", kind: "position" };
  if (ev.type === "milestone") return { text: ev.headline?.slice(0, 8).toUpperCase() ?? "NOTE", kind: "milestone" };
  return { text: ev.type.toUpperCase(), kind: "misc" };
}

/** Build the primary verb line — falls back to the engine's headline
 *  if we can't compose something more precise from the shape. */
function verbLine(ev: FeedEvent): string {
  if (ev.headline) return ev.headline;
  const hole = holeLabel(ev.hole);
  if (!hole) return "—";
  if (ev.ace) return `Ace on ${hole}`;
  if (ev.result === "eagle") return `Eagles ${hole}`;
  if (ev.result === "birdie") return `Birdies ${hole}`;
  if (ev.result === "bogey") return `Bogeys ${hole}`;
  if (ev.result === "double") return `Doubles ${hole}`;
  if (ev.result === "triple-plus") return `Blow-up ${hole}`;
  return `Plays ${hole}`;
}

export default function UnifiedShotCard({
  event,
  contextTag,
  isMine,
  isNotable,
  onOpen,
  onReact,
  onShare,
}: Props) {
  const tag = tagText(event);
  const shotAnchor = formatShotAnchor(event, tag.kind);
  // Shot events use a distance/proximity anchor and stay neutral —
  // there's no under/over "polarity" for a drive distance. Only
  // score-outcome events get the green/red polarity treatment.
  const polarity = shotAnchor ? "none" : scorePolarity(event.toPar);
  const scoreCls = `feed-v3-card-score feed-v3-card-score-${polarity}${shotAnchor ? " feed-v3-card-score-shot" : ""}`;
  const cls = ["feed-v3-card"];
  if (isMine) cls.push("feed-v3-card-mine");
  else if (isNotable) cls.push("feed-v3-card-notable");

  return (
    <article
      className={cls.join(" ")}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.();
        }
      }}
    >
      <span className="feed-v3-card-stripe" aria-hidden="true" />
      <div className="feed-v3-card-avatar">
        <PlayerAvatar
          playerId={event.playerId}
          playerName={event.playerName}
          size="sm"
        />
      </div>
      <div className="feed-v3-card-body">
        <div className="feed-v3-card-headline">
          <span className="feed-v3-card-name">{shortName(event.playerName)}</span>
          {event.hole != null && (
            <>
              <span className="feed-v3-card-sep">·</span>
              <span className="feed-v3-card-hole">{holeLabel(event.hole)}</span>
            </>
          )}
          <span className="feed-v3-card-sep">·</span>
          <span className="feed-v3-card-time">{formatClock(event.ts)}</span>
        </div>
        <div className="feed-v3-card-verb">{verbLine(event)}</div>
        {contextTag ? (
          <div className="feed-v3-card-context">{contextTag}</div>
        ) : (
          <div className="feed-v3-card-context feed-v3-card-context-empty" />
        )}
      </div>
      <div className="feed-v3-card-anchor">
        <span className={`feed-v3-card-tag feed-v3-card-tag-${tag.kind}`}>
          {tag.text}
        </span>
        <span className={scoreCls}>
          {shotAnchor ?? formatScore(event.toPar)}
        </span>
      </div>
      <div className="feed-v3-card-actions">
        <button
          type="button"
          className="feed-v3-card-action"
          onClick={(e) => {
            e.stopPropagation();
            onReact?.();
          }}
          aria-label="React"
          title="React"
        >
          ♡
        </button>
        {onShare && (
          <button
            type="button"
            className="feed-v3-card-action"
            onClick={(e) => {
              e.stopPropagation();
              onShare();
            }}
            aria-label="Share"
            title="Share"
          >
            ↗
          </button>
        )}
      </div>
    </article>
  );
}
