import { parseTour } from "../_lib/tour";
import HoleScoringView from "./HoleScoringView";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <HoleScoringView tour={parseTour((await searchParams).tour)} />;
}
