/**
 * /groups — private-group surface. Was a coming-soon placeholder
 * up to pass 8; now rebuilt to match the design-handoff prototype's
 * <Groups> / <MemberProfile> / <RaceSheet> components. Real Supabase
 * wiring (groups + group_members tables, derive P&L from each
 * member's tracked bets) lands in a follow-up; until then the page
 * shows the prototype's mock crew so the surface is exact.
 */

import { BRAND } from "@/lib/brand";
import SweatHeader from "../live/SweatHeader";
import GroupsClient from "./GroupsClient";

export const metadata = {
  title: `Groups — ${BRAND.name}`,
  description: "Private bet-tracking groups with a shared P&L race.",
};

export default function GroupsPage() {
  return (
    <main className="container container-wide v4-theme pv-theme">
      <SweatHeader />
      <GroupsClient />
    </main>
  );
}
