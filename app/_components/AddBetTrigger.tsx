"use client";

/**
 * AddBetTrigger — the green ＋ FAB (bottom-right) plus the AddBet
 * sheet it opens. Drop this once onto any surface that should let
 * the user start tracking a bet: the Sweat feed and /bets.
 *
 * Also handles the deep-link case from the player page's "＋ Bet
 * on X" button — `?addBet=1&addFor=Player Name`. On mount the
 * trigger reads those params, opens the sheet pre-filled, then
 * strips them so a refresh doesn't keep reopening it.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AddBetSheet from "./AddBetSheet";

export default function AddBetTrigger() {
  const params = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [prefillName, setPrefillName] = useState<string | null>(null);

  // Deep-link: open + prefill from ?addBet=1 / ?addFor=...
  useEffect(() => {
    const addBet = params?.get("addBet");
    const addFor = params?.get("addFor");
    if (addBet === "1" || addFor) {
      if (addFor) setPrefillName(addFor);
      setOpen(true);
      // Strip the params so a back/refresh doesn't re-open.
      const url = new URL(window.location.href);
      url.searchParams.delete("addBet");
      url.searchParams.delete("addFor");
      router.replace(`${url.pathname}${url.search}${url.hash}`);
    }
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prefillPlayer = useMemo(() => {
    if (!prefillName) return null;
    // We don't have an orchestrator id at this point; the bet
    // detail / leaderboard match still works on playerName, and
    // when the user submits we'll find a real id from the
    // sheet's loaded player list if they search-and-pick. If they
    // accept the prefill as-is, store the raw name with a stable
    // synthetic id so the bet still persists cleanly.
    return {
      id: `name:${prefillName.toLowerCase().replace(/\s+/g, "-")}`,
      name: prefillName,
    };
  }, [prefillName]);

  return (
    <>
      <button
        type="button"
        className="addbet-fab"
        aria-label="Track a bet"
        title="Track a bet"
        onClick={() => setOpen(true)}
      >
        +
      </button>
      <AddBetSheet
        open={open}
        onClose={() => {
          setOpen(false);
          setPrefillName(null);
        }}
        prefillPlayer={prefillPlayer}
      />
    </>
  );
}
