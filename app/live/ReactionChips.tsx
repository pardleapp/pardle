"use client";

/**
 * ReactionChips — pill cluster + ＋ react affordance, rendered as
 * the left half of a card's single action row.
 *
 *   🔥 12   😱 4   ⛳ 3   👏 2   ＋
 *
 * Pills are sorted by count descending; the caller's own reactions
 * get an emerald-tint variant. Tapping a pill toggles the caller's
 * reaction for that emoji. The ＋ button at the end calls `onAdd`
 * with the button's centre point so the parent can pop the hold-
 * react tray anchored to it — a visible replacement for the old
 * 👍 thumb button (every reaction is just another emoji now).
 *
 * Capped to 5 visible chips; any overflow collapses into a "+N"
 * indicator (non-interactive).
 *
 * The container is horizontally scrollable when pills overflow —
 * the wider action row pins the comment / Tail buttons on the
 * right while this region scrolls under them.
 */

import type React from "react";

const MAX_VISIBLE = 5;

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
    <div className="rxn-chips" data-no-hold>
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
        <span className="rxn-chip rxn-chip-overflow" aria-label={`${overflow} more`}>
          +{overflow}
        </span>
      )}
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
