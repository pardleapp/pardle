/**
 * Quick unit-shape test of the translator — prints a few sample
 * FeedEvent outputs so we can eyeball the shape and headline copy.
 */
import { translateImgShot, translateImgHoleOut } from "./translator.mjs";

const cases = [
  {
    label: "Rory McIlroy — approach shot on par 4",
    args: {
      tournamentId: "R2026034",
      tournamentName: "Genesis Scottish Open",
      playerId: "28237",
      playerName: "McIlroy, Rory",
      round: 2,
      hole: 4,
      shotNum: 2,
      shotDistance: 149,
      shotDistanceUnit: "yds",
      surface: "Green",
      toPin: "9ft. 6in.",
      par: 4,
    },
    fn: translateImgShot,
  },
  {
    label: "Marcus Armitage — 337-yd bomb into native area",
    args: {
      tournamentId: "R2026034",
      tournamentName: "Genesis Scottish Open",
      playerId: "34099",
      playerName: "Armitage, Marcus",
      round: 2,
      hole: 13,
      shotNum: 1,
      shotDistance: 337,
      shotDistanceUnit: "yds",
      surface: "Native Area",
      toPin: "223yds",
      par: 4,
    },
    fn: translateImgShot,
  },
  {
    label: "Tom Kim — birdie tap-in on par 4",
    args: {
      tournamentId: "R2026034",
      tournamentName: "Genesis Scottish Open",
      playerId: "46046",
      playerName: "Kim, Tom",
      round: 2,
      hole: 3,
      strokes: 3,
      par: 4,
    },
    fn: translateImgHoleOut,
  },
  {
    label: "Jordan Smith — bogey on par 4",
    args: {
      tournamentId: "R2026034",
      tournamentName: "Genesis Scottish Open",
      playerId: "35617",
      playerName: "Smith, Jordan",
      round: 2,
      hole: 3,
      strokes: 5,
      par: 4,
    },
    fn: translateImgHoleOut,
  },
];

for (const c of cases) {
  console.log(`\n── ${c.label} ──`);
  console.log(JSON.stringify(c.fn(c.args), null, 2));
}
