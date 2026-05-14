"use client";

import { useState } from "react";

interface Props {
  inviteCode: string;
  inviteUrl: string;
  leagueName: string;
}

export default function InviteShareBox({
  inviteCode,
  inviteUrl,
  leagueName,
}: Props) {
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  async function copy(value: string, which: "link" | "code") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  }

  async function share() {
    const nav = navigator as Navigator & {
      share?: (d: ShareData) => Promise<void>;
    };
    const text = `Join my fantasy golf league "${leagueName}" on Pardle. Tap to enter:`;
    if (nav.share) {
      try {
        await nav.share({ text, url: inviteUrl });
        return;
      } catch {
        /* user cancelled or unsupported */
      }
    }
    copy(`${text} ${inviteUrl}`, "link");
  }

  return (
    <div className="fantasy-invite-box">
      <div className="fantasy-invite-row">
        <span className="fantasy-invite-label">Invite link</span>
        <code className="fantasy-invite-value">{inviteUrl}</code>
        <button
          type="button"
          onClick={() => copy(inviteUrl, "link")}
          className="fantasy-invite-copy"
        >
          {copied === "link" ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="fantasy-invite-row">
        <span className="fantasy-invite-label">Code</span>
        <code className="fantasy-invite-value fantasy-invite-code">
          {inviteCode}
        </code>
        <button
          type="button"
          onClick={() => copy(inviteCode, "code")}
          className="fantasy-invite-copy"
        >
          {copied === "code" ? "Copied!" : "Copy"}
        </button>
      </div>
      <button type="button" onClick={share} className="fantasy-cta-primary" style={{ marginTop: 8 }}>
        Share to a friend
      </button>
    </div>
  );
}
