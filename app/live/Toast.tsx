"use client";

/**
 * Lightweight v4-theme toast system. Replaces the browser-native
 * window.alert / window.confirm flows scattered across BetTracker,
 * BetDetail, and TipsterPageClient — those block the JS thread, look
 * unbranded on iOS, and break the dark-theme visual language.
 *
 * API:
 *   import { useToast } from "@/app/live/Toast";
 *   const toast = useToast();
 *   toast.success("Bet synced");
 *   toast.error("Couldn't follow — try again");
 *   const ok = await toast.confirm("Unfollow @rorymcilroy?", "Unfollow");
 *
 * Toasts auto-dismiss after 3.5s. Errors get a 6s window. Confirm
 * modals block until the user picks yes/no. Mounting the provider
 * once at the root layout is enough — everything else hooks in.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastKind = "success" | "error" | "info";

interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
  /** Set to a resolver when this toast is a confirm modal. */
  confirm?: {
    label: string;
    onConfirm: () => void;
    onCancel: () => void;
  };
}

interface ToastApi {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
  /** Resolves true if confirmed, false otherwise. */
  confirm: (message: string, confirmLabel?: string) => Promise<boolean>;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    // SSR/loose-import fallback — log so it doesn't silently swallow.
    return {
      success: (m) => console.warn("[toast:success]", m),
      error: (m) => console.warn("[toast:error]", m),
      info: (m) => console.warn("[toast:info]", m),
      confirm: async () => {
        console.warn("[toast:confirm] no provider mounted");
        return false;
      },
    };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string, ttl: number) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, kind, message }]);
      window.setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  const api: ToastApi = {
    success: (msg) => push("success", msg, 3500),
    error: (msg) => push("error", msg, 6000),
    info: (msg) => push("info", msg, 3500),
    confirm: (message, confirmLabel = "Confirm") =>
      new Promise<boolean>((resolve) => {
        const id = nextId.current++;
        setToasts((prev) => [
          ...prev,
          {
            id,
            kind: "info",
            message,
            confirm: {
              label: confirmLabel,
              onConfirm: () => {
                dismiss(id);
                resolve(true);
              },
              onCancel: () => {
                dismiss(id);
                resolve(false);
              },
            },
          },
        ]);
      }),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-stack" role="region" aria-live="polite">
          {toasts.map((t) => (
            <ToastView key={t.id} entry={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

function ToastView({
  entry,
  onDismiss,
}: {
  entry: ToastEntry;
  onDismiss: () => void;
}) {
  // Focus the confirm button when a confirm modal mounts so keyboard
  // users can press Enter without first tabbing to it.
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (entry.confirm) confirmBtnRef.current?.focus();
  }, [entry.confirm]);

  if (entry.confirm) {
    return (
      <div className="toast toast-confirm" role="alertdialog">
        <p className="toast-message">{entry.message}</p>
        <div className="toast-actions">
          <button
            type="button"
            className="toast-btn toast-btn-cancel"
            onClick={entry.confirm.onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            ref={confirmBtnRef}
            className="toast-btn toast-btn-confirm"
            onClick={entry.confirm.onConfirm}
          >
            {entry.confirm.label}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`toast toast-${entry.kind}`} role="status">
      <span className="toast-message">{entry.message}</span>
      <button
        type="button"
        className="toast-close"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
