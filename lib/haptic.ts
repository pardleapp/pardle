/**
 * Tiny haptic helpers for primary user actions (chat send, bet
 * submit, call vote). The Vibration API is widely supported on
 * Android Chrome / Samsung Internet and silently no-ops on iOS
 * Safari — we don't gate, just call.
 *
 * Respect user preference: when reduced-motion is on, skip the
 * vibration too. Some users tie that preference to "less
 * stimulation" generally, not just animations.
 *
 * Use sparingly — every-tap vibration is noisy and battery-bad.
 * Reserve for the moments where success/commit feels good (sent,
 * placed, voted), not for navigation or chip toggles.
 */

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function vibrate(ms: number) {
  if (typeof navigator === "undefined") return;
  if (prefersReducedMotion()) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Some browsers throw inside cross-origin iframes; ignore.
  }
}

/** Single quick tap — chat send, submit, primary commit actions. */
export function hapticTap(): void {
  vibrate(8);
}

/** Slightly longer for "success" moments — bet placed, sign-in
 *  succeeded. Still subtle. */
export function hapticSuccess(): void {
  vibrate(14);
}
