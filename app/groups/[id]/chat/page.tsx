/**
 * /groups/[id]/chat — dedicated full-screen chat view for one
 * private group. Reuses <GroupChat> inside a fixed-position
 * .chat-fs container that fills the viewport (100dvh — shrinks
 * with the iOS keyboard so the composer stays visible).
 *
 * Server-renders the auth gate + the group name + the initial
 * message list so the user sees content on first paint (no
 * client-side loading state for the bulk of the surface).
 * Realtime subscription takes over once the client mounts.
 *
 * Access control: redirects to /groups (which has its own
 * sign-in gate / empty state) if the user isn't signed in or
 * isn't a member of this group. The Supabase admin reads in the
 * page helpers still verify membership before reading rows, so
 * a redirect failure can't leak data.
 */

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import BackButton from "@/app/_components/BackButton";
import { BRAND } from "@/lib/brand";
import { getSupabaseServer, getSupabaseAdmin } from "@/lib/supabase/server";
import { listGroupMessages } from "@/lib/groups/server";
import FullScreenChat from "./FullScreenChat";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Group chat — ${BRAND.name}`,
};

export default async function GroupChatPage({ params }: PageProps) {
  const { id: groupId } = await params;
  const supabase = await getSupabaseServer();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    // Route back through /groups which shows the sign-in prompt.
    redirect(`/groups`);
  }
  const userId = userData.user.id;

  const admin = getSupabaseAdmin();
  const { data: memRow } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!memRow) {
    // Not a member → 404 (don't reveal whether the group exists).
    notFound();
  }

  const { data: groupRow } = await admin
    .from("groups")
    .select("id, name")
    .eq("id", groupId)
    .maybeSingle();
  const group = groupRow as { id: string; name: string } | null;
  if (!group) notFound();

  const { count: memberCount } = await admin
    .from("group_members")
    .select("user_id", { count: "exact", head: true })
    .eq("group_id", groupId);

  const initialMessages = await listGroupMessages(groupId, 200);

  return (
    <main className="pv-theme chat-fs" role="main" aria-label={`${group.name} chat`}>
      <header className="chat-fs-head">
        <BackButton
          fallback="/groups"
          className="chat-fs-back"
          ariaLabel="Back to Groups"
        />
        <div className="chat-fs-title">
          <div className="chat-fs-name">{group.name}</div>
          <div className="chat-fs-sub">
            {memberCount ?? 1}{" "}
            {(memberCount ?? 1) === 1 ? "member" : "members"}
          </div>
        </div>
      </header>
      <div className="chat-fs-body">
        <FullScreenChat
          groupId={group.id}
          currentUserId={userId}
          initialMessages={initialMessages}
        />
      </div>
    </main>
  );
}
