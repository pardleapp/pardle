"use client";

/**
 * Thin client wrapper around <GroupChat> for the full-screen chat
 * surface. Exists so the page.tsx (server component) stays purely
 * server-side while still rendering the stateful chat body.
 */

import GroupChat from "@/app/groups/GroupChat";
import type { GroupMessageRow } from "@/lib/groups/server";

interface Props {
  groupId: string;
  currentUserId: string;
  initialMessages: GroupMessageRow[];
}

export default function FullScreenChat({
  groupId,
  currentUserId,
  initialMessages,
}: Props) {
  return (
    <GroupChat
      groupId={groupId}
      currentUserId={currentUserId}
      initialMessages={initialMessages}
    />
  );
}
