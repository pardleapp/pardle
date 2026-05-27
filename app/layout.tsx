import "./globals.css";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Inter } from "next/font/google";
import { BRAND } from "@/lib/brand";
import SiteFooter from "./SiteFooter";

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
  "Track your golf bets live, see the fair value move with every shot, and watch the tournament alongside other bettors.";
const ogTitle = `${BRAND.name} — Live bet tracker + tournament feed`;

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.url),
  title: ogTitle,
  description,
  applicationName: BRAND.name,
  openGraph: {
    title: ogTitle,
    description,
    url: BRAND.url,
    siteName: BRAND.name,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: ogTitle,
    description,
  },
  // PWA meta — iOS Safari respects these for "Add to Home Screen":
  // app launches standalone (no browser chrome) with a dark status
  // bar that matches our v4 background. Manifest itself is served
  // by app/manifest.ts.
  appleWebApp: {
    capable: true,
    title: BRAND.name,
    statusBarStyle: "black-translucent",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0d12",
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
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  );
}
