import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import CreateTipsterForm from "./CreateTipsterForm";

export const metadata: Metadata = {
  title: `Create a tipster page — ${BRAND.name}`,
  description:
    "Pick a handle, write a one-line bio, and start posting tips to your followers.",
};

export const dynamic = "force-dynamic";

export default function NewTipsterPage() {
  return (
    <main className="container">
      <header className="brand brand-split">
        <h1>Become a tipster</h1>
        <Link href="/" className="hub-nav-tab">
          ← back
        </Link>
      </header>
      <section className="tipster-create">
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
