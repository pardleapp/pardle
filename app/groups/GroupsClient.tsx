"use client";

/**
 * GroupsClient — /groups surface for a single active group. Reads
 * the group + members from real Supabase tables (the page server-
 * fetches them and passes both as props).
 *
 * Sections top → bottom:
 *   1. Group header card — name, real member count, P&L race
 *      button, invite link (pardle.app/c/{code}) with Copy → ✓.
 *   2. Standings · today — derived from real members' tracked
 *      bets. Empty until step 3 wires the aggregation; for now
 *      shows an "Invite your crew to start the race" placeholder
 *      whenever there are fewer than 2 members (or no bets).
 *   3. Most backed in your group — same: empty placeholder until
 *      step 3 reads real member bets.
 *   4. Members — real group_members rows, joined with profile
 *      display names. New members without a profile show as
 *      "Member" with UUID-derived initials.
 *   5. Footer — Mute notifications + Leave group (Leave wires in
 *      step 3; placeholder buttons for now).
 *
 * The mock data in mock-groups.ts is intentionally not imported
 * here anymore — a freshly-created group must never inject fake
 * members. Mock content lives only in the optional seed file
 * (supabase/seed/seed_the_lads.sql) for the dev-test path.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import MemberProfile from "./MemberProfile";
import RaceSheet from "./RaceSheet";
import GroupChat from "./GroupChat";
import type {
  GroupMemberRow,
  GroupMessageRow,
  GroupStandingsRow,
  MostBackedRow,
} from "@/lib/groups/server";
import { formatBetCurrency, normaliseBetCurrency } from "@/lib/format/bet-currency";

export interface ActiveGroup {
  id: string;
  name: string;
  invite_code: string;
  member_count: number;
  role: "admin" | "member";
}

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

interface GroupsClientProps {
  group: ActiveGroup;
  members: GroupMemberRow[];
  standings: GroupStandingsRow[];
  mostBacked: MostBackedRow[];
  initialMessages: GroupMessageRow[];
  currentUserId: string;
}

function fmtSignedCurrency(n: number, currency: string): string {
  const cur = normaliseBetCurrency(currency);
  if (Math.abs(n) < 0.5) return formatBetCurrency(0, cur, { maximumFractionDigits: 0 });
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${formatBetCurrency(Math.abs(n), cur, {
    maximumFractionDigits: 0,
  })}`;
}

export default function GroupsClient({
  group,
  members,
  standings,
  mostBacked,
  initialMessages,
  currentUserId,
}: GroupsClientProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [memOpen, setMemOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState<string | null>(null);
  const [raceOpen, setRaceOpen] = useState(false);

  const inviteLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/c/${group.invite_code}`
      : `/c/${group.invite_code}`;

  const copy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(inviteLink).catch(() => {});
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

  // Race "lights up" once there are at least 2 members AND at least
  // one settled bet across the group — otherwise the standings card
  // shows the invite-your-crew empty state. Live unrealised movement
  // on open bets is a follow-up (would need the /api/feed odds
  // pipeline plumbed server-side).
  const hasSettledActivity = standings.some(
    (s) => s.settled_count > 0 || Math.abs(s.net_pnl) > 0.5,
  );
  const raceReady = group.member_count >= 2 && hasSettledActivity;
  const mostBackedReady = mostBacked.length > 0;

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
              <div className="grp-card-name">{group.name}</div>
              <div className="grp-card-sub">
                {group.member_count}{" "}
                {group.member_count === 1 ? "member" : "members"} · private
                group
              </div>
            </div>
            <button
              type="button"
              className="grp-race-btn"
              onClick={() => setRaceOpen(true)}
              disabled={!raceReady}
              aria-disabled={!raceReady}
            >
              P&amp;L race
            </button>
          </div>
          <div className="invite-row">
            <div>
              <div className="il-l">Invite link</div>
              <div className="il-v">{inviteLink}</div>
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

        {/* Standings · this tournament — real per-member P&L when
            settled bets exist; invite-the-crew placeholder
            otherwise. P&L is settled outcomes only at v1; live
            unrealised movement on open bets is a follow-up. */}
        <section>
          <div className="grp-slabel">Standings · this tournament</div>
          {raceReady ? (
            <div className="grp-card grp-list">
              {standings.map((r, i) => (
                <button
                  key={r.user_id}
                  type="button"
                  className={`racerow${r.is_me ? " racerow-you" : ""}`}
                  onClick={() =>
                    r.is_me ? null : setMemberOpen(r.user_id)
                  }
                  disabled={r.is_me}
                >
                  <span className="racerow-rk">{i + 1}</span>
                  <Av initials={r.initials} size={32} />
                  <span className="racerow-nm">
                    {r.is_me ? <b>{r.display_name}</b> : r.display_name}
                    {i === 0 && r.net_pnl > 0 && " 👑"}
                  </span>
                  <span className={`racerow-pl ${r.dir}`}>
                    {fmtSignedCurrency(r.net_pnl, r.currency)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="grp-card grp-empty">
              <div className="grp-empty-emoji" aria-hidden="true">
                🏁
              </div>
              <div className="grp-empty-title">
                {group.member_count === 1
                  ? "Invite your crew to start the race"
                  : "Race lights up when bets start settling"}
              </div>
              <div className="grp-empty-blurb">
                The P&amp;L race ranks members by settled wins &amp;
                losses. Track a bet (or share the invite link) to
                get the race moving.
              </div>
            </div>
          )}
        </section>

        {/* Most backed in your group — real aggregation of open
            non-private bets across the group, sorted by backer
            count. Cold-start empty state when there's nothing. */}
        <section>
          <div className="grp-slabel">Most backed in your group</div>
          {mostBackedReady ? (
            <div className="grp-card grp-most">
              {mostBacked.slice(0, 4).map((b) => (
                <button
                  key={`${b.player_id}-${b.market_label}`}
                  type="button"
                  className="pop-row"
                  onClick={() =>
                    router.push(
                      `/live/player/${encodeURIComponent(b.player_name)}`,
                    )
                  }
                >
                  <div className="pop-nm">
                    {b.player_name}
                    <span className="bp-bet-mkt">{b.market_label}</span>
                  </div>
                  <span className="pop-back">
                    <span className="pop-back-row">
                      {b.backers.slice(0, 4).map((bk) => (
                        <Av
                          key={bk.user_id}
                          initials={bk.initials}
                          size={24}
                        />
                      ))}
                    </span>
                    <span className="pop-ct">{b.count} on it</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="grp-card grp-empty grp-empty-tight">
              <div className="grp-empty-blurb">
                Nobody&rsquo;s tracked a bet in this group yet. Open
                the Bets tab and log one to be the first.
              </div>
            </div>
          )}
        </section>

        {/* Members — real group_members rows. */}
        <section>
          <button
            type="button"
            className="mem-toggle"
            aria-expanded={memOpen}
            onClick={() => setMemOpen((v) => !v)}
          >
            <span>Members · {group.member_count}</span>
            <span className={`mem-chv${memOpen ? " mem-chv-open" : ""}`}>
              ▾
            </span>
          </button>
          {memOpen && (
            <div className="grp-card grp-mem-list">
              {members.length === 0 ? (
                <div className="grp-empty-blurb">No members yet.</div>
              ) : (
                members.map((m) => (
                  <button
                    key={m.user_id}
                    type="button"
                    className="mem-row"
                    onClick={() =>
                      m.is_me ? null : setMemberOpen(m.user_id)
                    }
                    disabled={m.is_me}
                  >
                    <Av initials={m.initials} size={32} />
                    <div className="mem-row-bd">
                      <div className="mem-row-nm">
                        {m.is_me ? <b>{m.display_name}</b> : m.display_name}
                        {m.role === "admin" && (
                          <span className="role-tag">admin</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </section>

        {/* Chat — realtime group chat. Subscribes to Supabase
            Realtime on group_messages filtered by group_id. */}
        <section>
          <div className="grp-slabel">Chat</div>
          <div className="grp-card grp-chat-card">
            <GroupChat
              groupId={group.id}
              currentUserId={currentUserId}
              initialMessages={initialMessages}
            />
          </div>
        </section>

        {/* Footer actions — wired to real Supabase in a follow-up. */}
        <div className="grp-footer">
          <button type="button" className="grp-mute">
            Mute notifications
          </button>
          <button type="button" className="grp-leave">
            Leave group
          </button>
        </div>
      </div>

      {memberOpen && (() => {
        const m =
          members.find((x) => x.user_id === memberOpen) ??
          standings.find((s) => s.user_id === memberOpen);
        if (!m) return null;
        return (
          <MemberProfile
            groupId={group.id}
            memberUserId={memberOpen}
            displayName={m.display_name}
            initials={m.initials}
            standings={standings.find((s) => s.user_id === memberOpen)}
            onClose={() => setMemberOpen(null)}
            onOpenPlayer={openPlayer}
          />
        );
      })()}
      {raceOpen && raceReady && (
        <RaceSheet onClose={() => setRaceOpen(false)} />
      )}
    </section>
  );
}
