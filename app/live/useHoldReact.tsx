"use client";

/**
 * useHoldReact — press-and-hold reaction gesture for any feed card.
 *
 * Returns a `surfaceProps` object you spread on the card's outer
 * element (article / Link / div) and a `tray` element you render
 * once next to it. The hook itself owns the tray state — no
 * boilerplate per card.
 *
 *   Quick tap (no hold)        → onTap?.() (optional)
 *   Hold ~300ms on card body   → emoji tray pops near press point
 *   Drag > 8 px before hold    → cancels (scroll doesn't trigger)
 *   Press on a <button>        → gesture skipped entirely; the
 *                                button handles its own click
 *   Press on a nested <a>      → hold still arms, but a quick
 *                                release lets the link's native
 *                                navigation through and SUPPRESSES
 *                                onTap (so we don't double-fire)
 *   Pick an emoji              → onReact(emoji), tray closes
 *   Tap outside the tray scrim → tray closes, no reaction
 *
 * iOS safeguards baked into surfaceProps.style:
 *   touch-action: manipulation     (no double-tap zoom delay)
 *   user-select: none              (no text caret on long-press)
 *   -webkit-touch-callout: none    (no Safari share/copy callout)
 *
 * Honours `prefers-reduced-motion` — the tray skips its scale-in
 * animation (CSS handles that).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as RPointerEvent,
  type MouseEvent as RMouseEvent,
} from "react";

const REACT_EMOJIS = ["🔥", "😱", "⛳", "👏", "💀", "🐐"];
const HOLD_THRESHOLD_MS = 300;
const DRAG_CANCEL_PX = 8;

const SURFACE_STYLE_BASE: CSSProperties = {
  touchAction: "manipulation",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
  transition:
    "transform 0.18s cubic-bezier(0.2, 0.7, 0.3, 1), box-shadow 0.18s ease",
};

/** Inline style applied to the surface during the lifted state.
 *  z-index pulls the card above the scrim; transform scale + soft
 *  lift shadow is the "card popping toward you" iMessage feel. */
