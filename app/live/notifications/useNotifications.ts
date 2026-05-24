"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Browser push state + actions. The hook tracks whether the device
 * is capable of push, the current permission state, and whether
 * we've successfully subscribed this device to Pardle's push
 * endpoint. enable() walks through SW registration → permission ask
 * → subscription → POST to /api/push/subscribe in one call.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export interface NotificationsState {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  loading: boolean;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function useNotifications() {
  const [state, setState] = useState<NotificationsState>({
    supported: false,
    permission: "unsupported",
    subscribed: false,
    loading: true,
  });

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return;
    const supported =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    if (!supported) {
      setState({
        supported: false,
        permission: "unsupported",
        subscribed: false,
        loading: false,
      });
      return;
    }
    let permission: NotificationPermission = Notification.permission;
    let subscribed = false;
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        subscribed = !!sub;
      }
    } catch {}
    setState({ supported, permission, subscribed, loading: false });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async (
    options?: { follows?: string[] },
  ): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    if (!VAPID_PUBLIC_KEY) {
      console.error("NEXT_PUBLIC_VAPID_PUBLIC_KEY missing");
      return false;
    }
    setState((s) => ({ ...s, loading: true }));
    try {
      // Register the worker (idempotent — returns existing registration
      // if already installed at /sw.js).
      const reg = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;

      // Ask for permission. If the user already denied, the browser
      // returns 'denied' silently without showing the prompt again.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState({
          supported: true,
          permission,
          subscribed: false,
          loading: false,
        });
        return false;
      }

      // Get or create the push subscription.
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      // Send it server-side. Includes the caller's current follows
      // list so the cron can address followed-player events right
      // away — no chicken-and-egg "subscribed but server doesn't
      // know who you follow yet" window.
      const subPayload: Record<string, unknown> = { ...sub.toJSON() };
      if (Array.isArray(options?.follows)) {
        subPayload.follows = options.follows;
      }
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subPayload),
      });
      if (!res.ok) {
        setState({
          supported: true,
          permission,
          subscribed: false,
          loading: false,
        });
        return false;
      }

      setState({
        supported: true,
        permission,
        subscribed: true,
        loading: false,
      });
      return true;
    } catch (err) {
      console.error("[useNotifications] enable failed", err);
      setState((s) => ({ ...s, loading: false }));
      return false;
    }
  }, []);

  /**
   * Sync the device's followed-players list to the server. Cheap to
   * call — no-op when push isn't enabled. Use from a `useEffect` that
   * watches the local follows state so a follow/unfollow propagates
   * to the cron within seconds.
   */
  const syncFollows = useCallback(async (follows: string[]): Promise<void> => {
    if (typeof window === "undefined") return;
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (!sub) return;
      await fetch("/api/push/follows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint, follows }),
      });
    } catch {
      // Sync is best-effort — the next subscribe call will rewrite the
      // list anyway, and the cron just won't address this device for
      // the latest follows until then.
    }
  }, []);

  const disable = useCallback(async (): Promise<void> => {
    if (typeof window === "undefined") return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState((s) => ({ ...s, subscribed: false, loading: false }));
    } catch (err) {
      console.error("[useNotifications] disable failed", err);
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  return { state, enable, disable, refresh, syncFollows };
}
