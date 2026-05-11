/**
 * Server-side store for Trivia async-challenge payloads.
 *
 * When a player creates an async challenge, instead of packing the
 * full payload (10 answers + name + difficulty + day + score) into
 * a 100-char base64url URL, we store it in Upstash Redis under a
 * short 6-character id and the URL becomes pardle.app/trivia/c/{id}.
 *
 * Keys:
 *   triviaCh:{id} — JSON payload (StoredChallenge), 30-day TTL.
 *
 * The 30-day TTL is generous — most challenges get played within a
 * few hours, but keeping links live for a month lets stale links in
 * older WhatsApp scroll-back still work.
 */

import { Redis } from "@upstash/redis";
import type { TriviaChallengePayload } from "./trivia-challenge";

const redis = Redis.fromEnv();
const CHALLENGE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const ID_LENGTH = 6;
// 32-char alphabet, no confusable 0/O/1/I/L. 32^6 ≈ 1.07B combinations
// — well past the birthday-collision risk for our daily volume.
const ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function key(id: string): string {
  return `triviaCh:${id}`;
}

function newId(): string {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return id;
}

export async function saveChallenge(
  payload: TriviaChallengePayload,
): Promise<string> {
  // Try a handful of times in the very unlikely case of a collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newId();
    // SETNX semantics via the `nx` option — only writes if the key
    // doesn't already exist, so collisions return false and we retry.
    const result = await redis.set(key(id), payload, {
      nx: true,
      ex: CHALLENGE_TTL_SECONDS,
    });
    if (result === "OK") return id;
  }
  throw new Error("Failed to allocate a unique trivia challenge id");
}

export async function loadChallenge(
  id: string,
): Promise<TriviaChallengePayload | null> {
  if (!id || id.length < 4 || id.length > 12) return null;
  const stored = await redis.get(key(id));
  return (stored as TriviaChallengePayload | null) ?? null;
}