const SURFACE_STYLE_HELD: CSSProperties = {
  transform: "scale(1.04)",
  boxShadow: "0 30px 60px oklch(0.2 0.04 150 / 0.28)",
  position: "relative",
  zIndex: 81,
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface Opts {
  /** Picked emoji from the tray. */
  onReact: (emoji: string) => void;
  /** Optional quick-tap callback. Fires only when the press started
   *  on the card body (not on a nested button or anchor) and the
   *  user released before the hold threshold. */
  onTap?: () => void;
}

interface SurfaceProps {
  onPointerDown: (e: RPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: RPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: RPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: RPointerEvent<HTMLElement>) => void;
  onContextMenu: (e: RMouseEvent<HTMLElement>) => void;
  style: CSSProperties;
}

export function useHoldReact({ onReact, onTap }: Opts): {
  surfaceProps: SurfaceProps;
  tray: React.ReactNode;
} {
  const [trayPos, setTrayPos] = useState<{ left: number; top: number } | null>(
    null,
  );
  const holdFiredRef = useRef(false);
  const downRef = useRef<{
    x: number;
    y: number;
    onButton: boolean;
    onLink: boolean;
  } | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Belt-and-braces — wipe any pending timer if the component
  // unmounts mid-press.
  useEffect(() => () => clearTimer(), [clearTimer]);

  const onPointerDown = useCallback(
    (e: RPointerEvent<HTMLElement>) => {
      const target = e.target as HTMLElement;
      const onButton = !!target.closest("button, [data-no-hold]");
      const onLink = !!target.closest("a");
      downRef.current = {
        x: e.clientX,
        y: e.clientY,
        onButton,
        onLink,
      };
      holdFiredRef.current = false;
      if (onButton) {
        // Buttons (thumb/comment/share) own their own taps.
        // Don't arm the hold timer — the button's onClick handles
        // it, and a long-press on a button shouldn't unexpectedly
        // pop the card-level tray.
        return;
      }
      timerRef.current = window.setTimeout(() => {
        holdFiredRef.current = true;
        timerRef.current = null;
        const d = downRef.current;
        if (!d) return;
        // Subtle haptic on hold-trigger — Android Chrome buzzes, iOS
        // Safari is a no-op (vibrate API isn't exposed in-tab).
        try {
          navigator.vibrate?.(10);
        } catch {
          // ignore — some browsers reject vibrate inside a passive
          // listener; the visual feedback is the primary signal.
        }
        setTrayPos({ left: d.x, top: d.y });
      }, HOLD_THRESHOLD_MS);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: RPointerEvent<HTMLElement>) => {
      if (!downRef.current || timerRef.current == null) return;
      const dx = e.clientX - downRef.current.x;
      const dy = e.clientY - downRef.current.y;
      if (Math.hypot(dx, dy) > DRAG_CANCEL_PX) {
        clearTimer();
      }
    },
    [clearTimer],
  );

  const onPointerUp = useCallback(
    (e: RPointerEvent<HTMLElement>) => {
      clearTimer();
      const d = downRef.current;
      const wasHeld = holdFiredRef.current;
      downRef.current = null;
      if (wasHeld) {
        // Tray's open — suppress the click that would have
        // otherwise navigated / opened the card.
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!d) return;
      // Quick tap. Fire onTap only when the press started on the
      // pure card body — if it started on a nested link, let the
      // anchor's native navigation handle it (don't double-fire).
      if (!d.onButton && !d.onLink && onTap) {
        onTap();
      }
    },
    [clearTimer, onTap],
  );

  const onPointerCancel = useCallback(() => {
    clearTimer();
    downRef.current = null;
  }, [clearTimer]);

  const onContextMenu = useCallback((e: RMouseEvent<HTMLElement>) => {
    // Block iOS callout / right-click menu so the OS doesn't fight
    // our gesture.
    e.preventDefault();
  }, []);

  // Block the synthetic click that follows pointerup when a hold
  // fired — React's onPointerUp.preventDefault doesn't always
  // suppress it. A capture-phase click handler does the job.
  useEffect(() => {
    if (trayPos == null) return;
    const suppress = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    document.addEventListener("click", suppress, true);
    const t = window.setTimeout(() => {
      document.removeEventListener("click", suppress, true);
    }, 320);
    return () => {
      document.removeEventListener("click", suppress, true);
      clearTimeout(t);
    };
  }, [trayPos]);

  const onPick = useCallback(
    (emoji: string) => {
      setTrayPos(null);
      onReact(emoji);
    },
    [onReact],
  );

  const close = useCallback(() => setTrayPos(null), []);

  const isHeld = trayPos != null;
  const reducedMotion = prefersReducedMotion();

  const tray = isHeld ? (
    <>
      <div
        className={`hrp-scrim${reducedMotion ? "" : " hrp-scrim-active"}`}
        onPointerDown={close}
        onClick={close}
        aria-hidden="true"
      />
      <div
        className="hrp-tray"
        role="menu"
        aria-label="React"
        style={{ left: trayPos!.left, top: trayPos!.top }}
      >
        {REACT_EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            role="menuitem"
            className="hrp-tray-emoji"
            onClick={() => onPick(e)}
            aria-label={`React ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
    </>
  ) : null;

  // Composite the always-on style with the held-state lift. When
  // reduced-motion is on, skip the transform entirely — only the
  // z-index nudge stays so the card still floats above the scrim
  // visually without movement.
  const style: CSSProperties = isHeld
    ? reducedMotion
      ? { ...SURFACE_STYLE_BASE, position: "relative", zIndex: 81 }
      : { ...SURFACE_STYLE_BASE, ...SURFACE_STYLE_HELD }
    : SURFACE_STYLE_BASE;

  return {
    surfaceProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onContextMenu,
      style,
    },
    tray,
  };
}
