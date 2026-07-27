/**
 * GET /api/course-history/forecast?course=<name>
 *
 * Per-player forecast of expected SG:OTT residual (vs each player's
 * own baseline) at the target course, driven by a weighted least-
 * squares fit of course-history outperformance onto radar shape
 * (ballSpeed, apexHeight, curve).
 *
 * Response includes:
 *   fit.n            — training rows (players × rounds threshold)
 *   fit.r2Train      — in-sample weighted R²
 *   fit.r2Cv         — 5-fold cross-validated R² (the honest metric)
 *   fit.reliable     — CV R² clears the trust floor
 *   fit.betas        — intercept + per-dim coefficients
 *   players[]        — every profiled player with predicted residual
 *                       per round, sorted descending
 *
 * Cold-path cost is dominated by the tour-stats warmup + course-
 * history fetch — both cached elsewhere. Subsequent hits <200 ms.
 */

import { NextResponse } from "next/server";
import { getCourseForecast } from "@/lib/course-history/forecast";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const course = url.searchParams.get("course");
  if (!course) {
    return NextResponse.json(
      { ok: false, error: "missing course query param" },
      { status: 400 },
    );
  }
  try {
    const data = await getCourseForecast(course);
    if (!data) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "not enough training data (course history + tee-shot profiles) to fit a forecast",
        },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "failed to compute course forecast",
      },
      { status: 500 },
    );
  }
}
