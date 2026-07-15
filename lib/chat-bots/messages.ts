/**
 * Message templates for chat-room bots. Split by:
 *   1. Situation — what's happening on course (birdie, eagle, bogey,
 *      cut, quiet-stretch small-talk).
 *   2. Persona style — how the character talks about it.
 *
 * Each template is a plain string with optional `${player}` /
 * `${holeNo}` / `${result}` placeholders substituted at post time.
 * Kept intentionally short (<80 chars) so bubbles read as authentic
 * one-line reactions, not written-out news reports.
 */

import type { PersonaStyle } from "./personas";

export type Situation =
  | "eagle"
  | "birdie"
  | "birdie-leader"
  | "bogey"
  | "bogey-leader"
  | "double"
  | "ace"
  | "quiet"
  | "pre-tournament";

/** Template dictionary — situation → style → array of one-liners. */
const TEMPLATES: Record<Situation, Record<PersonaStyle, string[]>> = {
  eagle: {
    hype: [
      "GET IN ${player}!!",
      "eagle for ${player} 🚀🚀",
      "no chance ${player} making 3 there",
      "unreal from ${player}",
    ],
    nervy: [
      "oh no not ${player}",
      "there goes the value on the field",
      "eagle. brutal for anyone laying him",
    ],
    grump: [
      "figures. ${player} eagles when i'm on someone else",
      "of course ${player} makes 3",
    ],
    wonky: [
      "that's a big SG:APP jump for ${player}",
      "${player}'s expected finish just dropped 0.4",
    ],
    casual: [
      "eagle for ${player} 🦅",
      "loving this from ${player}",
      "wow ${player}",
    ],
  },
  birdie: {
    hype: [
      "birdie ${player}! keep going",
      "come on ${player}",
      "${player} making moves",
    ],
    nervy: [
      "another one from ${player} — i needed him to stall",
      "${player} keeps rolling. gulp",
    ],
    grump: [
      "birdie ${player}. big deal",
      "wake me when ${player} makes something meaningful",
    ],
    wonky: [
      "${player} at ${result} through ${holeNo} — pace comfortably under 68",
      "${player} strokes gained really ticking today",
    ],
    casual: [
      "nice from ${player}",
      "birdie for ${player}",
      "${player} 🐦",
    ],
  },
  "birdie-leader": {
    hype: [
      "${player} pulling clear!! come onnnn",
      "leader making birdies is exactly what we wanted",
      "${player} in cruise control",
    ],
    nervy: [
      "the leader keeps going. brutal for laying him",
      "no one's catching ${player} at this rate",
    ],
    grump: [
      "of course the leader birdies. tournament over already",
      "the field's asleep",
    ],
    wonky: [
      "${player}'s outright price should be shortening hard",
      "leader lengthening — every birdie compounds the top-10 for him",
    ],
    casual: [
      "leader in cruise",
      "${player} looks locked in",
      "hard to see anyone catching ${player}",
    ],
  },
  bogey: {
    hype: [
      "come on ${player}, pull it together",
      "bounce back time for ${player}",
    ],
    nervy: [
      "there's the bogey i was dreading",
      "${player} dropping shots when it matters",
      "not what i needed from ${player}",
    ],
    grump: [
      "typical ${player}",
      "${player} finding a way to lose it",
    ],
    wonky: [
      "${player} +${result} on the round — projected finish worsening",
      "bogey drops ${player}'s pace back to level par territory",
    ],
    casual: [
      "bogey ${player} :(",
      "not ideal for ${player}",
    ],
  },
  "bogey-leader": {
    hype: [
      "GAME ON!! leader bogeys",
      "the door's open! come on chasers",
      "leader wobbles!!",
    ],
    nervy: [
      "leader bogeys, my top-10 might live",
      "please keep dropping shots",
    ],
    grump: [
      "leader finally makes a mistake",
      "about time",
    ],
    wonky: [
      "leader bogey — top-10 field just opened up ~4-5%",
      "leader's projected margin drops by half a stroke on that",
    ],
    casual: [
      "leader bogey 👀",
      "tournament back on",
    ],
  },
  double: {
    hype: [
      "OH NO ${player}",
      "disaster for ${player}",
    ],
    nervy: [
      "there goes my week on ${player}",
      "double for ${player}. cover me over",
    ],
    grump: [
      "cheers ${player}",
      "wonderful. ${player} finds a way to blow it up",
    ],
    wonky: [
      "double from ${player} — round-score projection just moved 1+ stroke",
      "${player} probably out of contention now",
    ],
    casual: [
      "big double for ${player} 😬",
      "yikes ${player}",
    ],
  },
  ace: {
    hype: [
      "HOLE IN ONE ${player}!!! 🎉🎉🎉",
      "ACE!! ${player} you beauty",
      "no way ${player} just holed that",
    ],
    nervy: [
      "ace. haven't seen one live in years",
      "${player} with the ace — incredible",
    ],
    grump: [
      "an ace. course showing its teeth. or not.",
      "obligatory sunday ace",
    ],
    wonky: [
      "${player} just banked ~2.5 shots on the field",
      "aces are ~1/12500 shots — enjoy that one",
    ],
    casual: [
      "HOLE IN ONE 🕳️⛳",
      "${player} ACE 🎯",
      "no way. ace for ${player}",
    ],
  },
  quiet: {
    hype: [
      "who's everyone on?",
      "let's have some drama here",
      "come on give us a birdie streak",
    ],
    nervy: [
      "quiet feels ominous",
      "waiting for the wheels to come off",
      "sundays never quiet for long",
    ],
    grump: [
      "slow round",
      "wake me when something happens",
      "these greens are ruining the coverage",
    ],
    wonky: [
      "expected finish spread is really narrow today",
      "top 10 line is basically a coin flip currently",
    ],
    casual: [
      "anyone else watching?",
      "great weather for it",
      "how's your slip looking",
      "coffee round",
    ],
  },
  "pre-tournament": {
    hype: [
      "who's everyone backing this week?",
      "let's have a big week lads",
      "can't wait for Thursday",
      "loading up the outrights tonight",
      "feeling good about this one",
    ],
    nervy: [
      "always talk myself into the wrong ones",
      "any tips? torn between 3 outrights",
      "watch me back the guy who WDs on Wednesday",
      "conditions worry me this week",
    ],
    grump: [
      "field's overrated this week",
      "prices are short. no value anywhere",
      "half these guys shouldn't be near the top of the market",
      "another week, another Rory disappointment probably",
    ],
    wonky: [
      "course fit numbers favour the ball-strikers this week",
      "SG:APP is the stat to lean on here",
      "top-20 lines look softer than usual",
      "field's putting avg on this course is 0.15 below tour normal",
    ],
    casual: [
      "who's teeing off first Thursday?",
      "anyone got a longshot they like?",
      "practice round talk yet?",
      "any weather updates?",
      "who's on your outrights slip?",
      "waiting on the pairings",
    ],
  },
};

export interface TemplateContext {
  player?: string;
  holeNo?: number;
  result?: string;
}

/** Pick a message. Random within (situation, style) bucket, then
 *  substitute placeholders. Falls back to an empty string when the
 *  bucket is empty or all templates required an absent placeholder. */
export function pickTemplate(
  situation: Situation,
  style: PersonaStyle,
  ctx: TemplateContext,
  rand: () => number = Math.random,
): string {
  const bucket = TEMPLATES[situation]?.[style] ?? [];
  if (bucket.length === 0) return "";
  const raw = bucket[Math.floor(rand() * bucket.length)] ?? "";
  return raw
    .replace(/\$\{player\}/g, ctx.player ?? "")
    .replace(/\$\{holeNo\}/g, ctx.holeNo != null ? String(ctx.holeNo) : "")
    .replace(/\$\{result\}/g, ctx.result ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
