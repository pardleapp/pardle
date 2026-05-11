"use client";

import { useEffect, useState } from "react";
import type { GolfHeadline } from "@/lib/golf-news";

const ROTATE_MS = 6500;

export function NewsTicker({ headlines }: { headlines: GolfHeadline[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (headlines.length <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % headlines.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [headlines.length]);

  if (headlines.length === 0) return null;
  const current = headlines[index];

  return (
    <div
      className="news-ticker"
      role="region"
      aria-label="Latest golf news"
    >
      <span className="news-ticker-label" aria-hidden="true">
        ⛳ News
      </span>
      <a
        key={index}
        href={current.link}
        target="_blank"
        rel="noopener noreferrer"
        className="news-ticker-headline"
      >
        {current.title}
        <span className="news-ticker-source"> — {current.source}</span>
      </a>
    </div>
  );
}
