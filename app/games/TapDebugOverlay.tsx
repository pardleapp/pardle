"use client";

/**
 * Throwaway. Logs tap-related events while the user reproduces the
 * "first quick tap on /games misfires" bug on real iOS Safari.
 *
 * Captures pointerdown / touchstart / touchend / click / auxclick
 * with their target's tag+class, persists across navigations via
 * sessionStorage so the log survives if the tap actually navigates,
 * and renders a fixed top-right overlay so the user can read events
 * even without DevTools.
 *
 * Remove after the bug is diagnosed.
 */

import { useEffect, useState } from "react";

const KEY = "pardle_tap_debug_v1";
const MAX = 12;

interface Entry {
  t: number; // ms since page load
  ev: string;
  tag: string;
  cls: string;
  inLink: string | null; // closest <a> href, if any
}

function readStored(): Entry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Entry[];
  } catch {
    return [];
  }
}

function writeStored(rows: Entry[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(rows.slice(-MAX)));
  } catch {
    // quota / private-mode: ignore
  }
}

export default function TapDebugOverlay() {
  const [rows, setRows] = useState<Entry[]>([]);

  useEffect(() => {
    setRows(readStored());
    const t0 = performance.now();
    const push = (ev: string, e: Event) => {
      const target = e.target as Element | null;
      const tag = target?.tagName?.toLowerCase() ?? "?";
      const cls = (target?.className ?? "").toString().slice(0, 32);
      const anchor = target?.closest?.("a");
      const inLink = anchor?.getAttribute("href") ?? null;
      const entry: Entry = {
        t: Math.round(performance.now() - t0),
        ev,
        tag,
        cls,
        inLink,
      };
      setRows((prev) => {
        const next = [...prev, entry].slice(-MAX);
        writeStored(next);
        return next;
      });
    };
    const handlers: Array<[string, EventListener]> = [
      ["pointerdown", (e) => push("pointerdown", e)],
      ["touchstart", (e) => push("touchstart", e)],
      ["touchend", (e) => push("touchend", e)],
      ["click", (e) => push("click", e)],
      ["auxclick", (e) => push("auxclick", e)],
    ];
    for (const [name, h] of handlers) {
      window.addEventListener(name, h, { capture: true });
    }
    return () => {
      for (const [name, h] of handlers) {
        window.removeEventListener(name, h, { capture: true });
      }
    };
  }, []);

  if (rows.length === 0 && typeof window !== "undefined") {
    // Show an empty rail with a hint so the user knows the logger is mounted.
    return (
      <div style={overlayStyle}>
        <div style={titleStyle}>tap log</div>
        <div style={hintStyle}>tap a card</div>
        <button
          type="button"
          style={clearStyle}
          onClick={() => {
            try {
              sessionStorage.removeItem(KEY);
            } catch {}
            setRows([]);
          }}
        >
          clear
        </button>
      </div>
    );
  }

  return (
    <div style={overlayStyle}>
      <div style={titleStyle}>tap log</div>
      {rows.map((r, i) => (
        <div key={i} style={rowStyle}>
          <span style={timeStyle}>+{r.t}ms</span>{" "}
          <span style={evStyle}>{r.ev}</span>{" "}
          <span style={tagStyle}>
            {r.tag}
            {r.cls ? "." + r.cls.slice(0, 16) : ""}
          </span>
          {r.inLink && <span style={linkStyle}> → {r.inLink}</span>}
        </div>
      ))}
      <button
        type="button"
        style={clearStyle}
        onClick={() => {
          try {
            sessionStorage.removeItem(KEY);
          } catch {}
          setRows([]);
        }}
      >
        clear
      </button>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 8,
  right: 8,
  zIndex: 9999,
  background: "rgba(0,0,0,0.86)",
  color: "#fff",
  fontFamily: "ui-monospace, Menlo, monospace",
  fontSize: 10,
  lineHeight: 1.3,
  padding: 8,
  borderRadius: 6,
  maxWidth: 240,
  maxHeight: "60vh",
  overflow: "auto",
  pointerEvents: "auto",
  boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
};

const titleStyle: React.CSSProperties = {
  fontWeight: 700,
  marginBottom: 4,
  color: "#9ee7c4",
};

const hintStyle: React.CSSProperties = {
  color: "#888",
  fontStyle: "italic",
};

const rowStyle: React.CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  borderTop: "1px solid rgba(255,255,255,0.08)",
  paddingTop: 2,
  marginTop: 2,
};

const timeStyle: React.CSSProperties = { color: "#7aa6d6" };
const evStyle: React.CSSProperties = { color: "#f5d680" };
const tagStyle: React.CSSProperties = { color: "#e0e0e0" };
const linkStyle: React.CSSProperties = { color: "#9ee7c4" };

const clearStyle: React.CSSProperties = {
  marginTop: 6,
  background: "rgba(255,255,255,0.15)",
  color: "#fff",
  border: "none",
  padding: "4px 8px",
  borderRadius: 4,
  fontSize: 10,
  fontFamily: "inherit",
  cursor: "pointer",
};
