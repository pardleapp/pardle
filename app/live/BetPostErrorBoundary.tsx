"use client";

/**
 * Per-bet error boundary so one malformed bet can't take down the
 * whole feed. Renders a small inline error stripe in dev/preview so
 * we can see what blew up. In prod the user still gets the rest of
 * their feed.
 */

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Identifier shown inline on the error stripe — bet.id, etc. */
  label?: string;
}
interface State {
  error: Error | null;
}

export default class BetPostErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    if (typeof console !== "undefined") {
      console.error("[BetPost crash]", this.props.label ?? "?", error, info);
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            border: "1px solid #f5a3a3",
            background: "#fef3f3",
            color: "#9a2424",
            padding: "10px 12px",
            borderRadius: 12,
            fontSize: 12,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          BetPost error · {this.props.label ?? "?"} ·{" "}
          {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}
