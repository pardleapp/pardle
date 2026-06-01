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

export const MOCK_NOTIFS: NotifRow[] = [
  {
    icon: "🚀",
    tint: "up",
    title: "Your Henley outright jumped to 60%",
    subtitle: "Birdie on 18 — he grabs the lead",
    time: "now",
    unread: true,
    href: "/bets/b1",
  },
  {
    icon: "🎉",
    tint: "up",
    title: "Your Smalley Top 5 cashed · +£40",
    subtitle: "Settled — booked to your day",
    time: "2m",
    unread: true,
    href: "/bets?settle=s1",
  },
  {
    icon: "📈",
    tint: "blue",
    title: "@golf-edge posted a new tip",
    subtitle: "L. Åberg — Outright @ 12/1",
    time: "8m",
    unread: true,
    href: "/",
  },
  {
    icon: "👥",
    tint: "tang",
    title: "Jordan tailed your Smalley Top 5",
    subtitle: "The Lads",
    time: "12m",
    unread: false,
    href: "/groups",
  },
  {
    icon: "⛳",
    tint: "up",
    title: "N. Echavarria — eagle on 17",
    subtitle: "A player you follow",
    time: "18m",
    unread: false,
    href: "/live/player/N.%20Echavarria",
  },
  {
    icon: "🏆",
    tint: "tang",
    title: "You moved to 2nd in The Lads",
    subtitle: "Today's P&L race",
    time: "25m",
    unread: false,
    href: "/groups",
  },
];

export const UNREAD_COUNT = MOCK_NOTIFS.filter((n) => n.unread).length;
