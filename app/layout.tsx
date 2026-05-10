import "./globals.css";
import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

const description =
  "Six guesses to identify today's mystery pro golfer. New puzzle every day.";

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.url),
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description,
  applicationName: BRAND.name,
  openGraph: {
    title: BRAND.name,
    description,
    url: BRAND.url,
    siteName: BRAND.name,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: BRAND.name,
    description,
  },
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
