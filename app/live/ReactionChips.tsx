"use client";

/**
 * ReactionChips — pill cluster + always-visible ＋ react affordance.
 * Sits on the left of a card's single action row.
 *
 *   ┌─ scrolls horizontally ────────────────┐
 *   │ 🔥 12   😱 4   ⛳ 3   👏 2   +N        │  ＋
 *   └────────────────────────────────────────┘
 *
 * Layout: `.rxn-group` is the flex item the parent .post-act-row
 * places. Inside, `.rxn-pills` is the inner scrollable container
 * that holds pills + overflow chip; the ＋ button sits OUTSIDE
 * that scroller so it's always visible even on cards with many
 * reactions. Pills scroll horizontally as a safety so nothing
 * ever clips mid-pill; in practice we cap at 4 visible chips with
 * a +N overflow chip for the rest.
 *
 * Tapping a pill toggles the caller's reaction; the ＋ button
 * calls `onAdd` with its viewport-centre point so the parent can
 * anchor the hold-react tray to it.
 *
 * Matches the prototype's BetPost / ShotPost foot intent — the
 * old 👍 `.act` button has been retired (every reaction is just
 * another emoji now). See design-handoff/Pardle Social v2.html
 * lines 297-302 and social-v2.css `.bp-foot` / `.tailbtn`.
 */

import type React from "react";

const MAX_VISIBLE = 4;

export interface ReactionState {
  /** Emoji → count map. */
  counts: Record<string, number>;
  /** Emojis the caller has reacted with. */
  mine: string[];
}

interface Props {
  state: ReactionState | undefined;
  onToggle: (emoji: string) => void;
  /** Fires when the ＋ chip is tapped. Parent receives the button's
   *  viewport-centre point so it can position the hold-react tray
   *  consistently with where the user just touched. */
  onAdd: (anchor: { x: number; y: number }) => void;
}

export default function ReactionChips({ state, onToggle, onAdd }: Props) {
  const entries = state
    ? Object.entries(state.counts).filter(([, n]) => n > 0)
    : [];
  entries.sort((a, b) => b[1] - a[1]);
  const visible = entries.slice(0, MAX_VISIBLE);
  const overflow = entries.length - visible.length;
  const mineSet = state ? new Set(state.mine) : new Set<string>();

  const handleAdd = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    onAdd({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  };

  return (
    <div className="rxn-group" data-no-hold>
      <div className="rxn-pills">
        {visible.map(([emoji, count]) => {
          const isMine = mineSet.has(emoji);
          return (
            <button
              key={emoji}
              type="button"
              className={`rxn-chip${isMine ? " rxn-chip-mine" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggle(emoji);
              }}
              aria-pressed={isMine}
              aria-label={`${emoji} ${count} reactions${
                isMine ? " — you reacted" : ""
              }`}
            >
              <span className="rxn-chip-emoji" aria-hidden="true">
                {emoji}
              </span>
              <span className="rxn-chip-count">{count}</span>
            </button>
          );
        })}
        {overflow > 0 && (
          <span
            className="rxn-chip rxn-chip-overflow"
            aria-label={`${overflow} more`}
          >
            +{overflow}
          </span>
        )}
      </div>
      <button
        type="button"
        className="rxn-chip-add"
        onClick={handleAdd}
        aria-label="Add reaction"
      >
        ＋
      </button>
    </div>
  );
}
