# PriceDrop implementation plan

Repo state at start: empty folder, nested git repo created here because the parent
`git` toplevel is the home directory with an unrelated remote. No Docker, no API keys,
no Vercel/GitHub login on this machine.

Testing consequence: real Supabase, PayPal, Channel3 and Gemini cannot be executed until
keys exist. To avoid shipping untested logic, the repo includes a **local emulator stack**
(`scripts/local-stack.ts`, dev-only): real Postgres via PGlite running the real migrations and
real RLS, a PostgREST/GoTrue subset, and a fake PayPal sandbox. Anything verified only there is
reported as "emulator verified", never as "PayPal works". `docs/PROGRESS.md` tracks the difference.

Legend: MUST = needed for Definition of Done. SHOULD = expected, cut only under pressure. NICE = cut first.

## Day 1: foundation
- MUST scaffold Next 16 App Router, strict TS, Tailwind, shadcn/ui, Vitest, fonts
- MUST Zod env validation; boots with optional keys absent
- MUST `supabase/migrations/0001_init.sql` + `0002_functions.sql`, RLS on every table
- MUST emulator stack + `scripts/test-rls.ts` (two users)
- MUST auth (email/password, `@supabase/ssr`, `proxy.ts`)
- MUST design tokens, landing, onboarding
- MUST Channel3 client, `normalize.ts`, budget guard, seed catalogue fallback
- MUST search page, tracking create/edit with baseline observation, dashboard v1
- BLOCKED first Vercel deploy: needs your Vercel + Supabase accounts (see `docs/DEPLOY.md`)

## Day 2: the agent
- MUST `evaluateDeal` + exhaustive tests, alert policy
- MUST PayPal client with live-endpoint guard, `scripts/paypal-smoke.ts`
- MUST checkout state machine, prepare, capture, reconcile
- MUST monitor job, `.github/workflows/monitor.yml`, `vercel.json` daily cron
- MUST intent extraction, deterministic fallback, explanation with figure verification
- MUST assistant UI, deal page, notifications, price chart

## Day 3: demo and hardening
- MUST demo mode + `scripts/seed-demo.ts`
- MUST PayPal webhook route
- MUST purchase history, settings, all screen states, 375px and 1280px pass
- MUST security checklist (`scripts/test-rls.ts`, `scripts/security-check.ts`)
- MUST end-to-end rehearsal on the emulator stack
- BLOCKED end-to-end rehearsal on the deployed URL: needs your deploy
- MUST README, ARCHITECTURE, DEPLOY, LICENSE, `.env.example`, PROGRESS
- SHOULD visual polish, only after PayPal flow and security checks pass
- NICE email notifications, retailer logos (cut: in-app notifications only)

## Cut or deferred
- `/similar`, `/image-search`, `/price-tracking`: not used (credits).
- Variant selection beyond `variants.selected` labels: rules accept labels; Channel3 returns
  one selected variant per product, so per-variant monitoring is out of scope.
