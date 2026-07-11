/**
 * IMG shot → FeedEvent translator.
 *
 * Takes the DOM-scraped IMG shape and produces the same `FeedEvent`
 * shape the main app's engine emits — so shots land in the feed
 * indistinguishably from orchestrator-sourced ones.
 *
 * IMG gives us MORE structured detail than orchestrator's plain
 * `playByPlay` string does: exact yards, precise pin distance, named
 * landing surface. Use that to write better broadcast copy than
 * "1st shot on the 8th."
 */

function newEventId(ts = Date.now()) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ts}-img-${rand}`;
}

/**
 * Result of a hole given strokes + par. Matches the ScoreResult union
 * in lib/feed/types.ts.
 */
function resultFor(strokes, par) {
  if (par == null) return null;
  const diff = strokes - par;
  if (strokes === 1) return "birdie"; // ace, but caller decides ace flag
  if (diff <= -3) return "albatross";
  if (diff === -2) return "eagle";
  if (diff === -1) return "birdie";
  if (diff === 0) return "par";
  if (diff === 1) return "bogey";
  if (diff === 2) return "double";
  return "triple-plus";
}

function ordinalHole(hole) {
  const rem10 = hole % 10;
  const rem100 = hole % 100;
  if (rem10 === 1 && rem100 !== 11) return `${hole}st`;
  if (rem10 === 2 && rem100 !== 12) return `${hole}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${hole}rd`;
  return `${hole}th`;
}

/**
 * Broadcast headline for a landed shot. Better than "1st shot on the
 * 5th" because we have real distances + surface.
 *
 * Examples produced:
 *   "Rory bombs 337 yds — 223 yds to pin from the native area"
 *   "Rory approaches from 168 yds — 6 ft 5 in for eagle"
 *   "Rory bunkered from 187 yds — 39 yds to pin"
 */
function shotHeadline({
  playerName,
  shotDistance,
  surface,
  toPin,
  shotNum,
  par,
}) {
  const first = playerName.split(",")[1]?.trim() || playerName;
  const dist = shotDistance ? `${shotDistance} yds` : "";

  // Surface-aware phrasing. Prefer verbs that read like a broadcast.
  const s = (surface || "").toLowerCase();
  let verb;
  if (shotNum === 1 && shotDistance && shotDistance >= 300) verb = "bombs";
  else if (shotNum === 1) verb = "tees off";
  else if (/bunker|sand/.test(s)) verb = "finds the bunker from";
  else if (/rough/.test(s)) verb = "finds the rough from";
  else if (/native|waste/.test(s)) verb = "finds the native area from";
  else if (/green/.test(s)) verb = "approaches from";
  else if (/fairway/.test(s)) verb = "finds the fairway from";
  else verb = "hits from";

  const distClause = dist ? `${verb} ${dist}` : verb;
  const pinClause = toPin ? ` — ${toPin} to pin` : "";
  return `${first} ${distClause}${pinClause}`;
}

/**
 * Terminal-shot event — IMG has told us where a shot ended, with
 * precise distance to pin. Not a hole-completion.
 */
export function translateImgShot({
  tournamentId,
  tournamentName,
  playerId,
  playerName,
  round,
  hole,
  shotNum,
  shotDistance,
  shotDistanceUnit,
  surface,
  toPin,
  par,
}) {
  if (!playerId || !hole || !shotNum) return null;
  const ts = Date.now();
  const headline = shotHeadline({
    playerName,
    shotDistance,
    surface,
    toPin,
    shotNum,
    par,
  });

  return {
    id: newEventId(ts),
    tournamentId,
    ts,
    type: "shot",
    playerId,
    playerName,
    round,
    hole,
    par: par ?? undefined,
    // IMG-specific enrichment we bake onto the event for the engine
    // downstream to use — headline is the visible bit.
    imgSourced: true,
    imgShotDistance: shotDistance,
    imgShotDistanceUnit: shotDistanceUnit,
    imgSurface: surface,
    imgToPin: toPin,
    imgShotNum: shotNum,
    tournamentName: tournamentName || undefined,
    headline,
    emoji: "🏌️",
  };
}

/**
 * Hole-completion event — IMG's "Ball Holed" state on shot N means
 * the player finished the hole with strokes=N. We can compute the
 * result (birdie/eagle/bogey/etc.) from strokes + par and emit it as
 * a `type:"score"` FeedEvent that behaves identically to what the
 * orchestrator poller emits.
 */
export function translateImgHoleOut({
  tournamentId,
  tournamentName,
  playerId,
  playerName,
  round,
  hole,
  strokes,
  par,
}) {
  if (!playerId || !hole || !strokes) return null;
  if (par == null) {
    // Without par we can't classify the result cleanly. Emit a
    // generic "score" event without a result field — the engine
    // will still show it, just without the birdie/bogey tag chip.
    const ts = Date.now();
    return {
      id: newEventId(ts),
      tournamentId,
      ts,
      type: "score",
      playerId,
      playerName,
      round,
      hole,
      strokes,
      imgSourced: true,
      tournamentName: tournamentName || undefined,
      headline: `${playerName.split(",")[1]?.trim() || playerName} scores ${strokes} on the ${ordinalHole(hole)}`,
    };
  }
  const result = resultFor(strokes, par);
  const ace = strokes === 1;
  const first = playerName.split(",")[1]?.trim() || playerName;
  const headline = ace
    ? `${first} aces the ${ordinalHole(hole)}!`
    : (() => {
        switch (result) {
          case "albatross":
            return `${first} makes ALBATROSS on the ${ordinalHole(hole)}!`;
          case "eagle":
            return `${first} eagles the ${ordinalHole(hole)}!`;
          case "birdie":
            return `${first} birdies the ${ordinalHole(hole)}`;
          case "par":
            return `${first} pars the ${ordinalHole(hole)}`;
          case "bogey":
            return `${first} bogeys the ${ordinalHole(hole)}`;
          case "double":
            return `${first} doubles the ${ordinalHole(hole)}`;
          case "triple-plus":
            return `${first} blows up on the ${ordinalHole(hole)} (${strokes})`;
          default:
            return `${first} scores ${strokes} on the ${ordinalHole(hole)}`;
        }
      })();
  const emoji =
    ace || result === "albatross" || result === "eagle"
      ? "🎯"
      : result === "birdie"
        ? "🐦"
        : result === "double" || result === "triple-plus"
          ? "💥"
          : result === "bogey"
            ? "😬"
            : undefined;

  const ts = Date.now();
  return {
    id: newEventId(ts),
    tournamentId,
    ts,
    type: "score",
    playerId,
    playerName,
    round,
    hole,
    par,
    strokes,
    result,
    ace,
    imgSourced: true,
    tournamentName: tournamentName || undefined,
    headline,
    emoji,
  };
}
