/**
 * Caesars Sportsbook scraper.
 *
 * Caesars uses the SBTech (William Hill legacy) platform under the
 * hood. Their SPA does client-side routing per state. We navigate
 * to the state-scoped golf page, wait for markets to render, and
 * walk the DOM for round-score O/U rows.
 *
 * Their selector shape (as of 2026-08 recon): each market row is
 * a `[data-testid="MarketBoard"]` container holding a player name
 * and two option buttons with american-price text.
 *
 * When Caesars ships a UI change and this scraper returns zero
 * quotes, run headed (HEADLESS=false) and inspect the DOM to
 * pick new selectors.
 */

/** Direct link to Caesars' "Round Props" tab — surfaces every
 *  active round-score O/U across every current tournament in one
 *  view. Auto-redirects to the visitor's state-scoped page. */
const ROUND_PROPS_URL =
  "https://sportsbook.caesars.com/golf?tab=SCHEDULE%7CRound%20Props";

export async function scrapeCaesars(page) {
  await page.goto(ROUND_PROPS_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  // The Round Props tab renders one accordion per active round;
  // wait until at least one shows up before we walk the DOM. Longer
  // for Caesars — their SPA is slower than DK/FD.
  await page
    .waitForSelector("text=/round\\s*\\d/i", { timeout: 45_000 })
    .catch(() => {});
  await page.waitForTimeout(3000);
  // When DEBUG_DUMP=1, save the round-props section HTML to
  // caesars-debug.html so Claude can inspect the real markup and
  // tune selectors. Only fires when the parse below returns 0
  // quotes, so it's dormant once the parser is working.
  const DEBUG_DUMP = process.env.DEBUG_DUMP === "1";

  const nowIso = new Date().toISOString();
  const quotes = await page.evaluate((now) => {
    /** Decimal odds from an American price integer. */
    const decimalFromAmerican = (n) => {
      if (!Number.isFinite(n) || n === 0) return null;
      return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
    };

    // Caesars' Round Props DOM (recon 2026-08):
    //  - Every player's O/U pair sits inside a card
    //    [data-cy="cui__card"][id^="cui__market-template-"]
    //  - Card header text: "Round N Score - <Player Name> Live"
    //  - Each side is a button [data-cy="market-button-btn"] with
    //    aria-label "Over 72.5 odds at +200" (or "Under ...").
    //  - Both buttons share data-market so we pair by that.
    const results = [];
    const cards = document.querySelectorAll(
      '[data-cy="cui__card"][id^="cui__market-template-"]',
    );
    for (const card of cards) {
      // Header: e.g. "Round 4 Score - Sam Burns Live". Sometimes
      // "Round 4 Score - Scottie Scheffler" (no Live suffix if
      // suspended). Match round + player in one regex.
      let round = null;
      let playerName = null;
      const headerCandidates = card.querySelectorAll(
        ".heading-sm-bold, .cui-text-fg-moderate",
      );
      for (const h of headerCandidates) {
        const t = String(h.textContent || "").trim();
        const m = t.match(/Round\s*(\d)\s*Score\s*[-–—]\s*(.+?)(?:\s+Live)?\s*$/i);
        if (m) {
          const r = Number(m[1]);
          if (r >= 1 && r <= 4) {
            round = r;
            playerName = m[2].trim();
            break;
          }
        }
      }
      if (round == null || !playerName) continue;

      const buttons = card.querySelectorAll('[data-cy="market-button-btn"]');
      let over = null;
      let under = null;
      let line = null;
      for (const btn of buttons) {
        const label = btn.getAttribute("aria-label") ?? "";
        // e.g. "Over 72.5 odds at +200" — pull side, line, price.
        const m = label.match(/^(Over|Under)\s+(\d+(?:\.\d+)?)\s+odds\s+at\s+([+\-]?\d+)/i);
        if (!m) continue;
        const side = m[1].toLowerCase();
        const l = Number(m[2]);
        const price = Number(m[3]);
        if (!Number.isFinite(l) || !Number.isFinite(price)) continue;
        if (line == null) line = l;
        const dec = decimalFromAmerican(price);
        if (side === "over") over = dec;
        else if (side === "under") under = dec;
      }
      if (line == null || (over == null && under == null)) continue;
      results.push({
        book: "caesars",
        playerName,
        round,
        line,
        over,
        under,
        lastUpdatedAt: now,
      });
    }
    return results;
  }, nowIso);
  if (quotes.length === 0 && DEBUG_DUMP) {
    // Grab enough surrounding markup to see the round-props
    // structure Caesars actually uses. Trim the whole document to
    // whichever main-content container the SPA renders into.
    const html = await page.evaluate(() => {
      const main =
        document.querySelector("main") ??
        document.querySelector("[role='main']") ??
        document.body;
      return main.outerHTML;
    });
    const { writeFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const outPath = resolve(here, "..", "caesars-debug.html");
    writeFileSync(outPath, html, "utf-8");
    console.log(`  [caesars] DEBUG_DUMP → wrote ${outPath} (${html.length} bytes)`);
  }
  return quotes;
}
