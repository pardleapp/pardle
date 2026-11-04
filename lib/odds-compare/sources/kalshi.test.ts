import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { quotesFromMarkets } from "./kalshi";

const market = (title: string, yes: string, no: string) => ({
  ticker: "T",
  title,
  yes_ask_dollars: yes,
  no_ask_dollars: no,
});

describe("quotesFromMarkets", () => {
  it("reads yes as under and no as over", () => {
    const [q] = quotesFromMarkets(
      [market("Will Ryan Gerard shoot under 67.5 in Round 1?", "0.4600", "0.6400")],
      1,
      "now",
    );
    expect(q.playerName).toBe("Ryan Gerard");
    expect(q.line).toBe(67.5);
    expect(q.under).toBeCloseTo(1 / 0.46, 6);
    expect(q.over).toBeCloseTo(1 / 0.64, 6);
  });

  it("keeps accented names and skips other rounds", () => {
    const qs = quotesFromMarkets(
      [
        market("Will Ludvig Åberg shoot under 67.5 in Round 2?", "0.5", "0.5"),
        market("Will Ludvig Åberg shoot under 67.5 in Round 1?", "0.5", "0.5"),
      ],
      2,
      "now",
    );
    expect(qs).toHaveLength(1);
    expect(qs[0].playerName).toBe("Ludvig Åberg");
  });

  it("drops sides nobody is really offering", () => {
    const one = quotesFromMarkets(
      [market("Will Zachary Bauchou shoot under 68.5 in Round 1?", "0.4600", "1.0000")],
      1,
      "now",
    );
    expect(one[0].over).toBeNull();
    expect(one[0].under).not.toBeNull();
    expect(
      quotesFromMarkets(
        [market("Will Seamus Power shoot under 68.5 in Round 1?", "0.9500", "0.9600")],
        1,
        "now",
      ),
    ).toHaveLength(0);
  });
});
