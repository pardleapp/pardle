import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import HistoryClient from "./HistoryClient";

export const metadata: Metadata = {
  title: `Your bet history — ${BRAND.name}`,
  description: "Every bet you've placed, settled outcomes, and running P&L.",
};

export const dynamic = "force-dynamic";

export default function HistoryPage() {
  return (
    <main className="container v4-theme">
      <header className="brand brand-split">
        <h1>Your bet history</h1>
        <Link href="/" className="hub-nav-tab">
          ← Live feed
        </Link>
      </header>
      <HistoryClient />
    </main>
  );
}
