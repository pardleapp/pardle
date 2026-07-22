"use client";

/**
 * ConfirmDialog — small centred modal for destructive confirmations
 * (delete-bet, remove-member, etc.). Matches the Pardle Social v2
 * "paper" theme: warm-paper card, mono details, tang-red destructive
 * button, muted cancel. Closes on Escape / scrim click / cancel.
 *
 * Usage:
 *   {confirming && (
 *     <ConfirmDialog
 *       title="Delete this tracked bet?"
 *       detail="R. Henley — OUTRIGHT WIN"
 *       confirmLabel="Delete"
 *       destructive
 *       onConfirm={() => { doDelete(); setConfirming(false); }}
 *       onCancel={() => setConfirming(false)}
 *     />
 *   )}
 */

import { useEffect, useRef } from "react";

interface Props {
  title: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  detail,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", onKey);
    // Lock body scroll while open — mirrors the pin-sheet modal
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus the confirm button so keyboard users can Enter / Escape
    // straight away.
    confirmBtnRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onCancel, onConfirm]);

  return (
    <div
      className="pv-confirm-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pv-confirm-title"
      onClick={onCancel}
    >
      <div
        className="pv-confirm-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="pv-confirm-title" className="pv-confirm-title">
          {title}
        </h2>
        {detail && <div className="pv-confirm-detail">{detail}</div>}
        <div className="pv-confirm-btns">
          <button
            type="button"
            className="pv-confirm-cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`pv-confirm-confirm${destructive ? " destructive" : ""}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
