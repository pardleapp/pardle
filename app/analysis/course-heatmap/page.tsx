import { parseTour } from "../_lib/tour";
import CourseHeatmapView from "./CourseHeatmapView";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <CourseHeatmapView tour={parseTour((await searchParams).tour)} />;
}
