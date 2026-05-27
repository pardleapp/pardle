import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

/**
 * PWA web app manifest — picked up automatically by Next 15 from
 * app/manifest.ts and served at /manifest.webmanifest.
 *
 * Effect when a user does "Add to Home Screen" from iOS Safari /
 * Android Chrome: Pardle installs as a standalone app (no browser
 * chrome), launches into the live feed, uses our apple-icon as
 * the home-screen badge. On iOS this is also a prerequisite for
 * push notifications working reliably — Safari treats push from
 * "installed" PWAs differently to regular pages.
 *
 * theme_color drives the iOS status-bar tint and Android app
 * switcher card. Matches our v4 electric green so the install
 * feels like Pardle, not a generic web app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} — Live golf bet tracker`,
    short_name: BRAND.name,
    description:
      "Track your golf bets live and react with other bettors during PGA Tour events.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0d12",
    theme_color: "#00d96e",
    orientation: "portrait",
    categories: ["sports", "entertainment"],
    icons: [
      {
        src: "/icon",
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
      // Larger sizes generated on demand by the same ImageResponse
      // routes — Android/Chrome will request these for the install
      // banner and home-screen badge.
      {
        src: "/apple-icon",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
