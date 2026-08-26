/** Map an internal fetch error to something safe to put on a public
 *  page. Upstream failures quote our proxy vendor verbatim, billing
 *  URL and all — that was already reaching the status tooltips and
 *  must not reach the visible empty state. The untouched original
 *  travels in `detail`, which the client does not render, so
 *  debugging still has the real text.
 *
 *  Book NAMES are fine here: this tool exists to compare named
 *  books and already labels its columns with them. It is the
 *  plumbing behind them that shouldn't be on show. */
export function publicError(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  // Ours, and safe to show as-is.
  if (
    s.includes("home scraper offline") ||
    s.includes("no round-score lines posted") ||
    s.includes("isn't carrying")
  ) {
    return raw;
  }
  if (s.includes("credit") || s.includes("exhausted") || s.includes("quota")) {
    return "Price feed unavailable — upstream quota reached";
  }
  return "Couldn't reach this book right now";
}
