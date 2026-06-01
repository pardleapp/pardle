"use client";

/**
 * NotificationsClient — full-screen Notifications surface. Matches
 * the design-handoff prototype's <Notifications>.
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
 *   🎉  Your Smalley Top 5 cashed · +£40     2m
 *   📈  @golf-edge posted a new tip          8m
 *   …
 *
 * The Enable button is wired to the real push subscription flow via
 * useNotifications.enable() — registers /sw.js, asks for permission,
 * creates a PushSubscription, POSTs it to /api/push/subscribe.
 *
 * iOS Safari (not installed as a PWA) doesn't support web push, so
 * we never let the user tap Enable from a normal tab — we surface
 * an Add-to-Home-Screen prompt instead (same gate the existing
 * IosInstallHint uses). Once they install + reopen Pardle from the
 * home-screen icon, the surface flips back to the regular Enable
 * card.
 *
 * The list of notifications below is still stubbed from NOTIFS for
 * now — real push fanout + cursor-paged history wires in a follow-up.
 *
 * Copy guardrails — no third-party data source names, no latency /
 * refresh figures.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MOCK_NOTIFS, type NotifRow } from "./mock-notifications";
import { useNotifications } from "../live/notifications/useNotifications";
import { getFollows } from "../live/FollowButton";

/** iOS Safari detection — must be iOS, must NOT be in an in-app
 *  browser, must NOT already be installed as a PWA. Identical
 *  semantics to IosInstallHint.tsx; duplicated here to keep the
 *  notifications surface self-contained. */
function isIosSafariNeedsInstall(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua);
  if (!isIos) return false;
  if (/CriOS|FxiOS|EdgiOS|FBAN|FBAV|Instagram|Line\//.test(ua)) return false;
  type NavigatorWithStandalone = Navigator & { standalone?: boolean };
  if ((window.navigator as NavigatorWithStandalone).standalone) return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return false;
  return true;
}

export default function NotificationsClient() {
  const router = useRouter();
  const { state, enable, disable } = useNotifications();
  const [rows, setRows] = useState<NotifRow[]>(MOCK_NOTIFS);
  const [iosInstall, setIosInstall] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Apply pv-theme-body on mount so the brand bar / nav re-skin paper.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.add("pv-theme-body");
    return () => {
      document.documentElement.classList.remove("pv-theme-body");
    };
  }, []);

  // iOS Safari detection — done client-side after mount so we don't
  // SSR a wrong branch.
  useEffect(() => {
    setIosInstall(isIosSafariNeedsInstall());
  }, []);

  const onEnable = async () => {
    setErrorMsg(null);
    // Pass the caller's current follows so the cron knows who to
    // address them about right after they subscribe.
    const ok = await enable({ follows: getFollows() });
    if (!ok) {
      // enable() returns false on every failure path. Inspect the
      // post-call state to give a useful message.
      if (state.permission === "denied") {
        setErrorMsg(
          "Notifications are blocked for this site. Enable them in your browser settings to receive alerts.",
        );
      } else {
        setErrorMsg(
          "Couldn't turn on alerts — try again, or check your browser's notification settings.",
        );
      }
    }
  };

  const onDisable = async () => {
    setErrorMsg(null);
    await disable();
  };

  const onRowClick = (row: NotifRow, idx: number) => {
    if (row.unread) {
      setRows((arr) =>
        arr.map((r, i) => (i === idx ? { ...r, unread: false } : r)),
      );
    }
    if (row.href) router.push(row.href);
  };

  // What permission card to show.
  // Priority: iOS-needs-install > unsupported > subscribed >
  // denied > default (Enable).
  const subscribed = state.subscribed && state.permission === "granted";
  const card = (() => {
    if (iosInstall) {
      return (
        <div className="np-card">
          <div className="np-ic" aria-hidden="true">
            🔔
          </div>
          <div className="np-bd">
            <div className="np-h">Add Pardle to your home screen first</div>
            <div className="np-s">
              On iPhone, alerts only work when Pardle is launched from
              your home screen. Tap the Share icon{" "}
              <span aria-hidden="true">⎙</span> in Safari, then{" "}
              <strong>Add to Home Screen</strong>. Reopen Pardle and
              you&apos;ll see Enable here.
            </div>
          </div>
        </div>
      );
    }
    if (!state.supported) {
      return (
        <div className="np-card np-card-unsupported">
          <div className="np-ic" aria-hidden="true">
            🔕
          </div>
          <div className="np-bd">
            <div className="np-h">Alerts aren&apos;t supported here</div>
            <div className="np-s">
              Your browser doesn&apos;t support push notifications.
              Try Chrome, Edge, Firefox, or Safari 16.4+ as an
              installed home-screen app.
            </div>
          </div>
        </div>
      );
    }
    if (subscribed) {
      return (
        <div className="np-on">
          🔔 Alerts on — bet swings, settles, tips &amp; group activity.
          <button
            type="button"
            onClick={onDisable}
            disabled={state.loading}
          >
            {state.loading ? "…" : "Manage"}
          </button>
        </div>
      );
    }
    if (state.permission === "denied") {
      return (
        <div className="np-card np-card-denied">
          <div className="np-ic" aria-hidden="true">
            🔕
          </div>
          <div className="np-bd">
            <div className="np-h">Notifications are blocked</div>
            <div className="np-s">
              You denied alerts for this site. Re-enable them in your
              browser&apos;s notification settings, then return here.
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="np-card">
        <div className="np-ic" aria-hidden="true">
          🔔
        </div>
        <div className="np-bd">
          <div className="np-h">Turn on alerts</div>
          <div className="np-s">
            Get pinged when your bets swing or settle, a tip drops, or
            your crew&apos;s on a heater.
          </div>
        </div>
        <button
          type="button"
          className="np-btn"
          onClick={onEnable}
          disabled={state.loading}
        >
          {state.loading ? "…" : "Enable"}
        </button>
      </div>
    );
  })();

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
        {card}
        {errorMsg && <div className="np-err">{errorMsg}</div>}

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
