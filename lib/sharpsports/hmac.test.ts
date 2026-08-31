import { describe, it, expect } from "vitest";
import {
  hmacSha256Hex,
  verifyDirectSignature,
  verifyTimestampedSignature,
} from "./hmac";

const SECRET = "test-secret-abc123";
const BODY = JSON.stringify({ betSlips: [{ id: "SLIP_x" }] });

describe("verifyDirectSignature", () => {
  it("accepts a valid signature", () => {
    const sig = hmacSha256Hex(SECRET, BODY);
    expect(verifyDirectSignature(SECRET, BODY, sig).ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = hmacSha256Hex(SECRET, BODY);
    const tampered = BODY.replace("SLIP_x", "SLIP_ATTACKER");
    const r = verifyDirectSignature(SECRET, tampered, sig);
    expect(r.ok).toBe(false);
  });

  it("rejects a missing header", () => {
    const r = verifyDirectSignature(SECRET, BODY, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-header");
  });

  it("rejects a signature with wrong length (leak-safe fast path)", () => {
    const r = verifyDirectSignature(SECRET, BODY, "abc");
    expect(r.ok).toBe(false);
  });
});

describe("verifyTimestampedSignature", () => {
  const now = 1_735_000_000; // fixed unix seconds for reproducibility

  it("accepts a fresh valid signature", () => {
    const sig = hmacSha256Hex(SECRET, `${now}.${BODY}`);
    const header = `t=${now},v1=${sig}`;
    expect(verifyTimestampedSignature(SECRET, BODY, header, { now }).ok).toBe(true);
  });

  it("rejects when timestamp is beyond tolerance window", () => {
    const sig = hmacSha256Hex(SECRET, `${now}.${BODY}`);
    const header = `t=${now},v1=${sig}`;
    const stale = verifyTimestampedSignature(SECRET, BODY, header, {
      now: now + 400, // > default 300s tolerance
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("stale-timestamp");
  });

  it("accepts either signature when multiple v1= are present (rotation)", () => {
    const good = hmacSha256Hex(SECRET, `${now}.${BODY}`);
    const junk = "0".repeat(good.length);
    const header = `t=${now},v1=${junk},v1=${good}`;
    expect(verifyTimestampedSignature(SECRET, BODY, header, { now }).ok).toBe(true);
  });

  it("rejects when signed payload was tampered", () => {
    const sig = hmacSha256Hex(SECRET, `${now}.${BODY}`);
    const header = `t=${now},v1=${sig}`;
    const tampered = BODY.replace("SLIP_x", "SLIP_ATTACKER");
    const r = verifyTimestampedSignature(SECRET, tampered, header, { now });
    expect(r.ok).toBe(false);
  });

  it("rejects a header missing t or v1", () => {
    const r1 = verifyTimestampedSignature(SECRET, BODY, "v1=abc", { now });
    expect(r1.ok).toBe(false);
    const r2 = verifyTimestampedSignature(SECRET, BODY, `t=${now}`, { now });
    expect(r2.ok).toBe(false);
  });
});
