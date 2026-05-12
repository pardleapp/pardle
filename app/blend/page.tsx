"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { GOLFERS } from "@/lib/data/golfers";
import { PGA_TOUR_IDS, pgaTourHeadshotUrlById } from "@/lib/data/pga-tour-ids";
import type { Golfer } from "@/lib/game/types";
import { searchableName } from "@/lib/text";

// Pre-curated starter pairings — one tap to generate. Bias to combos
// that are either visually striking (DJ × Bryson — bald vs hair) or
// rivalry-loaded (Tiger × Phil, Rory × Bryson).
const FEATURED: { a: string; b: string; label: string }[] = [
  { a: "08793", b: "01810", label: "Tiger × Phil" },
  { a: "46046", b: "28237", label: "Scheffler × Rory" },
  { a: "47959", b: "28237", label: "Bryson × Rory" },
  { a: "30925", b: "47959", label: "DJ × Bryson" },
  { a: "34046", b: "33448", label: "Spieth × JT" },
  { a: "52955", b: "57366", label: "Aberg × Young" },
];

interface PickerInputProps {
  label: string;
  selected: Golfer | null;
  onSelect: (g: Golfer | null) => void;
  excludeId: string | null;
}

function PickerInput({ label, selected, onSelect, excludeId }: PickerInputProps) {
  const [input, setInput] = useState("");

  const pool = useMemo(
    () =>
      GOLFERS.filter(
        (g) => PGA_TOUR_IDS[g.id] !== undefined && g.id !== excludeId,
      ),
    [excludeId],
  );

  const matches = useMemo(() => {
    const q = searchableName(input.trim());
    if (!q) return [];
    return pool
      .filter((g) => searchableName(g.name).includes(q))
      .slice(0, 6);
  }, [input, pool]);

  if (selected) {
    return (
      <div className="blend-pick blend-pick-selected">
        <div className="blend-pick-label">{label}</div>
        <div className="blend-pick-chip">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pgaTourHeadshotUrlById(PGA_TOUR_IDS[selected.id]!, 120)}
            alt={selected.name}
          />
          <span>{selected.name}</span>
          <button
            type="button"
            className="blend-pick-clear"
            onClick={() => {
              onSelect(null);
              setInput("");
            }}
            aria-label="Remove"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="blend-pick">
      <div className="blend-pick-label">{label}</div>
      <div className="input-area">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a pro's name..."
          autoComplete="off"
          autoCapitalize="words"
        />
        {matches.length > 0 && (
          <ul className="suggestions">
            {matches.map((g) => (
              <li
                key={g.id}
                onClick={() => {
                  onSelect(g);
                  setInput("");
                }}
              >
                {g.name}{" "}
                <span className="suggestion-country">{g.country}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function BlendPicker() {
  const router = useRouter();
  const [a, setA] = useState<Golfer | null>(null);
  const [b, setB] = useState<Golfer | null>(null);

  const ready = a !== null && b !== null;

  function generate() {
    if (!a || !b) return;
    const idA = PGA_TOUR_IDS[a.id];
    const idB = PGA_TOUR_IDS[b.id];
    if (!idA || !idB) return;
    router.push(`/blend/${idA}/${idB}`);
  }

  function loadFeatured(featured: { a: string; b: string }) {
    router.push(`/blend/${featured.a}/${featured.b}`);
  }

  return (
    <main className="container blend-landing">
      <header className="brand">
        <Link className="brand-back" href="/" aria-label="All games">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Blend any two PGA pros</p>
      </header>

      <p className="blend-intro">
        Pick two players. Get a blended-face PNG you can save or share.
        Same recipe as our daily puzzle at <Link href="/faces">/faces</Link>.
      </p>

      <Link href="/blend/me" className="blendme-promo">
        📸 New: blend yourself with a pro →
      </Link>

      <div className="blend-picker">
        <PickerInput
          label="Pro 1"
          selected={a}
          onSelect={setA}
          excludeId={b?.id ?? null}
        />
        <PickerInput
          label="Pro 2"
          selected={b}
          onSelect={setB}
          excludeId={a?.id ?? null}
        />
        <button
          type="button"
          className="blend-go"
          onClick={generate}
          disabled={!ready}
        >
          Blend →
        </button>
      </div>

      <div className="blend-featured">
        <div className="blend-featured-label">Or try one of these</div>
        <div className="blend-featured-chips">
          {FEATURED.map((f) => (
            <button
              key={f.label}
              type="button"
              className="blend-featured-chip"
              onClick={() => loadFeatured(f)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="blend-cta">
        <p className="blend-cta-text">
          Like blending faces? There&apos;s a daily puzzle.
        </p>
        <Link href="/faces" className="blend-cta-btn">
          Play today&apos;s Faces →
        </Link>
      </div>

      <footer>
        <p>
          {BRAND.domain} · Free tool · No signup
        </p>
      </footer>
    </main>
  );
}
