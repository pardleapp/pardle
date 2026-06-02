"use client";

/**
 * MemberProfile — full-screen overlay opened from a member row or
 * a standings rank. Reads real data from the DB:
 *   - name + initials + role from the standings/members row that
 *     the caller already has in memory (passed as props).
 *   - open non-private bets are fetched lazily from
 *     /api/groups/[id]/members/[memberId]/bets on mount.
 *
 * Privacy: open bets are filtered server-side via
 * lib/groups/server::getMemberOpenBets (excludes isPrivate=true).
 * Live unrealised P&L on each open bet is a Step 3.5 follow-up;
 * for now we show stake + odds + market only.
 *
 * The "P&L · this tournament" chart from the prototype's
 * MemberProfile is intentionally not rendered at v1 — it needs
 * the same shared-feed pipeline as live unrealised. The headline
 * P&L number (settled outcomes) is still shown from props.
 */

import { useEffect, useState } from "react";
import type {
  GroupStandingsRow,
  MemberOpenBet,
} from "@/lib/groups/server";
import { formatBetCurrency, normaliseBetCurrency } from "@/lib/format/bet-currency";

interface Props {
  groupId: string;
  memberUserId: string;
  displayName: string;
  initials: string;
  /** Optional pre-computed standings row for the member — drives
   *  the headline P&L number + colour. Falls back to a neutral
   *  zero when omitted. */
  standings?: GroupStandingsRow;
  onClose: () => void;
  onOpenPlayer: (player: string) => void;
}

const PALETTE: Record<string, string> = {
  JO: "linear-gradient(135deg,#5cd7c1,#1f8b6e)",
  SA: "linear-gradient(135deg,#f29a4f,#d44a4a)",
  TH: "linear-gradient(135deg,#6b7df2,#c659d8)",
  MI: "linear-gradient(135deg,#ed7a99,#7a274d)",
  YO: "linear-gradient(135deg,#ffb35a,#c4691a)",
  PA: "linear-gradient(135deg,#a070ff,#3b1f8a)",
  DA: "linear-gradient(135deg,#85d4f7,#1f6b9e)",
  NI: "linear-gradient(135deg,#7be0ad,#26795a)",
  RO: "linear-gradient(135deg,#56b0e8,#3a4f9b)",
};
function bgFor(initials: string): string {
  return PALETTE[initials] ?? "linear-gradient(135deg,#6b7df2,#3b1f8a)";
}

function fmtSignedCurrency(n: number, currency: string): string {
  const cur = normaliseBetCurrency(currency);
  if (Math.abs(n) < 0.5) {
    return formatBetCurrency(0, cur, { maximumFractionDigits: 0 });
  }
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${formatBetCurrency(Math.abs(n), cur, {
    maximumFractionDigits: 0,
  })}`;
}

export default function MemberProfile({
  groupId,
  memberUserId,
  displayName,
  initials,
  standings,
  onClose,
  onOpenPlayer,
}: Props) {
  const [bets, setBets] = useState<MemberOpenBet[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBets(null);
    setErr(null);
    fetch(
      `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(
        memberUserId,
      )}/bets`,
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Failed (${res.status})`);
        }
        const json = (await res.json()) as { bets: MemberOpenBet[] };
        if (!cancelled) setBets(json.bets);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, memberUserId]);

  const pnl = standings?.net_pnl ?? 0;
  const currency = standings?.currency ?? "GBP";
  const dir = standings?.dir ?? "flat";
  const negative = dir === "down";
  const role = standings?.role;
  const settledCount = standings?.settled_count ?? 0;
  const recordLabel =
    settledCount > 0
      ? `${settledCount} settled bet${settledCount === 1 ? "" : "s"}`
      : "No settled bets yet";

  return (
    <div
      className="grp-overlay"
      role="dialog"
      aria-label={`${displayName} profile`}
    >
      <header className="grp-overlay-head">
        <button
          type="button"
          className="bd-pv-back"
          onClick={onClose}
          aria-label="Close member profile"
        >
          ←
        </button>
        <div className="bd-pv-title">
          <div className="bd-pv-title-nm">
            {displayName}
            {role === "admin" && <span className="role-tag">admin</span>}
          </div>
          <div className="bd-pv-title-mk">In your group · {recordLabel}</div>
        </div>
      </header>

      <div className="grp-overlay-body">
        <section className="mp-hero">
          <span
            className="crew-mini-av"
            style={{
              width: 56,
              height: 56,
              fontSize: 19,
              background: bgFor(initials),
            }}
            aria-hidden="true"
          >
            {initials}
          </span>
          <div className="mp-hero-body">
            <div className="mp-hero-nm">{displayName}</div>
            <div className="mp-hero-sub">
              P&amp;L · settled{" "}
              <b
                style={{
                  color:
                    Math.abs(pnl) < 0.5
                      ? "var(--pv-muted)"
                      : negative
                        ? "var(--pv-down)"
                        : "var(--pv-up)",
                }}
              >
                {fmtSignedCurrency(pnl, currency)}
              </b>
            </div>
          </div>
        </section>

        <section className="bd-sec">
          <h4 className="bd-sec-h">
            Open bets {bets ? `· ${bets.length}` : ""}
          </h4>
          {err ? (
            <p className="pl-gbet-empty">Couldn&rsquo;t load bets — {err}.</p>
          ) : bets === null ? (
            <p className="pl-gbet-empty">Loading…</p>
          ) : bets.length === 0 ? (
            <p className="pl-gbet-empty">
              {displayName === "You"
                ? "You haven't tracked any open bets."
                : `${displayName} hasn't tracked any open bets (or has marked them private).`}
            </p>
          ) : (
            <ul className="mp-bets">
              {bets.map((b) => {
                const cur = normaliseBetCurrency(b.currency);
                const stakeLabel = formatBetCurrency(b.stake, cur, {
                  maximumFractionDigits: 0,
                });
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      className="mp-bet-row"
                      onClick={() =>
                        b.player_name && onOpenPlayer(b.player_name)
                      }
                      disabled={!b.player_name}
                    >
                      <div className="mp-bet-row-l">
                        <div className="mp-bet-row-nm">
                          {b.player_name ?? "—"}
                          <span className="bp-bet-mkt">{b.market_label}</span>
                        </div>
                        <div className="mp-bet-row-sub">
                          {stakeLabel} @ {b.odds_label}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
