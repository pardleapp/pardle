"use client";

/**
 * Slim segmented filter for v3: `All · Hot · Mine`.
 *
 * Same underlying filter modes as v1 (`all`/`hot`/`smart`), just a
 * different visual — an inline pill group that eats one row of
 * ~90px height instead of the full-width bar buttons in v1.
 *
 * Mine only appears when the caller says it should (viewer has an
 * active bet OR a followed player) — same gating as v1.
 */

export type FilterMode = "all" | "hot" | "smart";

interface Props {
  mode: FilterMode;
  onChange: (mode: FilterMode) => void;
  canShowMine: boolean;
  /** Optional per-tab counts for the ticker tail (`All 148 · Hot 22`). */
  counts?: Partial<Record<FilterMode, number>>;
}

interface TabDef {
  id: FilterMode;
  label: string;
  title: string;
}

export default function FilterTabsV3({
  mode,
  onChange,
  canShowMine,
  counts,
}: Props) {
  const tabs: TabDef[] = [
    { id: "all", label: "All", title: "Every event, ranked" },
    { id: "hot", label: "Hot", title: "Notable moments only" },
  ];
  if (canShowMine) {
    tabs.push({ id: "smart", label: "Mine", title: "Your bets + followed players" });
  }

  return (
    <div className="feed-v3-tabs" role="tablist" aria-label="Feed filter">
      {tabs.map((t) => {
        const active = mode === t.id;
        const count = counts?.[t.id];
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`feed-v3-tab ${active ? "feed-v3-tab-on" : ""}`}
            onClick={() => onChange(t.id)}
            title={t.title}
          >
            {t.label}
            {typeof count === "number" && count > 0 && (
              <span className="feed-v3-tab-count">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
