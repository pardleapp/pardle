/**
 * Mock notifications — verbatim from the design-handoff prototype's
 * NOTIFS constant in Pardle Social v2.html. Drives the first cut of
 * the /notifications surface; real wiring (push fanout writes →
 * cursor-paged feed) lands in a follow-up. Shapes here are the
 * contract real data will populate.
 *
 * Copy guardrails (CLAUDE.md): no third-party data source names, no
 * latency / refresh figures. "@golf-edge" is a channel name (a
 * Pardle concept), not a partner reference — fine.
 */

export type NotifTint = "up" | "blue" | "tang";

export interface NotifRow {
  /** Single emoji shown inside the tinted circle. */
  icon: string;
  /** Background tint for the icon circle. */
  tint: NotifTint;
  title: string;
  subtitle: string;
  /** Short relative timestamp — "now" / "8m" / "2h". */
  time: string;
  unread: boolean;
  /** Optional deep link the row routes to when tapped. Empty string
   *  means no nav (just dismiss the unread state). */
  href?: string;
}

// Empty by default — the /notifications surface now renders the
// onboarding empty state until the real push-fanout pipeline lands.
// Previous demo rows ("Jordan tailed…", "You moved to 2nd in The
// Lads", "@golf-edge posted") were invented and leaked into the
// live experience on Memorial day one.
export const MOCK_NOTIFS: NotifRow[] = [];

export const UNREAD_COUNT = MOCK_NOTIFS.filter((n) => n.unread).length;
