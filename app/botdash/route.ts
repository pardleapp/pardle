import { timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";

// Internal golf-bot dashboard (Tom, 11-16). A route handler, not a page.tsx, so it never passes through the root
// layout: that layout loads analytics, which records page URLs and would leak the ?k= key. Not linked, not in the
// sitemap, not in robots.ts (a Disallow line would advertise the path). Fails closed: no or short key = 404.
// The publisher on Tom's PC decides all wording; this file only renders the snapshot's display blocks.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SNAPSHOT_KEY = "botdash:snapshot";

type Tone = "plain" | "good" | "warn" | "bad" | "muted";
type Cell = string | { t: string; tone?: Tone | null };
type Block =
  | { kind: "text"; text: string; tone?: Tone }
  | { kind: "notice"; text: string; tone?: Tone }
  | { kind: "tiles"; items: { label: string; value: string; sub?: string; tone?: Tone }[] }
  | { kind: "kv"; rows: [string, string][] }
  | {
      kind: "table";
      columns: { label: string; align?: "left" | "right" }[];
      rows: Cell[][];
      foot?: Cell[];
      tag?: string;
    }
  | { kind: "bars"; label: string; items: { x: string; v: number }[]; baseline?: number; unit?: string }
  | { kind: "fold"; title: string; blocks: Block[] };
type Section = { id: string; title: string; definition?: string; freshness?: string; blocks: Block[] };
type Snapshot = {
  v: number;
  built_at: number;
  built_utc?: string;
  built_uk?: string;
  event?: string;
  round?: number | null;
  header?: { label: string; value: string; sub?: string; tone?: Tone }[];
  sections?: Section[];
};

const HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

function keyOk(given: string | null): boolean {
  const want = process.env.BOTDASH_KEY;
  if (!want || want.length < 24 || !given) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(want, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ageText(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 90) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const h = s / 3600;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

// Strings may carry {{age:<unix seconds>}} so the publisher's snapshot stays unchanged as time passes.
function txt(s: unknown, now: number): string {
  return esc(s).replace(/\{\{age:(\d+)\}\}/g, (_m, t: string) => ageText(now - Number(t)));
}

function toneClass(t?: Tone | null): string {
  return t && t !== "plain" ? ` t-${t}` : "";
}

function renderCell(c: Cell, now: number, tag: "td" | "th", align: string): string {
  const t = typeof c === "string" ? c : c?.t ?? "";
  const tone = typeof c === "string" ? null : c?.tone;
  return `<${tag} class="${align}${toneClass(tone)}">${txt(t, now)}</${tag}>`;
}

function renderBars(b: Extract<Block, { kind: "bars" }>): string {
  const items = b.items.filter((i) => Number.isFinite(i.v));
  if (!items.length) return "";
  const base = b.baseline ?? 0;
  const W = 360;
  const H = 120;
  const pad = 16;
  const span = Math.max(...items.map((i) => Math.abs(i.v - base)), 1e-6);
  const mid = H / 2;
  const scale = (H / 2 - pad) / span;
  const bw = W / items.length;
  const bars = items
    .map((i, k) => {
      const d = (i.v - base) * scale;
      const y = d >= 0 ? mid - d : mid;
      const cls = d >= 0 ? "bar-up" : "bar-down";
      return (
        `<rect class="${cls}" x="${(k * bw + 2).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${Math.max(1, Math.abs(d)).toFixed(1)}"><title>${esc(i.x)}: ${esc(i.v)}</title></rect>` +
        `<text class="bar-x" x="${(k * bw + bw / 2).toFixed(1)}" y="${H - 2}" text-anchor="middle">${esc(i.x)}</text>`
      );
    })
    .join("");
  return `<figure class="bars"><figcaption>${esc(b.label)}</figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(b.label)}"><line class="bar-base" x1="0" x2="${W}" y1="${mid}" y2="${mid}"/>${bars}</svg></figure>`;
}

function renderBlock(b: Block, now: number): string {
  switch (b.kind) {
    case "text":
      return `<p class="txt${toneClass(b.tone)}">${txt(b.text, now)}</p>`;
    case "notice":
      return `<div class="notice${toneClass(b.tone ?? "muted")}">${txt(b.text, now)}</div>`;
    case "tiles":
      return `<div class="tiles">${b.items
        .map(
          (i) =>
            `<div class="tile${toneClass(i.tone)}"><div class="tl">${txt(i.label, now)}</div><div class="tv">${txt(i.value, now)}</div>${i.sub ? `<div class="ts">${txt(i.sub, now)}</div>` : ""}</div>`,
        )
        .join("")}</div>`;
    case "kv":
      return `<dl class="kv">${b.rows.map(([k, v]) => `<dt>${txt(k, now)}</dt><dd>${txt(v, now)}</dd>`).join("")}</dl>`;
    case "table": {
      const al = b.columns.map((c) => (c.align === "left" ? "l" : "r"));
      const head = `<tr>${b.columns.map((c, i) => `<th class="${al[i]}">${txt(c.label, now)}</th>`).join("")}</tr>`;
      const body = b.rows.map((r) => `<tr>${r.map((c, i) => renderCell(c, now, "td", al[i] ?? "r")).join("")}</tr>`).join("");
      const foot = b.foot ? `<tfoot><tr>${b.foot.map((c, i) => renderCell(c, now, "td", al[i] ?? "r")).join("")}</tr></tfoot>` : "";
      const tag = b.tag ? `<div class="tag">${txt(b.tag, now)}</div>` : "";
      return `${tag}<div class="tw"><table><thead>${head}</thead><tbody>${body}</tbody>${foot}</table></div>`;
    }
    case "bars":
      return renderBars(b);
    case "fold":
      return `<details><summary>${txt(b.title, now)}</summary>${(b.blocks ?? []).map((x) => renderBlock(x, now)).join("")}</details>`;
    default:
      return "";
  }
}

const CSS = `
:root{--bg:#f6f4ef;--card:#fff;--ink:#1d1d1b;--mute:#6b6a65;--line:#e2dfd6;--good:#0f7a4d;--bad:#b3261e;--warn:#9a5b00;
--goodbg:#e6f4ec;--badbg:#fbe9e7;--warnbg:#fff3dc;--mutebg:#f0eee8;--up:#c2410c;--down:#0f7a4d}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1e1c;--ink:#ecebe6;--mute:#a3a29b;--line:#34332f;
--good:#5fd39a;--bad:#ff8a80;--warn:#f0b54a;--goodbg:#13291e;--badbg:#341a18;--warnbg:#33270f;--mutebg:#262623;--up:#f08a4b;--down:#5fd39a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:980px;margin:0 auto;padding:12px 16px 48px}
h1{font-size:20px;margin:6px 0 2px}
.sub{color:var(--mute);font-size:13px}
.banner{margin:10px 0;padding:8px 12px;border-radius:8px;background:var(--goodbg);color:var(--good);font-weight:600}
.banner.t-warn{background:var(--warnbg);color:var(--warn)}
.banner.t-bad{background:var(--badbg);color:var(--bad)}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:14px 0}
h2{font-size:17px;margin:0 0 4px}
.def{color:var(--mute);font-size:13px;margin:0 0 4px}
.fresh{color:var(--mute);font-size:12px;margin:0 0 10px}
p.txt{margin:8px 0}
.t-good{color:var(--good)}.t-bad{color:var(--bad)}.t-warn{color:var(--warn)}.t-muted{color:var(--mute)}
.notice{padding:10px 12px;border-radius:8px;margin:8px 0;background:var(--mutebg);color:var(--mute)}
.notice.t-warn{background:var(--warnbg);color:var(--warn)}.notice.t-bad{background:var(--badbg);color:var(--bad)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:8px 0}
.tile{border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--card)}
.tile .tl{font-size:12px;color:var(--mute)}.tile .tv{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}
.tile .ts{font-size:12px;color:var(--mute)}
.tile.t-good .tv{color:var(--good)}.tile.t-bad .tv{color:var(--bad)}.tile.t-warn .tv{color:var(--warn)}
dl.kv{display:grid;grid-template-columns:minmax(120px,32%) 1fr;gap:6px 12px;margin:8px 0}
dl.kv dt{color:var(--mute);font-size:13px}dl.kv dd{margin:0;overflow-wrap:anywhere}
.tw{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:8px 0;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
th,td{padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--mutebg);font-weight:600;white-space:nowrap}
td.r,th.r{text-align:right;white-space:nowrap}td.l,th.l{text-align:left}
tfoot td{font-weight:700;border-top:2px solid var(--line)}
.tag{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;background:var(--warnbg);color:var(--warn);margin-top:6px}
details{margin:8px 0;border:1px solid var(--line);border-radius:8px;padding:6px 10px}
summary{cursor:pointer;font-weight:600;min-height:32px;display:list-item}
figure.bars{margin:10px 0}figure.bars figcaption{font-size:13px;color:var(--mute);margin-bottom:4px}
figure.bars svg{width:100%;max-width:520px;height:auto;display:block}
.bar-up{fill:var(--up)}.bar-down{fill:var(--down)}.bar-base{stroke:var(--mute);stroke-width:1}
.bar-x{font-size:9px;fill:var(--mute)}
`;

function page(snap: Snapshot | null, now: number): string {
  let banner: string;
  let body = "";
  if (!snap || typeof snap !== "object") {
    banner = `<div class="banner t-warn">No snapshot yet: the publisher has not run.</div>`;
  } else {
    const ageS = now - Number(snap.built_at || 0);
    banner =
      ageS < 180
        ? `<div class="banner">Updated ${ageText(ageS)}</div>`
        : `<div class="banner t-warn">Last update ${ageText(ageS)}: the publisher on Tom's PC may be stopped</div>`;
    if (snap.v !== 1) banner += `<div class="banner t-warn">Snapshot is a newer format than this page</div>`;
    const head = snap.header?.length
      ? renderBlock({ kind: "tiles", items: snap.header }, now)
      : "";
    const secs = (snap.sections ?? [])
      .map(
        (s) =>
          `<section id="${esc(s.id)}"><h2>${txt(s.title, now)}</h2>${s.definition ? `<p class="def">${txt(s.definition, now)}</p>` : ""}${s.freshness ? `<p class="fresh">${txt(s.freshness, now)}</p>` : ""}${(s.blocks ?? []).map((b) => renderBlock(b, now)).join("")}</section>`,
      )
      .join("");
    body =
      `<h1>${esc(snap.event ?? "Golf bots")}${snap.round ? ` · round ${esc(snap.round)}` : ""}</h1>` +
      `<div class="sub">Built ${esc(snap.built_utc ?? "")} (${esc(snap.built_uk ?? "")}). Prices are decimal odds.</div>` +
      banner +
      head +
      secs;
    banner = "";
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="refresh" content="60"><meta name="referrer" content="no-referrer"><title>Bot dashboard</title><style>${CSS}</style></head><body><main>${banner}${body}</main></body></html>`;
}

// The publisher on Tom's PC POSTs the snapshot here with a separate push key, so Pardle's store write token never
// leaves Vercel (those variables are marked sensitive and cannot be pulled to the PC). Bad or missing key = 404.
const MAX_BODY = 900_000;

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const want = process.env.BOTDASH_PUSH_KEY;
  if (!want || want.length < 24 || !given) return notFound();
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(want, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return notFound();
  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response("Too large", { status: 413, headers: HEADERS });
  let snap: Snapshot;
  try {
    snap = JSON.parse(raw) as Snapshot;
  } catch {
    return new Response("Bad JSON", { status: 400, headers: HEADERS });
  }
  if (!snap || typeof snap !== "object" || typeof snap.v !== "number" || !Array.isArray(snap.sections)) {
    return new Response("Bad snapshot", { status: 400, headers: HEADERS });
  }
  try {
    await Redis.fromEnv().set(SNAPSHOT_KEY, snap, { ex: 604800 });
  } catch {
    return new Response("Store error", { status: 502, headers: HEADERS });
  }
  return new Response("OK", { status: 200, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(req: Request): Promise<Response> {
  const k = new URL(req.url).searchParams.get("k");
  if (!keyOk(k)) return notFound();
  let snap: Snapshot | null = null;
  try {
    const url = process.env.KV_REST_API_URL;
    const ro = process.env.KV_REST_API_READ_ONLY_TOKEN;
    const redis = url && ro ? new Redis({ url, token: ro }) : Redis.fromEnv();
    snap = await redis.get<Snapshot>(SNAPSHOT_KEY);
  } catch {
    snap = null;
  }
  const now = Date.now() / 1000;
  return new Response(page(snap, now), {
    status: 200,
    headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}
