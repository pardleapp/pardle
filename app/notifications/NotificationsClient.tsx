"use client";

/**
 * NotificationsClient — full-screen Notifications surface. Matches
 * the design-handoff prototype's <Notifications>:
 *
 *   ← Notifications
 *     The Lads · Charles Schwab Challenge
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ 🔔  Turn on alerts                           │
 *   │     Get pinged when your bets swing or       │
 *   │     settle, a tip drops, or your crew's on   │
 *   │     a heater.                       [Enable] │
 *   └──────────────────────────────────────────────┘
 *
 *   🚀  Your Henley outright jumped to 60%   now
 *       Birdie on 18 — he grabs the lead
 *   🎉  Your Smalley Top 5 cashed · +£40     2m
 *       Settled — booked to your day
 *   📈  @golf-edge posted a new tip          8m
 *       L. Åberg — Outright @ 12/1
 *   …
 *
 * Tapping the permission card's Enable button flips it to the
 * compact "Alerts on · Manage" confirmation. Rows route through
 * the relevant surface (bet detail, settle modal, player page,
 * group). Tap the back arrow to return.
 *
 * Copy guardrails — no third-party data source names, no latency
 * / refresh figures. "@golf-edge" is a Pardle channel, not a
 * partner reference.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MOCK_NOTIFS, type NotifRow } from "./mock-notifications";

export default function NotificationsClient() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState<NotifRow[]>(MOCK_NOTIFS);

  // Apply pv-theme-body on mount so the brand bar + nav re-skin
  // paper-light (same hook used on /, /bets, /groups, etc.).
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.add("pv-theme-body");
    return () => {
      document.documentElement.classList.remove("pv-theme-body");
    };
  }, []);

  const onRowClick = (row: NotifRow, idx: number) => {
    // Mark this row as read locally.
    if (row.unread) {
      setRows((arr) => arr.map((r, i) => (i === idx ? { ...r, unread: false } : r)));
    }
    if (row.href) router.push(row.href);
  };

  return (
    <div className="notif-pv">
      <header className="notif-pv-head">
        <Link href="/" className="bd-pv-back" aria-label="Back">
          ←
        </Link>
        <div className="bd-pv-title">
          <div className="bd-pv-title-nm">Notifications</div>
          <div className="bd-pv-title-mk">
            The Lads · Charles Schwab Challenge
          </div>
        </div>
      </header>

      <div className="notif-pv-body">
        {!enabled ? (
          <div className="np-card">
            <div className="np-ic" aria-hidden="true">
              🔔
            </div>
            <div className="np-bd">
              <div className="np-h">Turn on alerts</div>
              <div className="np-s">
                Get pinged when your bets swing or settle, a tip
                drops, or your crew&apos;s on a heater.
              </div>
            </div>
            <button
              type="button"
              className="np-btn"
              onClick={() => setEnabled(true)}
            >
              Enable
            </button>
          </div>
        ) : (
          <div className="np-on">
            🔔 Alerts on — bet swings, settles, tips &amp; group activity.
            <button type="button" onClick={() => setEnabled(false)}>
              Manage
            </button>
          </div>
        )}

        <ul className="nf-list">
          {rows.map((n, i) => (
            <li key={i}>
              <button
                type="button"
                className={`nf-row${n.unread ? " nf-row-unread" : ""}`}
                onClick={() => onRowClick(n, i)}
              >
                <span className={`nf-ic nf-ic-${n.tint}`} aria-hidden="true">
                  {n.icon}
                </span>
                <span className="nf-bd">
                  <span className="nf-t">{n.title}</span>
                  <span className="nf-s">{n.subtitle}</span>
                </span>
                <span className="nf-tm">{n.time}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
