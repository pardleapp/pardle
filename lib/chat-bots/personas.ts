/**
 * Chat-room bot personas — deployed to make the tournament chat feel
 * populated during pre-launch and quiet stretches. Each persona has
 * a stable name + authorKey (so bubbles align consistently and the
 * client can spot them via the `bot:` prefix if we ever want a "bot"
 * chip). Speaking style is captured by which template set the
 * message picker samples from.
 *
 * Deliberately fan-voice only — no bots claiming to have placed
 * bets, no bots making predictions users could act on. Just the
 * reactions/banter you'd hear in a golf pub during a Sunday round.
 */

export type PersonaStyle = "hype" | "nervy" | "grump" | "wonky" | "casual";

export interface ChatBotPersona {
  /** Unique bot slug (used in authorKey). */
  slug: string;
  /** Display name — appears exactly like a real user's chosen name. */
  name: string;
  /** Which template bucket to pull from when this persona posts. */
  style: PersonaStyle;
}

export const CHAT_BOT_PERSONAS: ChatBotPersona[] = [
  { slug: "steve",  name: "Steve",        style: "hype" },
  { slug: "tim",    name: "Tim",          style: "nervy" },
  { slug: "bigdel", name: "Big Del",      style: "grump" },
  { slug: "kev",    name: "Kev the Cad",  style: "wonky" },
  { slug: "jess",   name: "Jess",         style: "casual" },
  { slug: "raj",    name: "Raj",          style: "hype" },
  { slug: "ollie",  name: "Ollie",        style: "casual" },
];

/** authorKey stamped onto every bot message so we can filter/audit
 *  later ("show only bot messages", "hide bots", etc). Also acts
 *  as the rate-limit key when we want per-persona pacing. */
export function botAuthorKey(persona: ChatBotPersona): string {
  return `bot:${persona.slug}`;
}
