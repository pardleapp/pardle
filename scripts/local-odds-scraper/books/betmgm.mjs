/**
 * BetMGM scraper.
 *
 * BetMGM runs on the bwin/entain stack. Their SPA loads market
 * data client-side via `cds-api.betmgm.com`. From a real browser
 * session at a residential IP, the SPA renders normally and we
 * DOM-walk for round-score markets.
 *
 * State-specific subdomain: `sports.{state}.betmgm.com`. If your
 * home IP is in a state BetMGM doesn't serve, they'll show a
 * "not available in your region" wall — swap the hostname below
 * for a state you're in.
 */

const HUB_URL_CANDIDATES = [
  "https://sports.betmgm.com/en/sports/golf-11",
  "https://sports.betmgm.com/en/sports/golf-25",
  "https://sports.betmgm.com/en/sports/golf-15",
  "https://sports.nj.betmgm.com/en/sports/golf-11",
];

/** Try each candidate hub until one shows a golf tournament link.
 *  BetMGM's golf sport ID varies by region (11 / 15 / 25) — we
 *  just try each until one renders content. */
async function findTournamentUrl(page) {
  for (const hub of HUB_URL_CANDIDATES) {
    try {
      await page.goto(hub, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(2500);
      const href = await page
        .locator("a[href*='fedex'], a[href*='championship'], a[href*='tournament']")
        .first()
        .getAttribute("href")
        .catch(() => null);
      if (href) return new URL(href, hub).toString();
    } catch {
      /* try next hub */
    }
  }
  throw new Error("no active tournament link on any BetMGM golf hub");
}

export async function scrapeBetmgm(page) {
  const url = await findTournamentUrl(page);
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
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
      ...document.querySelectorAll("h1, h2, h3, h4, h5, [role='heading'], .market-group-header, ms-market-group-title"),
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
          "ms-two-way-vertical, ms-two-way-widget, .market-view, .participant-container, [class*='market'][class*='row']",
        );
        if (cards.length > 0) {
          for (const card of cards) {
            const nameEl = card.querySelector(
              "ms-market-title, .market-title, .participant-name, [class*='participant']",
            );
            const playerName = (nameEl?.textContent || "").trim();
            if (!playerName) continue;
            const buttons = card.querySelectorAll(
              "ms-option, .option-value, button, [role='button']",
            );
            let over = null;
            let under = null;
            let line = null;
            for (const btn of buttons) {
              const label = String(btn.textContent || "").trim();
              const lm = label.match(/(\d+(?:\.\d+)?)/);
              if (lm && line == null) line = Number(lm[1]);
              const pm = label.match(/([+\-]\d{2,4})/);
              const dec = pm ? decimalFromAmerican(pm[1]) : null;
              if (/over|higher|more/i.test(label)) over = dec ?? over;
              else if (/under|lower|less/i.test(label)) under = dec ?? under;
            }
            if (line == null || (over == null && under == null)) continue;
            out.push({
              book: "betmgm",
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
