import { Suspense } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import AuthForm from "./AuthForm";

export const metadata = {
  title: `Sign in — ${BRAND.name} Fantasy`,
};

export default function FantasyAuthPage() {
  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/fantasy" aria-label="Back to fantasy">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Fantasy · sign in</p>
      </header>

      <Suspense fallback={<div className="fantasy-hero-sub">Loading…</div>}>
        <AuthForm />
      </Suspense>
    </main>
  );
}
