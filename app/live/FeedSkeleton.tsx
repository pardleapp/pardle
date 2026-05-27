/**
 * Skeleton UI shown in place of "Loading the feed…" while the first
 * /api/feed response is in flight. Ghost rows immediately give the
 * page structure so a cold-load doesn't feel empty — the same
 * pattern Twitter / Instagram / ESPN use to flatten the perceived
 * wait.
 *
 * Optional `hintMs` shows an honest "usually ~2.1s" hint derived
 * from a rolling median of the user's own recent /api/feed
 * durations (read from localStorage by the parent). Honest about
 * timing, not a fake countdown.
 */

interface Props {
  /** Median load time in ms across recent fetches. Skipped when no
   *  prior data exists. */
  hintMs?: number | null;
}

export default function FeedSkeleton({ hintMs }: Props) {
  const hintSeconds =
    hintMs && hintMs > 200 ? (hintMs / 1000).toFixed(1) : null;

  return (
    <section className="feed-wrap v4-theme">
      <div className="feed-header-row">
        <div className="skeleton-line skeleton-line-title" />
      </div>
      <div className="skeleton-line skeleton-line-search" />
      <ul className="feed-list" aria-busy="true" aria-label="Loading feed">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="feed-row-wrap skeleton-row-wrap">
            <div className="feed-row skeleton-row">
              <div className="skeleton-avatar" />
              <div className="skeleton-body">
                <div className="skeleton-line skeleton-line-name" />
                <div className="skeleton-line skeleton-line-action" />
                <div className="skeleton-line skeleton-line-meta" />
              </div>
              <div className="skeleton-score" />
            </div>
          </li>
        ))}
      </ul>
      <p className="skeleton-hint">
        {hintSeconds ? (
          <>Loading live feed · usually ~{hintSeconds}s</>
        ) : (
          <>Loading live feed</>
        )}
      </p>
    </section>
  );
}
