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
import { useAuth } from "../live/auth/useAuth";
import SignInModal from "../live/auth/SignInModal";

interface PwaDetect {
  isIos: boolean;
  isInAppBrowser: boolean;
  /** iOS Safari's navigator.standalone — the canonical "launched
   *  from home screen as a PWA" flag on iOS. */
  iosStandaloneFlag: boolean;
  /** Cross-platform display-mode media query — covers Android
   *  Chrome PWAs + desktop installs. iOS Safari also reports this
   *  in modern versions but the navigator.standalone flag is the
   *  reliable one. */
  displayModeStandalone: boolean;
  /** Some installs report fullscreen or minimal-ui instead of
   *  standalone. Treat any of the three as "installed". */
  displayModeAny: boolean;
  /** Compound — true when we should show the "add to home screen"
   *  card, false when we should let the user tap Enable. */
  needsInstall: boolean;
}

function detectPwa(): PwaDetect {
  if (typeof window === "undefined") {
    return {
      isIos: false,
      isInAppBrowser: false,
      iosStandaloneFlag: false,
      displayModeStandalone: false,
      displayModeAny: false,
      needsInstall: false,
    };
  }
  const ua = window.navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua);
  const isInAppBrowser = /CriOS|FxiOS|EdgiOS|FBAN|FBAV|Instagram|Line\//.test(
    ua,
  );
  type NavigatorWithStandalone = Navigator & { standalone?: boolean };
  const iosStandaloneFlag =
    (window.navigator as NavigatorWithStandalone).standalone === true;
  const displayModeStandalone = window.matchMedia(
    "(display-mode: standalone)",
  ).matches;
  const displayModeAny =
    displayModeStandalone ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches;
  // Only treat as "needs install" when we're confidently on iOS
  // Safari (not an in-app browser) AND no installed-mode signal
  // is present at all.
  const needsInstall =
    isIos &&
    !isInAppBrowser &&
    !iosStandaloneFlag &&
    !displayModeAny;
  return {
    isIos,
    isInAppBrowser,
    iosStandaloneFlag,
    displayModeStandalone,
    displayModeAny,
    needsInstall,
  };
}

export default function NotificationsClient() {
  const router = useRouter();
  const { state, enable, disable } = useNotifications();
  const auth = useAuth();
  const [rows, setRows] = useState<NotifRow[]>(MOCK_NOTIFS);
  const [pwa, setPwa] = useState<PwaDetect | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [debugPwa, setDebugPwa] = useState(false);

  // Apply pv-theme-body on mount so the brand bar / nav re-skin paper.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.add("pv-theme-body");
    return () => {
      document.documentElement.classList.remove("pv-theme-body");
    };
  }, []);

  // PWA / standalone detection — done client-side after mount so we
  // don't SSR a wrong branch. ?debug-pwa=1 surfaces the raw values
  // for diagnosing "but I added it to my home screen!" reports.
  useEffect(() => {
    setPwa(detectPwa());
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("debug-pwa") === "1") setDebugPwa(true);
    }
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
  // Priority: iOS-needs-install > unsupported > signed-out >
  // subscribed > denied > default (Enable). The signed-out gate
  // sits ABOVE the regular Enable card because /api/push/subscribe
  // requires Supabase auth — if we let an anon user tap Enable
  // the OS prompt would appear, the browser would subscribe
  // locally, but the server POST would 401 silently and the card
  // would never flip to "Alerts on". Cleaner to gate first.
  const subscribed = state.subscribed && state.permission === "granted";
  const card = (() => {
    if (pwa?.needsInstall) {
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
              <strong>Add to Home Screen</strong>. Reopen Pardle from
              the new icon and you&apos;ll see Enable here.
            </div>
            <div className="np-s np-s-quiet">
              Already added it? If tapping the icon opens Safari (not a
              standalone Pardle window), the old shortcut was cached
              before push was set up — remove it from your home screen
              and add it again from this current page.
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
    // Signed-out gate — show before Enable so the user can't fall
    // through into a silent 401 on the subscribe POST.
    if (!auth.loading && !auth.user) {
      return (
        <div className="np-card">
          <div className="np-ic" aria-hidden="true">
            🔔
          </div>
          <div className="np-bd">
            <div className="np-h">Sign in to enable alerts</div>
            <div className="np-s">
              Notifications follow you across devices, so we need a
              way to remember you. Sign in with email — takes 10
              seconds.
            </div>
          </div>
          <button
            type="button"
            className="np-btn"
            onClick={() => setSignInOpen(true)}
          >
            Sign in
          </button>
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
        {debugPwa && pwa && (
          <pre className="np-debug">
            {JSON.stringify(
              {
                ua:
                  typeof window !== "undefined"
                    ? window.navigator.userAgent
                    : "—",
                ...pwa,
                pushState: state,
                authUser: auth.user ? auth.user.email ?? auth.user.id : null,
              },
              null,
              2,
            )}
          </pre>
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
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  );
}
