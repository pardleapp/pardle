"use client";

/**
 * HoldReactPicker — quick-tap like + press-and-hold reaction tray
 * (iMessage / Real / Slack style). Wraps the existing thumb-up
 * react button: a fast click/tap fires the default 👍 like; a hold
 * for ~300 ms pops a floating emoji tray anchored above the press
 * point. Picking an emoji triggers the parent's float-up burst
 * animation.
 *
 * Gestures:
 *   - onPointerDown → start a 300 ms timer
 *   - onPointerUp before timer fires → quick tap → onTap()
 *   - timer fires → tray opens; onTap is suppressed
 *   - pointer moves more than 8 px → cancel the timer (drag, not press)
 *   - tap outside the tray scrim → close without picking
 *
 * Replaces the old sticky bottom feed-burst-bar — gives every card
 * its own reactions and frees the screen.
 */

import { useEffect, useRef, useState } from "react";

const REACT_EMOJIS = ["🔥", "😱", "⛳", "👏", "💀", "🐐"];
const HOLD_THRESHOLD_MS = 300;
const DRAG_CANCEL_PX = 8;
const HINT_STORAGE_KEY = "pardle_react_hint_dismissed_v1";

interface Props {
  /** Quick-tap action — default 👍 like. Called when the user
   *  releases before the hold threshold. */
  onTap: () => void;
  /** Hold-and-pick action — the picked emoji is passed through.
   *  The parent triggers the float-up burst animation. */
  onReact: (emoji: string) => void;
  /** Like count to show inside the button. */
  count: number;
  /** Highlighted state (user has already liked). */
  active: boolean;
  /** Aria label for the button. */
  ariaLabel?: string;
}

export default function HoldReactPicker({
  onTap,
  onReact,
  count,
  active,
  ariaLabel = "React",
}: Props) {
  const [trayOpen, setTrayOpen] = useState(false);
  const [trayPos, setTrayPos] = useState<{ left: number; top: number } | null>(
    null,
  );
  const [showHint, setShowHint] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdFiredRef = useRef(false);
  const downPosRef = useRef<{ x: number; y: number } | null>(null);

  // First-use hint — show the "hold to react" tooltip once per
  // device. Dismissed by either successfully holding (any time) or
  // by tapping anywhere (auto-dismiss on first interaction).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = window.localStorage.getItem(HINT_STORAGE_KEY);
    if (!dismissed) setShowHint(true);
  }, []);

  const dismissHint = () => {
    if (showHint) {
      setShowHint(false);
      try {
        window.localStorage.setItem(HINT_STORAGE_KEY, "1");
      } catch {
        // ignore
      }
    }
  };

  const cancelTimer = () => {
    if (holdTimerRef.current != null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const openTrayFor = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    // Anchor tray centred above the button. The CSS uses
    // translate-x to centre + cap to viewport so we just need the
    // raw centre coord.
    setTrayPos({
      left: rect.left + rect.width / 2,
      top: rect.top,
    });
    setTrayOpen(true);
    dismissHint();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    holdFiredRef.current = false;
    downPosRef.current = { x: e.clientX, y: e.clientY };
    const target = e.currentTarget;
    holdTimerRef.current = window.setTimeout(() => {
      holdFiredRef.current = true;
      holdTimerRef.current = null;
      openTrayFor(target);
    }, HOLD_THRESHOLD_MS);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!downPosRef.current) return;
    const dx = e.clientX - downPosRef.current.x;
    const dy = e.clientY - downPosRef.current.y;
    if (Math.hypot(dx, dy) > DRAG_CANCEL_PX) {
      cancelTimer();
      downPosRef.current = null;
    }
  };

  const onPointerUp = () => {
    const wasHeld = holdFiredRef.current;
    cancelTimer();
    downPosRef.current = null;
    if (!wasHeld) {
      // Quick tap — default like.
      onTap();
      dismissHint();
    }
  };

  const onPointerCancel = () => {
    cancelTimer();
    downPosRef.current = null;
  };

  // Suppress browser long-press / context menu on the button so
  // the OS doesn't compete with our gesture.
  const onContextMenu = (e: React.MouseEvent) => e.preventDefault();

  const onPickEmoji = (emoji: string) => {
    setTrayOpen(false);
    onReact(emoji);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`spost-act${active ? " spost-act-on" : ""} hrp-button`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={onContextMenu}
        aria-label={ariaLabel}
        style={{
          touchAction: "manipulation",
          userSelect: "none",
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="15"
          height="15"
        >
          <path d="M7 10v11" />
          <path d="M7 10l4-7a2 2 0 0 1 3 1.7V9h4.5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17 20H7" />
        </svg>
        <span>{count}</span>
        {showHint && (
          <span
            className="hrp-hint"
            aria-hidden="true"
            onPointerDown={(e) => e.stopPropagation()}
          >
            Hold to react
          </span>
        )}
      </button>
      {trayOpen && trayPos && (
        <>
          <div
            className="hrp-scrim"
            onPointerDown={() => setTrayOpen(false)}
            onClick={() => setTrayOpen(false)}
            aria-hidden="true"
          />
          <div
            className="hrp-tray"
            role="menu"
            aria-label="React"
            style={{
              left: trayPos.left,
              top: trayPos.top,
            }}
          >
            {REACT_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                role="menuitem"
                className="hrp-tray-emoji"
                onClick={() => onPickEmoji(e)}
                aria-label={`React ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
