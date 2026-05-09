import "./globals.css";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description: "Six guesses to identify today's mystery pro golfer.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#7BAE3F",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
