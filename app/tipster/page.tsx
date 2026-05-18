import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import TipsterHubClient from "./TipsterHubClient";

export const metadata: Metadata = {
  title: `Tipsters — ${BRAND.name}`,
  description: "Follow tipsters, see their tips, chat with their followers.",
};

export const dynamic = "force-dynamic";

export default function TipsterHub() {
  return (
    <main className="container">
      <header className="brand brand-split">
        <h1>Tipsters</h1>
        <Link href="/" className="hub-nav-tab">
          ← Live feed
        </Link>
      </header>
      <TipsterHubClient />
    </main>
  );
}
