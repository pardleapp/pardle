"use client";

/**
 * Thin client wrapper around <GroupChat> for the full-screen
 * chat surface. Also runs a one-shot overflow probe in the
 * browser after mount that logs every element wider than the
 * viewport to the console — temporary diagnostic for the
 * "horizontal scrollbar in chat" bug. Logs once on mount and
 * once 1.5s later (to catch elements that hydrate / mount
 * asynchronously). If nothing overflows, the warn group is
 * silent.
 *
 * Safe to leave in production for now; cheap, console-only,
 * runs on a route only members hit. Remove once the bug is
 * decisively closed.
 */

import { useEffect } from "react";
import GroupChat from "@/app/groups/GroupChat";
import type { GroupMessageRow } from "@/lib/groups/server";

interface Props {
  groupId: string;
  currentUserId: string;
  initialMessages: GroupMessageRow[];
}

function probeOverflow(label: string) {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  const vw = root.clientWidth;
  const bodyW = document.body.scrollWidth;
  const docW = root.scrollWidth;
  const offenders: HTMLElement[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("*")) {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1) offenders.push(el);
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[chat-fs probe ${label}]`,
    `viewport=${vw}`,
    `body.scrollWidth=${bodyW}`,
    `doc.scrollWidth=${docW}`,
    `offenders=${offenders.length}`,
  );
  for (const el of offenders.slice(0, 10)) {
    const r = el.getBoundingClientRect();
    // eslint-disable-next-line no-console
    console.warn(
      `  ${el.tagName.toLowerCase()}.${el.className || "(no class)"} ` +
        `right=${Math.round(r.right)} width=${Math.round(r.width)}`,
      el,
    );
  }
}

export default function FullScreenChat({
  groupId,
  currentUserId,
  initialMessages,
}: Props) {
  useEffect(() => {
    probeOverflow("mount");
    const t = window.setTimeout(() => probeOverflow("1.5s"), 1500);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <GroupChat
      groupId={groupId}
      currentUserId={currentUserId}
      initialMessages={initialMessages}
    />
  );
}
