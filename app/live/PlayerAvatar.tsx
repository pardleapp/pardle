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

export default function PlayerAvatar({
  playerId,
  playerName,
  size = "md",
  state = null,
}: Props) {
  const [from, to] = gradientFor(playerId);
  const dim = SIZE_PX[size];
  const fontSize = size === "sm" ? 11 : size === "lg" ? 18 : 14;
  // Halo color picked to match the v4 hot/cold tokens.
  const haloColor =
    state === "hot"
      ? "rgba(255, 157, 46, 0.55)"
      : state === "cold"
        ? "rgba(123, 178, 230, 0.55)"
        : null;
  // Headshot — sized 2× the avatar dim for retina sharpness. Falls
  // through to initials when the image fails to load.
  const headshotUrl = pgaTourHeadshotUrlById(playerId, dim * 2);
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <span
      className={`avatar avatar-${size}${state ? ` avatar-${state}` : ""}`}
      style={{
        width: dim,
        height: dim,
        fontSize,
        background: `linear-gradient(135deg, ${from}, ${to})`,
        boxShadow: haloColor ? `0 0 0 2px ${haloColor}` : undefined,
        position: "relative",
        overflow: "hidden",
      }}
      aria-hidden="true"
    >
      {!imgFailed && (
        <img
          src={headshotUrl}
          alt=""
          onError={() => setImgFailed(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}
    </span>
  );
}
