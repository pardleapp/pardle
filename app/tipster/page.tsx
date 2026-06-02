import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import AuthChip from "../live/auth/AuthChip";
import MainNav from "../MainNav";
import TipsterHubClient from "./TipsterHubClient";

export const metadata: Metadata = {
  title: `Tipsters — ${BRAND.name}`,
  description: "Follow tipsters, see their tips, chat with their followers.",
};

export const dynamic = "force-dynamic";

export default function TipsterHub() {
  return (
    <main className="container container-wide v4-theme pv-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="none" />
          <AuthChip />
        </div>
      </header>
      <TipsterHubClient />
    </main>
  );
}
