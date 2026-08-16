/**
 * FanDuel scraper.
 *
 * FD's SPA client-renders every market. From a real browser session
 * (residential IP + real Chrome) it renders normally. We navigate
 * to the active tournament's leaf page, wait for the round-score
 * accordion to render, then walk the DOM.
 *
 * Selector strategy: FanDuel groups round-score props under a
 * "Round X Score" tab within the tournament page. Each row is a
 * `<div data-testid="market">` containing player name, line, and
 * two option buttons ("More X" / "Less X" with american prices).
 *
 * Selectors WILL drift when FD ships UI changes; when the scraper
 * starts returning zero quotes, run `HEADLESS=false npm start` to
 * watch what the page actually shows, then update the selectors
 * below. This is the maintenance tax of scraping.
 */

const TOURNAMENT_URL =
  "https://sportsbook.fanduel.com/navigation/golf";

/** Nav from the golf hub to the current tournament's page. FD's
 *  tournament URL slug follows their nameIdentifier field, e.g.
 *  "fedex-st-jude-championship". We link-crawl the golf hub so
 *  we don't hard-code a slug that changes every week. */
async function findTournamentUrl(page) {
  await page.goto(TOURNAMENT_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForSelector("a[href*='/navigation/golf/']", {
    timeout: 30_000,
  });
  // Grab the first golf tournament link that isn't the hub itself.
  const href = await page
    .locator("a[href*='/navigation/golf/']")
    .first()
    .getAttribute("href");
  if (!href) throw new Error("no active tournament link on FD golf hub");
  return new URL(href, "https://sportsbook.fanduel.com").toString();
}

/** Parse a FanDuel american price like "+120" or "-155" to decimal. */
function decimalFromAmerican(s) {
  const n = Number(String(s).replace(/[^0-9+\-]/g, ""));
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

/** Round number parsed from a section header ("Round 3 Score" → 3). */
function roundFromHeader(text) {
  const m = String(text).match(/round\s*(\d)/i);
  if (!m) return null;
  const r = Number(m[1]);
  return r >= 1 && r <= 4 ? r : null;
}

export async function scrapeFanduel(page) {
  const url = await findTournamentUrl(page);
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  // Wait for markets to render — any h2/h3 with "Round" text.
  await page
    .waitForSelector("text=/round\\s*\\d/i", { timeout: 30_000 })
    .catch(() => {});

  // Extract round-score O/U markets. FanDuel groups these under
  // section headers that read "Round N Score" or similar; each
  // player line is a card with:
  //   - player name (text)
  //   - line (numeric)
  //   - two option buttons ("More" / "Less" or "Over" / "Under")
  const nowIso = new Date().toISOString();
  const quotes = await page.evaluate((now) => {
    /** @type {Array<{book:string,playerName:string,round:number,line:number,over:number|null,under:number|null,lastUpdatedAt:string}>} */
    const out = [];
    const decimalFromAmerican = (s) => {
      const n = Number(String(s).replace(/[^0-9+\-]/g, ""));
      if (!Number.isFinite(n) || n === 0) return null;
      return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
    };
    // FD's markup: each round-score accordion is a section with a
    // header + a list of player-row divs. We iterate every element
    // that carries "Round N Score" in its text.
    const headers = [
      ...document.querySelectorAll("h1, h2, h3, h4, h5, [role='heading']"),
    ].filter((h) => /round\s*\d.*(?:score|total)/i.test(h.textContent || ""));
    for (const header of headers) {
      const m = String(header.textContent || "").match(/round\s*(\d)/i);
      if (!m) continue;
      const round = Number(m[1]);
      if (round < 1 || round > 4) continue;
      // Player rows live in the sibling container. Walk down the
      // parent until we find a container with market cards.
      let container = header.parentElement;
      let depth = 0;
      while (container && depth < 6) {
        const cards = container.querySelectorAll(
          "[data-market-name], [data-testid='market-row'], [data-testid='market']",
        );
        if (cards.length > 0) {
          for (const card of cards) {
            const nameEl = card.querySelector(
              "[data-testid='market-participant-name'], [data-market-name], [data-testid='event-cell-participant-title']",
            );
            const playerName = (nameEl?.textContent || card.getAttribute("data-market-name") || "").trim();
            if (!playerName) continue;
            const optionBtns = card.querySelectorAll(
              "button, [role='button'], [data-testid='outcome-button']",
            );
            let over = null;
            let under = null;
            let line = null;
            for (const btn of optionBtns) {
              const label = String(btn.textContent || "").trim();
              const lineMatch = label.match(/(\d+(?:\.\d+)?)/);
              if (lineMatch && line == null) line = Number(lineMatch[1]);
              const priceMatch = label.match(/([+\-]\d+)/);
              const dec = priceMatch ? decimalFromAmerican(priceMatch[1]) : null;
              if (/over|more|higher/i.test(label)) over = dec ?? over;
              else if (/under|less|lower/i.test(label)) under = dec ?? under;
            }
            if (line == null || (over == null && under == null)) continue;
            out.push({
              book: "fanduel",
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
