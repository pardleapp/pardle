import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand";
import { GOLFERS } from "@/lib/data/golfers";
import { morphedBlendUrl, PGA_TOUR_IDS } from "@/lib/data/pga-tour-ids";

// Public blend tool — a/b are PGA Tour player IDs. Renders a 1200x1200
// PNG with the two faces stacked at 1.0 and 0.5 opacity. Same recipe
// as the Faces game stage so a saved blend looks exactly like one in
// the daily puzzle. When someone tweets pardle.app/blend/a/b this is
// what unfurls in their post.

export const runtime = "edge";
// 1-week cache (604800s) — blends are deterministic from the IDs so we
// let Vercel + Cloudinary's CDN serve repeats. Next requires a literal
// here, not an expression, so no multiplication.
export const revalidate = 604800;
export const alt = "Pardle Blend";
export const size = { width: 1200, height: 1200 };
export const contentType = "image/png";

interface Params {
  params: Promise<{ a: string; b: string }>;
}

function nameForId(id: string): string | null {
  const slug = Object.entries(PGA_TOUR_IDS).find(([, v]) => v === id)?.[0];
  if (!slug) return null;
  return GOLFERS.find((g) => g.id === slug)?.name ?? null;
}

export default async function BlendOg({ params }: Params) {
  const { a, b } = await params;
  const nameA = nameForId(a);
  const nameB = nameForId(b);
  // The pre-rendered morph lives at /blends/{a}_{b}.jpg in our public
  // dir. Reference via the absolute URL so the edge-rendered OG image
  // can fetch it.
  const morphSrc = `${BRAND.url}${morphedBlendUrl(a, b)}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(135deg, #0F1F0F 0%, #1F3A1A 50%, #2c5a28 100%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          color: "white",
          padding: 60,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 14,
            fontSize: 30,
            fontWeight: 700,
            opacity: 0.72,
            letterSpacing: "1.5px",
            marginBottom: 24,
          }}
        >
          <span>PARDLE</span>
          <span>·</span>
          <span>BLEND</span>
        </div>

        {/* The blend is a pre-rendered Delaunay-morph JPEG generated
            offline. Just hot-link it; the same file the /blend tool
            page shows. */}
        <div
          style={{
            display: "flex",
            width: 900,
            height: 900,
            borderRadius: 24,
            overflow: "hidden",
            background: "#0f1f0f",
            boxShadow: "0 16px 60px rgba(0, 0, 0, 0.45)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={morphSrc}
            alt=""
            width={900}
            height={900}
            style={{
              width: 900,
              height: 900,
              objectFit: "cover",
            }}
          />
        </div>

        {nameA && nameB && (
          <div
            style={{
              display: "flex",
              gap: 18,
              fontSize: 38,
              fontWeight: 700,
              marginTop: 28,
              color: "rgba(255, 255, 255, 0.85)",
            }}
          >
            <span>{nameA}</span>
            <span style={{ color: "#E07B5B" }}>×</span>
            <span>{nameB}</span>
          </div>
        )}

        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontWeight: 800,
            color: "#FFD64A",
            marginTop: nameA && nameB ? 18 : 32,
            letterSpacing: "0.5px",
          }}
        >
          pardle.app/blend
        </div>
      </div>
    ),
    { ...size },
  );
}
