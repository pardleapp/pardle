/**
 * /groups — private-group surface. Server-renders the branch
 * between three states based on auth + membership:
 *
 *   signed out                → <GroupsSignedOut /> (sign-in prompt)
 *   signed in, no groups      → <GroupsEmpty />     (create/join)
 *   signed in, ≥1 group       → <GroupsClient />    (real DB data)
 *
 * The two "soon" / empty states only need the SweatHeader chrome
 * + the centered card; the populated state renders the existing
 * GroupsClient component with real group data passed in as a prop.
 * Standings + most-backed + members lists still come from
 * mock-groups.ts until step 3 derives them from member bets.
 */

import { BRAND } from "@/lib/brand";
import { getSupabaseServer } from "@/lib/supabase/server";
import SweatHeader from "../live/SweatHeader";
import GroupsClient from "./GroupsClient";
import GroupsEmpty from "./GroupsEmpty";
import GroupsSignedOut from "./GroupsSignedOut";
import { listMyGroups } from "@/lib/groups/server";

export const metadata = {
  title: `Groups — ${BRAND.name}`,
  description: "Private bet-tracking groups with a shared P&L race.",
};

// Force dynamic so the auth/membership branch is always evaluated
// against the request's session — never statically cached.
export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const supabase = await getSupabaseServer();
  const { data: userData } = await supabase.auth.getUser();
  const signedIn = userData.user !== null;

  let body;
  if (!signedIn) {
    body = <GroupsSignedOut />;
  } else {
    const groups = await listMyGroups();
    if (groups.length === 0) {
      body = <GroupsEmpty />;
    } else {
      // First group is the "active" one for now — multi-group
      // navigation via the space-switcher lands in a follow-up.
      body = <GroupsClient group={groups[0]} />;
    }
  }

  return (
    <main className="container container-wide v4-theme pv-theme">
      <SweatHeader />
      {body}
    </main>
  );
}
