import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import AuthChip from "../live/auth/AuthChip";
import MainNav from "../MainNav";
import EventPickClient from "./EventPickClient";

export const metadata: Metadata = {
  title: `Pick the winner — ${BRAND.name}`,
  description:
    "Call this week's outright winner before the field tees off. Right or wrong, it counts toward your Sharp Score.",
};

export const dynamic = "force-dynamic";

export default function PicksPage() {
  return (
    <main className="container container-wide v4-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="none" />
          <AuthChip />
        </div>
      </header>
      <EventPickClient />
    </main>
  );
}
