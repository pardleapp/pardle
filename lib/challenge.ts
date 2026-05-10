export type ChallengeScore = number | "X";

export interface ChallengePayload {
  dayNumber: number;
  score: ChallengeScore;
  challengerName?: string;
}

interface ChallengeWire {
  d: number;
  s: ChallengeScore;
  n?: string;
}

export function encodeChallenge(p: ChallengePayload): string {
  const wire: ChallengeWire = { d: p.dayNumber, s: p.score };
  if (p.challengerName) {
    wire.n = p.challengerName.slice(0, 30);
  }
  return base64UrlEncode(JSON.stringify(wire));
}

export function decodeChallenge(token: string): ChallengePayload | null {
  if (!token) return null;
  try {
    const data = JSON.parse(base64UrlDecode(token)) as Partial<ChallengeWire>;
    if (typeof data.d !== "number" || data.d < 1) return null;
    if (data.s !== "X") {
      if (typeof data.s !== "number" || data.s < 1 || data.s > 6) return null;
    }
    const out: ChallengePayload = {
      dayNumber: data.d,
      score: data.s,
    };
    if (typeof data.n === "string" && data.n.length > 0) {
      out.challengerName = data.n.slice(0, 30);
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
