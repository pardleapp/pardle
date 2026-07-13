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
 * Convert IMG's "LASTNAME, First" to the canonical "First Last" the
 * rest of Pardle expects. `abbreviateName` and downstream UIs are
 * built for "First Last" — passing them "Ormond, Jesse" produces
 * "O. Jesse" instead of "J. Ormond".
 */
function canonicaliseName(imgName) {
  if (!imgName) return imgName;
  const parts = imgName.split(",");
  if (parts.length < 2) return imgName.trim();
  const last = parts[0].trim();
  const first = parts.slice(1).join(",").trim();
  if (!first || !last) return imgName.trim();
  return `${first} ${last}`;
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
  shotDistanceUnit,
  surface,
  toPin,
  shotNum,
  par,
  startedOnGreen,
}) {
  // playerName arrives as canonical "First Last" — take the first
  // whitespace-separated token as the broadcast-style short name.
  const first = playerName.trim().split(/\s+/)[0] || playerName;
  const s = (surface || "").toLowerCase();

  // A shot is a putt if and only if the player was already on the
  // green when they hit it. `startedOnGreen` is set by the publisher
  // based on the PREVIOUS shot's landing surface — the authoritative
  // signal. Without it, we fall back to a distance-based guess but
  // it's brittle (a bunker shot landing 15 yds away on the green
  // gets called a putt with just distance data).
  const isPutt =
    startedOnGreen === true ||
    (startedOnGreen == null &&
      /green/.test(s) &&
      (shotDistanceUnit === "ft" ||
        (typeof shotDistance === "number" && shotDistance < 30)));

  let verb;
  let distText = "";
  if (isPutt) {
    verb = "putts from";
    if (shotDistance) {
      // Convert yards → feet for the readout since a 21 ft putt reads
      // more naturally than 7 yds. If widget already gave us ft, use
      // as-is.
      const ft =
        shotDistanceUnit === "ft" ? shotDistance : Math.round(shotDistance * 3);
      distText = `${ft} ft`;
    }
  } else if (shotNum === 1 && shotDistance && shotDistance >= 300) {
    verb = "bombs";
    distText = `${shotDistance} yds`;
  } else if (shotNum === 1) {
    verb = "tees off";
    distText = shotDistance ? `${shotDistance} yds` : "";
  } else if (/bunker|sand/.test(s)) {
    verb = "finds the bunker from";
    distText = shotDistance ? `${shotDistance} yds` : "";
  } else if (/rough/.test(s)) {
    verb = "finds the rough from";
    distText = shotDistance ? `${shotDistance} yds` : "";
  } else if (/native|waste/.test(s)) {
    verb = "finds the native area from";
    distText = shotDistance ? `${shotDistance} yds` : "";
  } else if (/green/.test(s)) {
    verb = "approaches from";
    distText = shotDistance ? `${shotDistance} yds` : "";
  } else if (/fairway/.test(s)) {
    verb = "finds the fairway from";
    distText = shotDistance ? `${shotDistance} yds` : "";
  } else {
    verb = "hits from";
    distText = shotDistance ? `${shotDistance} yds` : "";
  }

  const distClause = distText ? `${verb} ${distText}` : verb;
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
  startedOnGreen,
}) {
  if (!playerId || !hole || !shotNum) return null;
  const ts = Date.now();
  const canonicalName = canonicaliseName(playerName);
  const headline = shotHeadline({
    playerName: canonicalName,
    shotDistance,
    shotDistanceUnit,
    surface,
    toPin,
    shotNum,
    par,
    startedOnGreen,
  });

  return {
    id: newEventId(ts),
    tournamentId,
    ts,
    type: "shot",
    playerId,
    playerName: canonicalName,
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
  const canonicalName = canonicaliseName(playerName);
  if (par == null) {
    // Without par we can't classify the result cleanly. Emit a
    // generic "score" event without a result field — the engine
    // will still show it, just without the birdie/bogey tag chip.
    const ts = Date.now();
    const firstFallback = canonicalName.trim().split(/\s+/)[0] || canonicalName;
    return {
      id: newEventId(ts),
      tournamentId,
      ts,
      type: "score",
      playerId,
      playerName: canonicalName,
      round,
      hole,
      strokes,
      imgSourced: true,
      tournamentName: tournamentName || undefined,
      headline: `${firstFallback} scores ${strokes} on the ${ordinalHole(hole)}`,
    };
  }
  const result = resultFor(strokes, par);
  const ace = strokes === 1;
  const first = canonicalName.trim().split(/\s+/)[0] || canonicalName;
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
    playerName: canonicalName,
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
