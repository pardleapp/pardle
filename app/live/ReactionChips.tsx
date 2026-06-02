"use client";

/**
 * ReactionChips — row of small emoji + count pills above the
 * thumb/comment action row on a feed card.
 *
 *   🔥 12   😱 4   ⛳ 3   👏 2   +N
 *
 * Sorted by count descending. The caller's own reactions get an
 * emerald-tint variant so it's obvious which they've added.
 * Tapping a pill toggles the caller's reaction for that emoji —
 * piles on without needing to long-press the card.
 *
 * Capped to 5 visible chips; any overflow collapses into a "+N"
 * indicator (non-interactive — viewing the full list is a later
 * surface if we ever need it).
 */

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
}

export default function ReactionChips({ state, onToggle }: Props) {
  if (!state) return null;
  const entries = Object.entries(state.counts).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const visible = entries.slice(0, MAX_VISIBLE);
  const overflow = entries.length - visible.length;
  const mineSet = new Set(state.mine);

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
    </div>
  );
}
