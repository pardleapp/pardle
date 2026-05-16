/**
 * Odds parsing + formatting helpers shared by the live-feed UI and
 * the bet tracker. Users in the US naturally read American (+250 /
 * -150); UK + Ireland read fractional (5/2, 2/3); Europe + Australia
 * read decimal (3.50, 1.67). Pardle defaults to American because the
 * majority of golf-betting users are US-based, but the toggle in the
 * /live header lets each visitor lock in their own preference.
 */

export type OddsFormat = "american" | "fractional" | "decimal";

export const ODDS_FORMATS: OddsFormat[] = [
  "american",
  "fractional",
  "decimal",
];

export const DEFAULT_ODDS_FORMAT: OddsFormat = "american";
export const ODDS_FORMAT_STORAGE_KEY = "pardle_odds_format_v1";

const FORMAT_LABEL: Record<OddsFormat, string> = {
  american: "American",
  fractional: "Fractional",
  decimal: "Decimal",
};

export function nextOddsFormat(current: OddsFormat): OddsFormat {
  const idx = ODDS_FORMATS.indexOf(current);
  return ODDS_FORMATS[(idx + 1) % ODDS_FORMATS.length];
}

export function oddsFormatLabel(format: OddsFormat): string {
  return FORMAT_LABEL[format];
}

/** Decimal → "+250" / "-310" / "+100" (evens). */
function toAmerican(decimal: number): string {
  if (Math.abs(decimal - 2) < 0.01) return "+100";
  if (decimal >= 2) return `+${Math.round((decimal - 1) * 100)}`;
  return `-${Math.round(100 / (decimal - 1))}`;
}

/** Decimal → simplest fractional ("5/1", "9/2", "evens"). */
function toFractional(decimal: number): string {
  const v = decimal - 1;
  if (Math.abs(v - 1) < 0.05) return "evens";
  for (const den of [1, 2, 3, 4, 5, 6, 7, 8, 10]) {
    const num = v * den;
    if (Math.abs(num - Math.round(num)) < 0.07 && Math.round(num) > 0) {
      const n = Math.round(num);
      return den === 1 ? `${n}/1` : `${n}/${den}`;
    }
  }
  // Sub-evens (heavy favourites) — denominator search.
  if (v < 1) {
    for (const den of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20]) {
      const num = v * den;
      if (Math.abs(num - Math.round(num)) < 0.07 && Math.round(num) > 0) {
        return `${Math.round(num)}/${den}`;
      }
    }
  }
  return `${v.toFixed(2)}/1`;
}

/** Decimal → "2.50" / "1.91". */
function toDecimal(decimal: number): string {
  return decimal.toFixed(2);
}

export function formatOdds(decimal: number, format: OddsFormat): string {
  if (!Number.isFinite(decimal) || decimal <= 1) return "—";
  if (format === "decimal") return toDecimal(decimal);
  if (format === "fractional") return toFractional(decimal);
  return toAmerican(decimal);
}

/**
 * Parse any of the three formats into a decimal-odds value. Returns
 * null on garbage. The `label` is the canonical short form for the
 * INPUT'S original format — handy when storing a user-entered price
 * so we can echo it back in the format they typed.
 */
export function parseOdds(input: string): {
  decimal: number;
  format: OddsFormat;
} | null {
  const t = input.trim().toLowerCase();
  if (!t) return null;
  if (t === "evens" || t === "even" || t === "1/1") {
    return { decimal: 2, format: "fractional" };
  }
  // American: leading + or -, integer
  const am = /^([+-])\s*(\d+)$/.exec(t);
  if (am) {
    const sign = am[1];
    const v = Number(am[2]);
    if (v >= 100) {
      const decimal = sign === "+" ? 1 + v / 100 : 1 + 100 / v;
      return { decimal, format: "american" };
    }
  }
  // Fractional
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (num > 0 && den > 0) {
      return { decimal: 1 + num / den, format: "fractional" };
    }
  }
  // Decimal
  const decimal = Number(t);
  if (Number.isFinite(decimal) && decimal > 1) {
    return { decimal, format: "decimal" };
  }
  return null;
}
