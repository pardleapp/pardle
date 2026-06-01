"use client";

/**
 * GroupsClient — /groups surface, full rebuild matching the design-
 * handoff prototype's <Groups> + <MemberProfile> + <RaceSheet> +
 * <CreateGroup>. Mock data drives the first cut; real wiring lands
 * once the Supabase groups / group_members tables exist.
 *
 * Sections top → bottom:
 *   1. Group header card (name + member count + P&L race button +
 *      invite link with Copy → Copied ✓ flip).
 *   2. Standings · today — top 5 of today's P&L race, each row
 *      tappable into a member profile overlay.
 *   3. Most backed in your group — player + market chip + backer
 *      avatar stack + "N on it"; tap routes to /live/player/[name].
 *   4. Members · 9 — collapsible dropdown with the full member
 *      list (avatars + role tags + today P&L).
 *   5. Footer — Mute notifications + Leave group.
 *
 * Member profile + race sheet are full-screen overlays mounted at
 * the same layer; when the user opens a player from a member's bet
 * we close the member overlay first so the route change doesn't
 * leave it stranded (z-index gotcha called out in the brief).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  RACE,
  MEMBERS,
  MOST_POPULAR,
  GROUP_NAME,
  GROUP_INVITE,
  GROUP_MEMBER_COUNT,
} from "./mock-groups";
import MemberProfile from "./MemberProfile";
import RaceSheet from "./RaceSheet";

const PALETTE: Record<string, string> = {
  JO: "linear-gradient(135deg,#5cd7c1,#1f8b6e)",
  SA: "linear-gradient(135deg,#f29a4f,#d44a4a)",
  TH: "linear-gradient(135deg,#6b7df2,#c659d8)",
  MI: "linear-gradient(135deg,#ed7a99,#7a274d)",
  YO: "linear-gradient(135deg,#ffb35a,#c4691a)",
  PA: "linear-gradient(135deg,#a070ff,#3b1f8a)",
  DA: "linear-gradient(135deg,#85d4f7,#1f6b9e)",
  NI: "linear-gradient(135deg,#7be0ad,#26795a)",
  RO: "linear-gradient(135deg,#56b0e8,#3a4f9b)",
};
function bgFor(initials: string): string {
  return PALETTE[initials] ?? "linear-gradient(135deg,#6b7df2,#3b1f8a)";
}

function Av({
  initials,
  size = 32,
}: {
  initials: string;
  size?: number;
}) {
  return (
    <span
      className="crew-mini-av"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        background: bgFor(initials),
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

export default function GroupsClient() {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [memOpen, setMemOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState<string | null>(null);
  const [raceOpen, setRaceOpen] = useState(false);

  const copy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(GROUP_INVITE).catch(() => {});
    }
    setCopied(true);
  };

  /** z-index gotcha: when a player is tapped from inside the member
   *  profile, the overlay sits on top of any route push so the player
   *  page lands behind it. Drop the overlay first, then navigate. */
  const openPlayer = (name: string) => {
    setMemberOpen(null);
    router.push(`/live/player/${encodeURIComponent(name)}`);
  };

  return (
    <section className="groups-pv">
      <div className="groups-pv-stack">
        {/* Group header card */}
        <div className="grp-card">
          <div className="grp-card-head">
            <span className="grp-card-emoji" aria-hidden="true">
              🏌️
            </span>
            <div className="grp-card-title">
              <div className="grp-card-name">{GROUP_NAME}</div>
              <div className="grp-card-sub">
                {GROUP_MEMBER_COUNT} members · private group
              </div>
            </div>
            <button
              type="button"
              className="grp-race-btn"
              onClick={() => setRaceOpen(true)}
            >
              P&amp;L race
            </button>
          </div>
          <div className="invite-row">
            <div>
              <div className="il-l">Invite link</div>
              <div className="il-v">{GROUP_INVITE}</div>
            </div>
            <button
              type="button"
              className={`il-copy${copied ? " il-copy-done" : ""}`}
              onClick={copy}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>

        {/* Standings · today */}
        <section>
          <div className="grp-slabel">Standings · today</div>
          <div className="grp-card grp-list">
            {RACE.today.map((r, i) => (
              <button
                key={r.name}
                type="button"
                className={`racerow${r.name === "You" ? " racerow-you" : ""}`}
                onClick={() => setMemberOpen(r.name)}
              >
                <span className="racerow-rk">{i + 1}</span>
                <Av initials={r.initials} size={32} />
                <span className="racerow-nm">
                  {r.name === "You" ? <b>You</b> : r.name}
                  {i === 0 && " 👑"}
                </span>
                <span className={`racerow-pl ${r.dir}`}>{r.pl}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Most backed */}
        <section>
          <div className="grp-slabel">Most backed in your group</div>
          <div className="grp-card grp-most">
            {MOST_POPULAR.map((b) => (
              <button
                key={b.player}
                type="button"
                className="pop-row"
                onClick={() =>
                  router.push(`/live/player/${encodeURIComponent(b.player)}`)
                }
              >
                <div className="pop-nm">
                  {b.player}
                  <span className="bp-bet-mkt">{b.market}</span>
                </div>
                <span className="pop-back">
                  <span className="pop-back-row">
                    {b.backers.map((a) => (
                      <Av key={a} initials={a} size={24} />
                    ))}
                  </span>
                  <span className="pop-ct">{b.count} on it</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Members · 9 — collapsible */}
        <section>
          <button
            type="button"
            className="mem-toggle"
            aria-expanded={memOpen}
            onClick={() => setMemOpen((v) => !v)}
          >
            <span>Members · {GROUP_MEMBER_COUNT}</span>
            <span className={`mem-chv${memOpen ? " mem-chv-open" : ""}`}>
              ▾
            </span>
          </button>
          {memOpen && (
            <div className="grp-card grp-mem-list">
              {MEMBERS.map((m) => (
                <button
                  key={m.name}
                  type="button"
                  className="mem-row"
                  onClick={() => setMemberOpen(m.name)}
                >
                  <Av initials={m.initials} size={32} />
                  <div className="mem-row-bd">
                    <div className="mem-row-nm">
                      {m.name}
                      {m.role && <span className="role-tag">{m.role}</span>}
                    </div>
                  </div>
                  <span className={`mem-row-pl ${m.dir}`}>{m.pl}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Footer actions */}
        <div className="grp-footer">
          <button type="button" className="grp-mute">
            Mute notifications
          </button>
          <button type="button" className="grp-leave">
            Leave group
          </button>
        </div>
      </div>

      {memberOpen && (
        <MemberProfile
          name={memberOpen}
          onClose={() => setMemberOpen(null)}
          onOpenPlayer={openPlayer}
        />
      )}
      {raceOpen && <RaceSheet onClose={() => setRaceOpen(false)} />}
    </section>
  );
}
