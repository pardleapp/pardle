/**
 * Bot chat tick — decides whether to post a bot message into the
 * tournament chat room on a given call.
 *
 * Called from /api/feed on every poll. Cheap rate-limit in Redis
 * gates real posts: even at 3s client poll cadence, at most one
 * bot message lands per BOT_TICK_MIN_MS. Random probability gate on
 * top means the actual per-poll trigger rate is lower again.
 *
 * When the tick fires, it looks at recent feed events (last few
 * minutes) for something to react to. If nothing juicy, it falls
 * back to a quiet-stretch small-talk template so the room doesn't
 * dry up on flat tournaments.
 */

import "server-only";
import { Redis } from "@upstash/redis";
import {
  addChatMessage,
  getChatMessages,
  type ChatMessage,
} from "@/lib/feed/store";
import type { FeedEvent } from "@/lib/feed/types";
import {
  CHAT_BOT_PERSONAS,
  botAuthorKey,
  type ChatBotPersona,
} from "./personas";
import { pickTemplate, type Situation, type TemplateContext } from "./messages";
import { isRecentBotDuplicate } from "./dedup";

const redis = Redis.fromEnv();

/** Minimum gap between bot messages per tournament while a round is
 *  actually being played (Thu-Sun). A room that ticks every ~25s
 *  reads as populated without being oppressive. Bump this up once
 *  real users are chatting so bots don't drown them out. */
const BOT_TICK_MIN_MS_LIVE = 25_000;

/** Minimum gap during the Mon-Wed pre-tournament lead-in. No live
 *  shots to react to, so the room should feel occasionally alive
 *  (a message every ~15 min) rather than a chattering group that's
 *  clearly bots. */
const BOT_TICK_MIN_MS_PRE = 15 * 60 * 1000;

/** Per-poll probability the tick actually fires (in addition to the
 *  hard rate limit above). 0.6 lands a bot message roughly every
 *  30-45s in practice, which matches the "one chatter every 30-60s"
 *  vibe of a real slow-burn golf chat. */
const TICK_PROBABILITY = 0.6;

/** How far back to look at feed events for context. 4 min gives us
 *  the last ~2-3 significant moments to react to without pulling in
 *  stale news. */
const CONTEXT_WINDOW_MS = 4 * 60 * 1000;

/** Consider an event "leader-adjacent" if the player is inside the
 *  top N of the current leaderboard. Only leader-adjacent bogeys /
 *  birdies get the -leader flavour template, otherwise the tick
 *  reads any birdie as huge news which sounds off. */
const LEADER_TOP_N = 5;

function tickLockKey(tournamentId: string): string {
  return `feed:chat:bot-tick:${tournamentId}`;
}

/** True if we're clear to post right now — sets the lock as a
 *  side-effect. Redis SET NX/EX gives atomic acquire; failure means
 *  another /api/feed call in this window already ticked. */
async function acquireLock(
  tournamentId: string,
  minMs: number,
): Promise<boolean> {
  const res = await redis.set(tickLockKey(tournamentId), "1", {
    nx: true,
    px: minMs,
  });
  return res === "OK";
}

interface TickContext {
  tournamentId: string;
  events: FeedEvent[];
  leaderPlayerIds: Set<string>;
}

interface Reaction {
  situation: Situation;
  ctx: TemplateContext;
}

/** Look at the most recent event(s) and pick a situation to react
 *  to. Returns null when there's nothing worth reacting to and the
 *  caller should fall back to quiet-stretch banter. */
function pickReaction(context: TickContext): Reaction | null {
  const now = Date.now();
  const recent = context.events
    .filter((e) => now - e.ts <= CONTEXT_WINDOW_MS)
    .filter((e) => e.type === "score")
    .sort((a, b) => b.ts - a.ts);

  for (const ev of recent) {
    if (!ev.result) continue;
    const isLeader = context.leaderPlayerIds.has(ev.playerId);
    const ctx: TemplateContext = {
      player: ev.playerName,
      holeNo: ev.hole,
      result: ev.toPar,
    };
    if (ev.ace) return { situation: "ace", ctx };
    if (ev.result === "eagle" || ev.result === "albatross") {
      return { situation: "eagle", ctx };
    }
    if (ev.result === "birdie") {
      return { situation: isLeader ? "birdie-leader" : "birdie", ctx };
    }
    if (ev.result === "double" || ev.result === "triple-plus") {
      return { situation: "double", ctx };
    }
    if (ev.result === "bogey") {
      return { situation: isLeader ? "bogey-leader" : "bogey", ctx };
    }
  }
  return null;
}

function pickPersona(rand: () => number): ChatBotPersona {
  return CHAT_BOT_PERSONAS[
    Math.floor(rand() * CHAT_BOT_PERSONAS.length)
  ];
}

function newBotMsgId(): string {
  return `mb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Ambient-populate the tournament chat room. Safe to call on every
 * /api/feed poll — the internal rate limit + probability gate keep
 * posts sparse. Returns the posted message when one lands (mostly
 * useful for tests + debug logs); null when nothing happened.
 */
export async function maybeTickChatBots(input: {
  tournamentId: string;
  events: FeedEvent[];
  leaderPlayerIds: string[];
  /** True when the tournament is currently in play (Thu-Sun). False
   *  during the Mon-Wed lead-in that renders OffWeekLanding — bots
   *  fall back to pre-tournament banter templates in that state. */
  isLive: boolean;
}): Promise<ChatMessage | null> {
  if (!input.tournamentId) return null;
  if (Math.random() > TICK_PROBABILITY) return null;
  const minMs = input.isLive ? BOT_TICK_MIN_MS_LIVE : BOT_TICK_MIN_MS_PRE;
  const gotLock = await acquireLock(input.tournamentId, minMs);
  if (!gotLock) return null;

  const context: TickContext = {
    tournamentId: input.tournamentId,
    events: input.events,
    leaderPlayerIds: new Set(input.leaderPlayerIds.slice(0, LEADER_TOP_N)),
  };

  const persona = pickPersona(Math.random);
  const reaction = input.isLive ? pickReaction(context) : null;
  // Live tournament: react to something recent; if nothing juicy,
  // fall back to a mid-round quiet template. Pre-tournament: swap
  // to lead-in banter templates.
  const fallback: Situation = input.isLive ? "quiet" : "pre-tournament";
  const situation: Situation = reaction?.situation ?? fallback;
  const ctx: TemplateContext = reaction?.ctx ?? {};

  // Anti-repeat: fetch the last few bot messages and reject any
  // candidate that already appeared within the dedup window. Retry
  // up to 5 times with fresh template picks — templates per bucket
  // are small (3-5 lines) so a handful of tries usually finds a
  // fresh one. If everything's exhausted, skip the tick entirely
  // rather than post an obvious repeat.
  let history: ChatMessage[] = [];
  try {
    history = await getChatMessages(input.tournamentId, 40);
  } catch {
    /* dedup is best-effort — proceed even if fetch fails */
  }
  let text = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = pickTemplate(situation, persona.style, ctx);
    if (!candidate) continue;
    if (!isRecentBotDuplicate(candidate, history)) {
      text = candidate;
      break;
    }
  }
  if (!text) return null;

  const msg: ChatMessage = {
    id: newBotMsgId(),
    tournamentId: input.tournamentId,
    ts: Date.now(),
    authorName: persona.name,
    authorKey: botAuthorKey(persona),
    text,
  };
  try {
    await addChatMessage(msg);
  } catch {
    // Chat isn't critical — swallow errors silently rather than
    // failing the /api/feed response.
    return null;
  }
  return msg;
}
