import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import AuthChip from "../../live/auth/AuthChip";
import MainNav from "../../MainNav";
import CreateTipsterForm from "./CreateTipsterForm";

export const metadata: Metadata = {
  title: `Create a tipster page — ${BRAND.name}`,
  description:
    "Pick a handle, write a one-line bio, and start posting tips to your followers.",
};

export const dynamic = "force-dynamic";

export default function NewTipsterPage() {
  return (
    <main className="container container-wide v4-theme pv-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="none" />
          <AuthChip />
        </div>
      </header>
      <section className="tipster-create">
        <h2 className="tipster-create-title">Become a tipster</h2>
        <p className="tipster-create-intro">
          Your page is where you post bets to your followers in real time.
          They get a push when you drop a tip, can one-click track it into
          their own bet tracker, and chat with you alongside the live feed.
        </p>
        <CreateTipsterForm />
      </section>
    </main>
  );
}
