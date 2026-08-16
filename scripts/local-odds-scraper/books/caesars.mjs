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
  // wait until at least one shows up before we walk the DOM.
  await page
    .waitForSelector("text=/round\\s*\\d/i", { timeout: 30_000 })
    .catch(() => {});

  const nowIso = new Date().toISOString();
  const quotes = await page.evaluate((now) => {
    const decimalFromAmerican = (s) => {
      const n = Number(String(s).replace(/[^0-9+\-]/g, ""));
      if (!Number.isFinite(n) || n === 0) return null;
      return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
    };
    const out = [];
    const headers = [
      ...document.querySelectorAll("h1, h2, h3, h4, h5, [role='heading']"),
    ].filter((h) =>
      /round\s*\d.*(?:score|total|strokes)/i.test(h.textContent || ""),
    );
    for (const header of headers) {
      const m = String(header.textContent || "").match(/round\s*(\d)/i);
      if (!m) continue;
      const round = Number(m[1]);
      if (round < 1 || round > 4) continue;
      let container = header.parentElement;
      let depth = 0;
      while (container && depth < 6) {
        const cards = container.querySelectorAll(
          "[data-testid='MarketBoard'], [data-testid='market-container'], .market-list__item",
        );
        if (cards.length > 0) {
          for (const card of cards) {
            const nameEl = card.querySelector(
              "[data-testid='MarketName'], .market-title, [data-testid='participant-name']",
            );
            const playerName = (nameEl?.textContent || "").trim();
            if (!playerName) continue;
            const buttons = card.querySelectorAll("button, [role='button']");
            let over = null;
            let under = null;
            let line = null;
            for (const btn of buttons) {
              const label = String(btn.textContent || "").trim();
              const lm = label.match(/(\d+(?:\.\d+)?)/);
              if (lm && line == null) line = Number(lm[1]);
              const pm = label.match(/([+\-]\d{2,4})/);
              const dec = pm ? decimalFromAmerican(pm[1]) : null;
              if (/over|higher/i.test(label)) over = dec ?? over;
              else if (/under|lower/i.test(label)) under = dec ?? under;
            }
            if (line == null || (over == null && under == null)) continue;
            out.push({
              book: "caesars",
              playerName,
              round,
              line,
              over,
              under,
              lastUpdatedAt: now,
            });
          }
          break;
        }
        container = container.parentElement;
        depth++;
      }
    }
    return out;
  }, nowIso);
  return quotes;
}
