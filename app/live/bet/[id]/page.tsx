import { BRAND } from "@/lib/brand";
import AuthChip from "../../auth/AuthChip";
import MainNav from "../../../MainNav";
import BetDetail from "./BetDetail";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function BetDetailPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <main className="container container-wide v4-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="bets" />
          <AuthChip />
        </div>
      </header>

      <BetDetail betId={id} />
    </main>
  );
}
