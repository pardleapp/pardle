/**
 * CoursePinPreview — mini H18 aerial with today's R1-R4 pin dots
 * overlaid. Used as the hero image on the /analysis landing card for
 * the Course & Pin Guide. Same Cloudinary raster the modal uses so
 * nothing needs to load client-side; the four pin coords are
 * hard-coded to H18's typical pin spots so the preview always shows
 * a coherent green even when the current week's sheet hasn't landed.
 */

const IMAGE_URL =
  "https://pga-tour-res.cloudinary.com/c_fill,b_rgb:ffffff,w_1200,f_auto,q_auto/tourcastPickle/holes_2026_r_525_883_overhead_green_18_land.png";

// Four canonical H18 pin positions from the birdie-history —
// visually clustered enough to read as "this hole gets 4 different
// pins across the week" even at thumbnail size.
const PINS: Array<{ x: number; y: number; colour: string; label: string }> = [
  { x: 0.497, y: 0.156, colour: "oklch(0.55 0.18 250)", label: "R1" },
  { x: 0.590, y: 0.415, colour: "oklch(0.60 0.18 65)", label: "R2" },
  { x: 0.408, y: 0.583, colour: "oklch(0.55 0.20 300)", label: "R3" },
  { x: 0.490, y: 0.720, colour: "oklch(0.55 0.20 25)", label: "R4" },
];

export default function CoursePinPreview() {
  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16/9",
        background: "oklch(0.94 0.008 95)",
        borderRadius: "10px 10px 0 0",
        overflow: "hidden",
        lineHeight: 0,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={IMAGE_URL}
        alt=""
        loading="lazy"
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          objectFit: "cover",
        }}
      />
      {PINS.map((p, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${p.x * 100}%`,
            top: `${p.y * 100}%`,
            width: 12,
            height: 12,
            marginLeft: -6,
            marginTop: -6,
            borderRadius: "50%",
            background: p.colour,
            border: "2px solid white",
            boxShadow: "0 1px 4px oklch(0 0 0 / 0.45)",
          }}
        />
      ))}
    </div>
  );
}
