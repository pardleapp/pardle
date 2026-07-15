/**
 * Bot-message dedup — stops the room from feeling scripted by
 * refusing to post a bot line that's already appeared recently.
 *
 * Two match modes:
 *   1. Exact-normalised — lowercase + punctuation-stripped + whitespace-
 *      collapsed. Catches template repeats (both ambient tick + LLM
 *      output that lands on the same short phrasing).
 *   2. Word-overlap — Jaccard similarity ≥ 0.7 on token sets, so
 *      "come on steve!!" vs "steve come on" both flag as duplicates
 *      of each other even though the raw strings differ.
 *
 * Applied to a caller-supplied window (10 min for bot-authored
 * messages by default) so real user chat isn't accidentally muted.
 */

import type { ChatMessage } from "@/lib/feed/store";

/** Default lookback window: 10 minutes. Anything a bot has said in
 *  the last 10 min is off-limits. */
export const BOT_DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

/** Token overlap threshold that counts as "same message". 0.7 is
 *  tight enough that "come on Rory" vs "come on Scheffler" are
 *  distinct but loose enough that "brutal for me" vs "brutal for
 *  you" collapse together. */
const OVERLAP_THRESHOLD = 0.7;

/** Very short messages ("gg", "🙌", "same") skip the overlap check
 *  because any two 2-word strings will trip Jaccard. They only get
 *  the exact-normalised match. */
const MIN_TOKENS_FOR_OVERLAP = 3;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(normalise(text).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * True when `candidate` matches — either exact-normalised or by ≥70%
 * word overlap — any bot message posted in `windowMs` from `now`.
 * Real user messages are ignored; users repeating themselves is
 * their business.
 */
export function isRecentBotDuplicate(
  candidate: string,
  history: ChatMessage[],
  windowMs: number = BOT_DUPLICATE_WINDOW_MS,
  now: number = Date.now(),
): boolean {
  if (!candidate.trim()) return false;
  const candNorm = normalise(candidate);
  if (!candNorm) return false;
  const candTokens = tokenSet(candidate);
  const useOverlap = candTokens.size >= MIN_TOKENS_FOR_OVERLAP;

  for (const msg of history) {
    if (!msg.authorKey?.startsWith("bot:")) continue;
    if (now - msg.ts > windowMs) continue;
    const msgNorm = normalise(msg.text);
    if (msgNorm === candNorm) return true;
    if (useOverlap) {
      const msgTokens = tokenSet(msg.text);
      if (msgTokens.size < MIN_TOKENS_FOR_OVERLAP) continue;
      if (jaccard(candTokens, msgTokens) >= OVERLAP_THRESHOLD) return true;
    }
  }
  return false;
}
