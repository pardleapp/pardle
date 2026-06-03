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

import Confetti from "./Confetti";
import { useDismissibleOverlay } from "@/app/_hooks/useDismissibleOverlay";

export interface SettlementData {
  win: boolean;
  /** Profit/loss display string — "+£500", "−$20". */
  profitLabel: string;
  /** Total returned to the bettor — "£1,000" — used in the bet line
   *  ("£500 @ 2.00 · returned £1,000"). Wins only. */
  returnedLabel?: string;
  /** Settled bet shape for the bet-line. */
  player: string;
  market: string;
  currency: "£" | "$";
  stake: number;
  oddsLabel: string;
  /** Stat strip — "+£226" or "−£40" daily P&L + rank string. */
  bookedDailyPnl: string;
  groupRank: string;
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
        <div className="settle-book">
          {win ? (
            <>
              Booked to your day · <b>{data.bookedDailyPnl}</b> ·{" "}
              {data.groupRank}
            </>
          ) : (
            <>
              Your day · <b>{data.bookedDailyPnl}</b> · {data.groupRank}
            </>
          )}
        </div>
        <div className="settle-btns">
          <button type="button" className="settle-done" onClick={onClose}>
            Done
          </button>
          <button
            type="button"
            className="settle-share"
            onClick={() => (win ? onShare(data) : onClose())}
          >
            {win ? "Share the W" : "Next one"}
          </button>
        </div>
      </div>
    </div>
  );
}
