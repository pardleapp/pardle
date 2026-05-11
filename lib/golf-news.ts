/**
 * Daily golf news — fetched server-side from a free RSS feed and
 * cached so the hub page can render a rotating ticker without hitting
 * a third-party API on every request.
 *
 * Source: PGA Tour's "All News" RSS. Backed up by golf.com if PGA's
 * feed fails. We pull on demand from the server and the response is
 * cached by Next.js `fetch` with revalidate: 1800 (30 min), so even
 * at peak traffic we hit the upstream at most twice an hour per
 * deployment region.
 *
 * If both feeds are unavailable we return an empty list — the hub
 * just hides the ticker rather than showing stale/empty headlines.
 */

const SOURCES: { url: string; name: string }[] = [
  {
    url: "https://www.pgatour.com/content/pgatour/news/_jcr_content.feed",
    name: "PGA Tour",
  },
  { url: "https://golf.com/feed/", name: "Golf.com" },
];

export interface GolfHeadline {
  title: string;
  link: string;
  source: string;
}

/** Strip basic HTML entities so RSS-encoded titles render cleanly. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1");
}

function parseRss(xml: string, sourceName: string): GolfHeadline[] {
  const items: GolfHeadline[] = [];
  // Cheap regex parse — good enough for well-formed RSS 2.0 / Atom.
  // We pick up the first 8 <item> or <entry> blocks and pull the
  // first <title> + <link> inside each.
  const itemRegex = /<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/g;
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = itemRegex.exec(xml)) && count < 10) {
    const block = match[0];
    const titleMatch =
      /<title[^>]*>([\s\S]*?)<\/title>/.exec(block) ||
      /<title[^>]*>([\s\S]*?)<\/title>/i.exec(block);
    const linkMatch =
      /<link[^>]*href="([^"]+)"/.exec(block) ||
      /<link[^>]*>([\s\S]*?)<\/link>/.exec(block);
    if (!titleMatch || !linkMatch) continue;
    const title = decodeEntities(titleMatch[1].trim());
    const link = linkMatch[1].trim();
    if (!title || !link) continue;
    items.push({ title, link, source: sourceName });
    count += 1;
  }
  return items;
}

/**
 * Fetch the latest golf headlines. Cached server-side for 30 minutes
 * via Next.js's `next` fetch option.
 */
export async function getGolfHeadlines(): Promise<GolfHeadline[]> {
  for (const src of SOURCES) {
    try {
      const res = await fetch(src.url, {
        // Edge-cached at the Vercel layer for 30 minutes. Lets the
        // hub render on the server with no per-request RSS hit.
        next: { revalidate: 1800 },
        headers: { "User-Agent": "PardleBot/0.1 (https://pardle.app)" },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseRss(xml, src.name);
      if (items.length > 0) return items.slice(0, 6);
    } catch {
      // try next source
    }
  }
  return [];
}
