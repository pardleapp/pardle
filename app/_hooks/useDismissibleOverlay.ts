"use client";

/**
 * useDismissibleOverlay — make a React-state overlay respond to
 * the browser/OS back button.
 *
 * Without this hook, an overlay opened via React state (e.g.
 * `setMemberOpen(uid)`) has no history entry, so the OS back
 * button navigates the underlying route instead of dismissing
 * the overlay — which is what produces the "back jumps to
 * landing page" symptom users report.
 *
 * Usage in any overlay component:
 *
 *   useDismissibleOverlay(isOpen, onClose);
 *
 * Mechanics:
 *  - When `open` flips true, the hook pushes a history entry
 *    marked { overlay: true }. The page URL doesn't change.
 *  - On `popstate` (OS back / browser back / gesture), the hook
 *    calls `onClose()`. The overlay closes; the user stays on
 *    the underlying page.
 *  - When the overlay closes via its X button (`open` flips
 *    false without a popstate), the hook calls `history.back()`
 *    to pop the marker — keeps the history stack clean so a
 *    second back press goes one level further.
 *  - Tracks which path triggered via refs so we never
 *    double-push or double-pop.
 *
 * Safe to call unconditionally; no-ops while `open` is false.
 */

import { useEffect, useRef } from "react";

export function useDismissibleOverlay(
  open: boolean,
  onClose: () => void,
): void {
  // Captures the live onClose so the popstate listener (mounted
  // once per open lifecycle) always calls the latest callback —
  // important when the parent re-renders with a new closure.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // True while our marker is on the history stack.
  const pushedRef = useRef(false);
  // True while we're closing because of a popstate (so the
  // cleanup effect doesn't try to pop again — there's nothing
  // to pop).
  const closingViaPopRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (open && !pushedRef.current) {
      // Push a marker entry — the URL doesn't change (passing ""
      // tells the browser "keep current URL"). state.overlay
      // lets us identify our entry on popstate.
      window.history.pushState({ overlay: true }, "");
      pushedRef.current = true;
      closingViaPopRef.current = false;

      const onPop = () => {
        // The user hit OS back / browser back. Our marker entry
        // was popped — we're now back on the underlying page's
        // entry. Mark the path so cleanup doesn't try to pop
        // again, then trigger onClose.
        closingViaPopRef.current = true;
        pushedRef.current = false;
        onCloseRef.current();
      };
      window.addEventListener("popstate", onPop);
      return () => {
        window.removeEventListener("popstate", onPop);
      };
    }

    if (!open && pushedRef.current) {
      // The overlay closed without a popstate — i.e. via X
      // button / programmatic close. Pop our marker so the
      // history stack matches the visible state.
      pushedRef.current = false;
      if (!closingViaPopRef.current) {
        window.history.back();
      }
      closingViaPopRef.current = false;
    }
  }, [open]);
}
