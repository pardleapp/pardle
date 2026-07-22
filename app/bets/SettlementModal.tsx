"use client";

/**
 * SettlementModal — light/paper popup that fires when a tracked
 * bet resolves. Matches the design-handoff prototype's
 * <SettlementModal>: emerald "▲ Bet won" or red "Just missed"
 * eyebrow, mono profit/loss amount, the bet line, "Booked to your
 * day" stat strip, Done + Share buttons. Wins get a confetti burst.
 *
 * The whole card is light — no dark slab. Background scrim
 * dismisses; the card itself stops propagation.
 *
 * Copy stays Pardle-only — no third-party odds-source names, no
 * latency / refresh figures, per the CLAUDE.md guardrails.
 */

import Link from "next/link";
import Confetti from "./Confetti";
import { useDismissibleOverlay } from "@/app/_hooks/useDismissibleOverlay";

export interface SettlementData {
  win: boolean;
  /** Bet id — used for the "View full replay" deeplink into
   *  /live/bet/{id}, which renders the hole-by-hole PastBetReplay. */
  betId?: string;
  /** Profit/loss display string — "+£500", "−$20". */
  profitLabel: string;
  /** Total returned to the bettor — "£1,000" — used in the bet line
   *  ("£500 @ 2.00 · returned £1,000"). Wins only. */
  returnedLabel?: string;
  /** Settled bet shape for the bet-line. */
  player: string;
  market: string;
  currency: "£" | "$" | "u";
  stake: number;
  oddsLabel: string;
  /** Epoch ms of placement and settlement. When populated the modal
   *  renders a small timing strip with both stamps (relative +
   *  absolute) so the user can see how long the bet was live for. */
  placedAt?: number;
  settledAt?: number;
  /** Display name of the tournament the bet was placed on. */
  tournamentName?: string;
  /** Stat strip — "+£226" or "−£40" daily P&L + rank string. Both
   *  optional now; the live experience leaves them undefined until
   *  the daily-pnl and group-rank wiring lands. */
  bookedDailyPnl?: string;
  groupRank?: string;
}

/** Compact "5d 3h" or "42m" duration between two epoch stamps. */
function formatDuration(fromMs: number, toMs: number): string {
  const secs = Math.max(0, Math.round((toMs - fromMs) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remH = hours - days * 24;
  return remH === 0 ? `${days}d` : `${days}d ${remH}h`;
}

/** "24 Jul 2026, 14:32" for the modal timing strip. */
function formatStamp(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

interface Props {
  data: SettlementData;
  onClose: () => void;
  onShare: (data: SettlementData) => void;
}

export default function SettlementModal({ data, onClose, onShare }: Props) {
  useDismissibleOverlay(true, onClose);
  const win = data.win;
  return (
    <div
      className="settle-modal"
      role="dialog"
      aria-modal="true"
      aria-label={win ? "Bet won" : "Bet lost"}
    >
      <div className="settle-scrim" onClick={onClose} />
      {win && <Confetti />}
      <div
        className={`settle-card${win ? " settle-card-win" : " settle-card-loss"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settle-grid" />
        <div className="settle-status">
          {win ? "▲ Bet won" : "Just missed"}
        </div>
        <div className="settle-amt">{data.profitLabel}</div>
        <div className="settle-sub">
          {data.player} · {data.market} · {data.currency}
          {data.stake} @ {data.oddsLabel}
          {win && data.returnedLabel ? ` · returned ${data.returnedLabel}` : ""}
        </div>
        {data.tournamentName && (
          <div className="settle-tournament">{data.tournamentName}</div>
        )}
        {(data.placedAt || data.settledAt) && (
          <div className="settle-timing">
            {data.placedAt && (
              <div className="settle-timing-row">
                <span className="settle-timing-lbl">Placed</span>
                <span className="settle-timing-val">
                  {formatStamp(data.placedAt)}
                </span>
              </div>
            )}
            {data.settledAt && (
              <div className="settle-timing-row">
                <span className="settle-timing-lbl">Settled</span>
                <span className="settle-timing-val">
                  {formatStamp(data.settledAt)}
                </span>
              </div>
            )}
            {data.placedAt && data.settledAt && (
              <div className="settle-timing-row settle-timing-row-quiet">
                <span className="settle-timing-lbl">Live for</span>
                <span className="settle-timing-val">
                  {formatDuration(data.placedAt, data.settledAt)}
                </span>
              </div>
            )}
          </div>
        )}
        {(data.bookedDailyPnl || data.groupRank) && (
          <div className="settle-book">
            {win ? "Booked to your day" : "Your day"}
            {data.bookedDailyPnl && (
              <>
                {" · "}
                <b>{data.bookedDailyPnl}</b>
              </>
            )}
            {data.groupRank && <> · {data.groupRank}</>}
          </div>
        )}
        <div className="settle-btns">
          <button type="button" className="settle-done" onClick={onClose}>
            Done
          </button>
          {data.betId ? (
            <Link
              href={`/live/bet/${data.betId}`}
              className="settle-replay"
              onClick={onClose}
            >
              View full replay →
            </Link>
          ) : (
            <button
              type="button"
              className="settle-share"
              onClick={() => (win ? onShare(data) : onClose())}
            >
              {win ? "Share the W" : "Next one"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
