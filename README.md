# Salon AI Command Centre

Back-end management intelligence layer for the salon — see
`salon-ai-requirements.md` for the full product spec. This is a skeleton
scaffold: module structure, typed interfaces, and tooling are in place;
feature logic (parsing, live Supabase queries, LLM calls) is stubbed with
`TODO`s pointing at the relevant requirements section.

## Setup

```bash
npm install
cp .env.example .env   # fill in Supabase/ads/LLM credentials
```

## Scripts

- `npm run dev` — start the Vite dev server
- `npm run build` — typecheck and build for production
- `npm run preview` — preview the production build
- `npm run lint` — run ESLint
- `npm run typecheck` — run the TypeScript compiler with no emit
- `npm run test` — run the Vitest suite (deterministic insight-engine calculations)

## Structure

- `src/modules/*` — one folder per module from the requirements doc's
  Section 8 (auth, data-ingestion, insight-engine, recommendations,
  dashboard, chat, notifications, settings), each with a single `index`
  barrel as its public interface
- `src/lib/data-access` — the only layer allowed to query Supabase directly
- `src/lib/supabase` — Supabase client + generated database types (regenerate
  `database.types.ts` once a real project exists)
- `src/shared` — cross-module types and UI primitives
