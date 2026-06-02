/**
 * /course — live course map. Shows every active player as an avatar
 * pinned to the hole they're currently playing, refreshing every few
 * seconds. Sits beside Feed / Bets / Leaderboard / Games in the main
 * nav as the distinctive "see the tournament at a glance" surface.
 */

import { BRAND } from "@/lib/brand";
import AuthChip from "../live/auth/AuthChip";
import MainNav from "../MainNav";
import CourseMapClient from "./CourseMapClient";

export const metadata = {
  title: `Course map — ${BRAND.name}`,
  description:
    "Live view of every player on the course — where each one is, what hole they're on, how they're playing.",
};

export const dynamic = "force-dynamic";

export default function CoursePage() {
  return (
    <main className="container container-wide v4-theme pv-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="course" />
          <AuthChip />
        </div>
      </header>
      <CourseMapClient />
    </main>
  );
}
