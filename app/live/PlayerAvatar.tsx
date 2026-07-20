"use client";

/**
 * Player avatar — actual PGA Tour Cloudinary headshot when one exists
 * for the playerId, falling back to a plain deterministic gradient
 * when the headshot 404s (legacy / DP World / amateur fields).
 *
 * Used inside the v4 theme as the "social-app" replacement for the
 * emoji prefix that the old feed rows used (🐦 / 💥 / 🎯). The score
 * chip carries the type signal; the avatar carries the person.
 *
 * Implementation: gradient as the backdrop; layer an <img> on top
 * via absolute positioning. If the image errors (404, no headshot
 * for this player), we just show the gradient — cleaner than the
 * previous initials fallback which flashed underneath during image
 * load on every avatar.
 */

import { useState } from "react";
import { pgaTourHeadshotUrlById } from "@/lib/data/pga-tour-ids";

interface Props {
  playerId: string;
  playerName: string;
  size?: "sm" | "md" | "lg";
  /** Hot/cold halo around the avatar — adds a subtle bloom ring. */
  state?: "hot" | "cold" | null;
}

const GRADIENTS: Array<[string, string]> = [
  ["#6b7df2", "#c659d8"], // indigo→magenta
  ["#f29a4f", "#d44a4a"], // amber→red
  ["#56b0e8", "#3a4f9b"], // sky→navy
  ["#5cd7c1", "#1f8b6e"], // mint→forest
  ["#e87f9e", "#a23676"], // pink→plum
  ["#a070ff", "#3b1f8a"], // purple→indigo
  ["#ffb35a", "#c4691a"], // gold→amber
  ["#85d4f7", "#1f6b9e"], // cyan→teal
  ["#ed7a99", "#7a274d"], // rose→burgundy
  ["#7be0ad", "#26795a"], // jade→pine
];

function gradientFor(playerId: string): [string, string] {
  let h = 0;
  for (let i = 0; i < playerId.length; i++) {
    h = (h * 31 + playerId.charCodeAt(i)) | 0;
  }
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}

const SIZE_PX: Record<NonNullable<Props["size"]>, number> = {
  sm: 28,
  md: 40,
  lg: 56,
};

/** Two-letter initials from a display name — "Rory McIlroy" → "RM",
 *  "Rasmus Neergaard-Petersen" → "RN". Used as the always-visible
 *  loading/fallback state on top of the gradient background so the
 *  avatar slot never shows a browser broken-image icon or spinner. */
function initialsOf(name: string): string {
  const cleaned = (name ?? "").trim();
  if (!cleaned) return "•";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${first}${last}`.toUpperCase() || "•";
}

export default function PlayerAvatar({
  playerId,
  playerName,
  size = "md",
  state = null,
}: Props) {
  const [from, to] = gradientFor(playerId);
  const dim = SIZE_PX[size];
  const fontSize = size === "sm" ? 11 : size === "lg" ? 18 : 14;
  const haloColor =
    state === "hot"
      ? "rgba(255, 157, 46, 0.55)"
      : state === "cold"
        ? "rgba(123, 178, 230, 0.55)"
        : null;
  const headshotUrl = pgaTourHeadshotUrlById(playerId, dim * 2);
  const [imgReady, setImgReady] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <span
      className={`avatar avatar-${size}${state ? ` avatar-${state}` : ""}`}
      style={{
        width: dim,
        height: dim,
        fontSize,
        fontWeight: 800,
        color: "white",
        letterSpacing: "0.5px",
        textShadow: "0 1px 2px rgba(0,0,0,0.25)",
        background: `linear-gradient(135deg, ${from}, ${to})`,
        boxShadow: haloColor ? `0 0 0 2px ${haloColor}` : undefined,
        position: "relative",
        overflow: "hidden",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      aria-hidden="true"
    >
      {/* Initials always paint — this is the loading/fallback state.
          When the headshot loads it fades over the top. No spinner,
          no broken-image icon; the slot always looks intentional. */}
      <span
        style={{
          position: "relative",
          zIndex: 0,
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        {initialsOf(playerName)}
      </span>
      {!imgFailed && (
        <img
          src={headshotUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setImgReady(true)}
          onError={() => setImgFailed(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: imgReady ? 1 : 0,
            transition: "opacity 180ms ease",
            zIndex: 1,
          }}
        />
      )}
    </span>
  );
}
