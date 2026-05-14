import Link from "next/link";
import { BRAND } from "@/lib/brand";
import FeedClient from "./FeedClient";

export const metadata = {
  title: `Live shot feed — ${BRAND.name}`,
  description:
    "Every birdie, eagle and blow-up as it happens — react and chat with friends through the round.",
};

export default function LivePage() {
  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/" aria-label="All games">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Live · shot feed</p>
      </header>

      <FeedClient />
    </main>
  );
}
