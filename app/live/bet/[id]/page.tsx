import Link from "next/link";
import { BRAND } from "@/lib/brand";
import BetDetail from "./BetDetail";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function BetDetailPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <main className="container container-wide">
      <header className="brand">
        <Link className="brand-back" href="/" aria-label="Back to live feed">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Live · my bet</p>
      </header>

      <BetDetail betId={id} />
    </main>
  );
}
