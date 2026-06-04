"use client";

/**
 * RaceSheet — drop-down sheet showing the full P&L race for the
 * current group. Reads real `getGroupStandings()` rows passed in
 * from GroupsClient (same source the in-page rail uses). No mock
 * data — pre-launch we only ship the event-level race; season /
 * all-time tabs are deferred until the settled-bet ledger is rich
 * enough for them to mean something.
 */

import { useDismissibleOverlay } from "@/app/_hooks/useDismissibleOverlay";
import {
  formatBetCurrency,
  normaliseBetCurrency,
} from "@/lib/format/bet-currency";
import type { GroupStandingsRow } from "@/lib/groups/server";

interface Props {
  groupName: string;
  memberCount: number;
  standings: GroupStandingsRow[];
  onClose: () => void;
  onOpenMember?: (memberUserId: string) => void;
}

const PALETTE: Record<string, string> = {
  JO: "linear-gradient(135deg,#5cd7c1,#1f8b6e)",
  SA: "linear-gradient(135deg,#f29a4f,#d44a4a)",
  TH: "linear-gradient(135deg,#6b7df2,#c659d8)",
  MI: "linear-gradient(135deg,#ed7a99,#7a274d)",
  YO: "linear-gradient(135deg,#ffb35a,#c4691a)",
  DA: "linear-gradient(135deg,#85d4f7,#1f6b9e)",
  NI: "linear-gradient(135deg,#7be0ad,#26795a)",
  RO: "linear-gradient(135deg,#56b0e8,#3a4f9b)",
  PA: "linear-gradient(135deg,#a070ff,#3b1f8a)",
};
function bgFor(initials: string): string {
  return PALETTE[initials] ?? "linear-gradient(135deg,#6b7df2,#3b1f8a)";
}

function fmt(n: number, currency: string): string {
  const cur = normaliseBetCurrency(currency);
  if (Math.abs(n) < 0.5) return formatBetCurrency(0, cur, { maximumFractionDigits: 0 });
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${formatBetCurrency(Math.abs(n), cur, {
    maximumFractionDigits: 0,
  })}`;
}

export default function RaceSheet({
  groupName,
  memberCount,
  standings,
  onClose,
  onOpenMember,
}: Props) {
  useDismissibleOverlay(true, onClose);
  return (
    <div
      className="race-sheet"
      onClick={onClose}
      role="dialog"
      aria-label="P&L race"
    >
      <div
        className="race-card"
        onClick={(e) => e.stopPropagation()}
        role="document"
      >
        <h3>{groupName} · P&amp;L race</h3>
        <div className="race-sub">
          {memberCount} {memberCount === 1 ? "member" : "members"} · live from
          your tracked bets
        </div>
        <div className="race-list">
          {standings.length === 0 ? (
            <div className="race-empty">
              The race lights up when bets start settling — track a bet to
              start counting.
            </div>
          ) : (
            standings.map((r, i) => (
              <button
                key={r.user_id}
                type="button"
                className={`racerow${r.is_me ? " racerow-you" : ""}`}
                onClick={() =>
                  !r.is_me && onOpenMember ? onOpenMember(r.user_id) : undefined
                }
                disabled={r.is_me || !onOpenMember}
              >
                <span className="racerow-rk">{i + 1}</span>
                <span
                  className="crew-mini-av"
                  style={{
                    width: 32,
                    height: 32,
                    fontSize: 11,
                    background: bgFor(r.initials),
                  }}
                  aria-hidden="true"
                >
                  {r.initials}
                </span>
                <span className="racerow-nm">
                  {r.is_me ? <b>{r.display_name}</b> : r.display_name}
                  {i === 0 && r.net_pnl > 0.5 && " 👑"}
                </span>
                <span className={`racerow-pl ${r.dir}`}>
                  {fmt(r.net_pnl, r.currency)}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="race-foot">
          {standings.length === 0
            ? "Settled bets only — open bets count once they settle."
            : "Tap a member to see their open bets"}
        </div>
      </div>
    </div>
  );
}
