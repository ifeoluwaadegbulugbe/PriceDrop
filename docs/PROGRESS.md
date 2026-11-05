# Progress

Built in one session, so Days 1 to 3 are reported together. Every result below was actually run on 2026-11-05.

## What was run, and what happened

| Command | Target | Result |
|---|---|---|
| `npx tsc --noEmit` | code | exit 0 |
| `npx eslint .` | code | exit 0, no findings |
| `npx vitest run` | PGlite, fake PayPal | 117 of 117 passed (5 files) |
| `npm run test:rls` | PGlite, real RLS, real supabase-js | 45 of 45 passed |
| `npm run test:security -- --local` | production build + emulator over HTTP | 74 of 74 passed |
| `npm run test:bundle` | production build with sentinel secrets | no secret name or value in 30 client files; control check confirmed the scan sees inlined values |
| `npm run paypal:smoke` | fake PayPal | token, create, get OK |
| `npm run seed:demo` | emulator | 3 tracked products with labelled history |
| `next build`, `next start` with no env at all | no keys | `/` 200; `/login`, `/signup`, `/dashboard` show the setup notice; API 503; cron 401; demo route 404 |
| Browser walkthrough at 1280px and 375px | production build + emulator | see below |

Browser walkthrough: signup, onboarding, dashboard empty state, "Sony headphones, no more than $90", intent card, Demo catalogue results with banner, tracking sheet, baseline observations, Check now, simulated drop, chart, rule-by-rule deal page, prepare, fake PayPal approve, return with automatic capture, purchase history with IDs, settings, dark mode. No console errors. No horizontal scroll at 375px on the deal or dashboard pages. Screens not resized individually at both widths: search, assistant at 375px.

Tests found real bugs along the way, now fixed: a mangled whitespace regex in the prompt sanitiser; an empty chart when all observations share a timestamp.

## What is real, what is emulated

| Piece | Status |
|---|---|
| Evaluation, alert policy, money, parsers, explanation verifier | Real code, tested |
| Migrations, RLS, state machine trigger, `finalize_capture` | Real SQL on real Postgres (PGlite), **not yet on Supabase** |
| Supabase Auth | **Emulated only** |
| PayPal client | Real code, request shapes per docs, **only ever run against the local fake** |
| Channel3 client | **Never called**. Fallback to the Demo catalogue tested |
| Gemini | **Never called**. Off by default, basic mode tested |
| Webhook | Logic tested, signature path tested as rejection only |
| Vercel, GitHub Actions | **Not deployed, never run** |

## Not done

Blocked on accounts you need to create (`docs/DEPLOY.md`):
1. First Vercel deploy and the rehearsal on the deployed URL.
2. Real PayPal sandbox approval with a sandbox buyer. Definition of Done needs this.
3. `npm run test:rls -- --env` and `npm run test:security -- --env` on real Supabase.
4. A recorded Channel3 fixture and the price-unit check.

Known gaps:
- Search results aren't ranked by budget. Over-budget items show, deliberately, because tracking one until it drops is valid.
- Account deletion isn't offered.
- `npm audit --omit=dev` reports 6 low or moderate advisories (including deepmerge and minimatch, through the shadcn package). Not triaged further.
- Dashboard fetches live offers per tracked product (up to 12) on render, so it slows with many Channel3 products.

See `docs/UNVERIFIED.md` for every assumption.
