export type ChallengeScore = number | "X";

export type ChallengeGame = "pros" | "holes" | "clubs" | "connections";

export interface ChallengePayload {
  dayNumber: number;
  score: ChallengeScore;
  challengerName?: string;
  /**
   * Game the challenge was issued from. Newer tokens always include
   * this so the /c/{token} landing page knows where to send the
   * recipient; older tokens (pre-personalised-preview) won't have it
   * and the in-game banner falls back to inferring it from the URL.
   */
  game?: ChallengeGame;
}

interface ChallengeWire {
  d: number;
  s: ChallengeScore;
  n?: string;
  g?: ChallengeGame;
}

const VALID_GAMES: ChallengeGame[] = ["pros", "holes", "clubs", "connections"];

export function encodeChallenge(p: ChallengePayload): string {
  const wire: ChallengeWire = { d: p.dayNumber, s: p.score };
  if (p.challengerName) {
    wire.n = p.challengerName.slice(0, 30);
  }
  if (p.game) {
    wire.g = p.game;
  }
  return base64UrlEncode(JSON.stringify(wire));
}

export function decodeChallenge(token: string): ChallengePayload | null {
  if (!token) return null;
  try {
    const data = JSON.parse(base64UrlDecode(token)) as Partial<ChallengeWire>;
    if (typeof data.d !== "number" || data.d < 1) return null;
    // Allow score 0–6: Connections wins land in 0–3 (mistakes used).
    if (data.s !== "X") {
      if (typeof data.s !== "number" || data.s < 0 || data.s > 6) return null;
    }
    const out: ChallengePayload = {
      dayNumber: data.d,
      score: data.s,
    };
    if (typeof data.n === "string" && data.n.length > 0) {
      out.challengerName = data.n.slice(0, 30);
    }
    if (
      typeof data.g === "string" &&
      (VALID_GAMES as readonly string[]).includes(data.g)
    ) {
      out.game = data.g as ChallengeGame;
    }
    return out;
  } catch {
    return null;
  }
}

function base64UrlEncode(s: string): string {
  const b64 =
    typeof window !== "undefined"
      ? window.btoa(unescape(encodeURIComponent(s)))
      : Buffer.from(s, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  const fullyPadded = remainder ? padded + "=".repeat(4 - remainder) : padded;
  if (typeof window !== "undefined") {
    return decodeURIComponent(escape(window.atob(fullyPadded)));
  }
  return Buffer.from(fullyPadded, "base64").toString("utf8");
}

const NAME_KEY = "pardle.challengerName";

export function loadChallengerName(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveChallengerName(name: string): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = name.trim().slice(0, 30);
    if (trimmed) {
      window.localStorage.setItem(NAME_KEY, trimmed);
    } else {
      window.localStorage.removeItem(NAME_KEY);
    }
  } catch {
    // ignore
  }
}
