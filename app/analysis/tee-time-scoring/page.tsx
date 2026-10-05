import { parseTour } from "../_lib/tour";
import TeeTimeScoringView from "./TeeTimeScoringView";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <TeeTimeScoringView tour={parseTour((await searchParams).tour)} />;
}
