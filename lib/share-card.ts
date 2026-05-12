/**
 * Compact encoding of a finished Pardle result, suitable for embedding
 * in a share URL like pardle.app/r/{token}. The token URL has an
 * opengraph-image that renders the result as a branded PNG, so the
 * link unfurls beautifully in WhatsApp / iMessage / Twitter while still
 * working as a normal clickable URL.
 *
 * Token format: base64url-encoded JSON with single-char keys to keep
 * the URL tight. State letters in the grid string match the colours
 * we render in the PNG.
 *
 *   g — game id (pros|holes|clubs|connections)
 *   d — day number (1-indexed)
 *   s — score string ("3/6" for a win, "X/6" for a loss, "0" / "X" for
 *       Connections where score = mistakes used)
 *   r — grid as rows joined by "|", each row a string of single
 *       chars representing cell state for that game.
 *
 * Grid state characters:
 *   Pros / Holes / Clubhouses: G=green, W=warm, Y=yellow, K=grey
 *   Connections:               Y=yellow, G=green, B=blue, P=purple
 *
 * Tokens are intentionally NOT a security boundary — anyone can forge
 * one. The only consequence of forgery is rendering a fake share card,
 * which is harmless: the URL still drives traffic to pardle.app.
 */

export type ShareGameId =
  | "pros"
  | "holes"
  | "clubs"
  | "connections"
  | "faces";

export interface ShareCardPayload {
  g: ShareGameId;
  d: number;
  s: string;
  r: string;
}

const STATE_PROS = { green: "G", warm: "W", yellow: "Y", grey: "K" } as const;
const STATE_CONN = { yellow: "Y", green: "G", blue: "B", purple: "P" } as const;

type CellStatePros = keyof typeof STATE_PROS;
type CellStateConn = keyof typeof STATE_CONN;

export function encodeGridPros(rows: CellStatePros[][]): string {
  return rows.map((row) => row.map((c) => STATE_PROS[c]).join("")).join("|");
}

export function encodeGridConnections(rows: CellStateConn[][]): string {
  return rows.map((row) => row.map((c) => STATE_CONN[c]).join("")).join("|");
}

/**
 * Faces grid: 6 rows of 2 cells. Each cell is "G" (pro named) or "K"
 * (missed). The order in each row matches puzzle.left then puzzle.right.
 */
export function encodeGridFaces(rows: ("G" | "K")[][]): string {
  return rows.map((row) => row.join("")).join("|");
}

function toBase64Url(str: string): string {
  // Browser + Edge support btoa; on Node we still have global Buffer
  // for unit tests, but stick to btoa for symmetry with the runtime.
  const b64 = typeof btoa === "function" ? btoa(str) : "";
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(token: string): string {
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return typeof atob === "function" ? atob(padded) : "";
}

export function encodeShareCard(payload: ShareCardPayload): string {
  return toBase64Url(JSON.stringify(payload));
}

export function decodeShareCard(token: string): ShareCardPayload | null {
  try {
    const json = fromBase64Url(token);
    if (!json) return null;
    const parsed = JSON.parse(json) as ShareCardPayload;
    if (
      typeof parsed.g !== "string" ||
      typeof parsed.d !== "number" ||
      typeof parsed.s !== "string" ||
      typeof parsed.r !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Friendly game-name display for use in the share card and landing page. */
export function shareGameTitle(g: ShareGameId): string {
  switch (g) {
    case "pros":
      return "Pros";
    case "holes":
      return "Holes";
    case "clubs":
      return "Clubhouses";
    case "connections":
      return "Connections";
    case "faces":
      return "Faces";
  }
}

/** Game accent colour, kept in sync with hub tile colours / OG cards. */
export function shareGameAccent(g: ShareGameId): string {
  switch (g) {
    case "pros":
      return "#7BAE3F";
    case "holes":
      return "#5BA0E0";
    case "clubs":
      return "#E0A85B";
    case "connections":
      return "#B388D6";
    case "faces":
      return "#E07B5B";
  }
}

/** Pick the rendered colour for a single grid-state letter. */
export function cellColorFor(state: string, game: ShareGameId): string {
  if (game === "connections") {
    if (state === "Y") return "#f9df6d";
    if (state === "G") return "#a0c35a";
    if (state === "B") return "#b0c4ef";
    if (state === "P") return "#ba81c5";
    return "#5C6063";
  }
  // Pros / Holes / Clubhouses use the green-warm-yellow-grey scale
  if (state === "G") return "#7BAE3F";
  if (state === "W") return "#B5D332";
  if (state === "Y") return "#E8C547";
  return "#5C6063";
}
