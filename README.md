# Pardle

Daily Wordle-style golf game. Six guesses to identify a mystery pro golfer.

Live: [pardle.app](https://pardle.app)

## Stack

- Next.js 15 (App Router) + React 19
- TypeScript (strict)
- Vitest for game logic tests
- Deployed on Vercel

## Status

Pre-launch. Currently using a 20-player sample dataset for the first deploy. Full ~500-player database (scraped from PGA Tour API + Wikipedia) is the next milestone.

## Repo layout

```
app/                 Next.js routes + UI
  page.tsx           Main game screen
  layout.tsx         Root HTML shell
  globals.css        All styles (Wordle-ish palette)

lib/
  brand.ts           Brand name + URLs (single source of truth for renaming)
  game/
    types.ts         Game types
    reveal.ts        Reveal logic (green/yellow/grey + arrows)
    reveal.test.ts   Unit tests
  data/
    sampleGolfers.ts Stub dataset; replaced by scraped DB later

design/
  pardle-spec-v1.md  Approved design spec
```

## Local dev (when needed)

Node.js intentionally not installed locally — we deploy via Vercel preview URLs. If local dev is ever needed:

```
npm install
npm run dev          # localhost:3000
npm test             # run reveal logic tests
```
