import "./globals.css";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Inter } from "next/font/google";
import { BRAND } from "@/lib/brand";

// Inter variable: covers all weights we use (400/600/700/800/900) in
// one woff2 file. Display-swap so the page paints with the system
// fallback first and swaps once the font's loaded — keeps LCP fast.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700", "800", "900"],
});

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
    <html lang="en" className={inter.variable}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
