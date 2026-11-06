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

## Channel3 connected (2026-11-05, later)

With a real key, using the emulator for the database and payments:
- `npm run channel3:smoke`: real search and retrieve succeeded. Raw `24.99` USD is normalized to 2499 cents, so **prices are major units**, as assumed.
- Browser: "Sony headphones, no more than $90" returned real retailers and product photos with no fallback banner. Tracking MDR-7506 recorded baselines at 5 retailers and created a truthful "first observed" deal with shipping flagged unknown. Prepare re-checked the live price, and the order was approved and captured on the fake PayPal.
- `retrieve` took about 0.4 to 1.5 seconds. Search took about 3 seconds.
- Live data exposed two fixes: within-budget results now come first, and demo simulation now skips out-of-stock retailers.
- The key is not yet set on Vercel by this session. That has to be done in the dashboard, followed by a redeploy.

## Shopping experience, Buy now and AG Grid (2026-11-05, later)

Run with the emulator for the database and payments, and real Channel3 data:
- Tested: onboarding on a phone, homepage, all 12 category lookups against real Channel3 results, subcategories, product page, save, Buy now through capture, and Price Intelligence (filters, sort, search, retailer filter, target edit, persistence after refresh, invalid edit, pause, resume, remove, AI questions, phone cards).
- Bugs the walkthrough found and fixed: the homepage crashed from a client helper called on the server; products that dropped and reached target were missing from "Price dropped"; an invalid target edit showed a false "Saved"; removed products lingered in activity.
- Also tested: interests persist after signing out and back in, and edits to them save.
- Real PayPal sandbox: reachable, and it rejected deliberately fake credentials, which the app reported correctly. No real order has been created, because no sandbox credentials are available here. The Profile page now shows a live PayPal connection check.
- Not tested: real Supabase, a real PayPal order, the migration on a real project, and Gemini. **The live site's PayPal error is still undiagnosed**, because the reason wasn't visible before this change.
- Credits used on Channel3 so far: an estimated 25 to 50 of 1,000 (not metered here; check the Channel3 dashboard), including one 12-credit check of all categories.

## Real PayPal sandbox capture (2026-11-06)

On the deployed site, the owner completed Buy now with a real sandbox order: approved at PayPal with a sandbox buyer, returned to the site, and saw the capture confirmed. Reported by the owner from the live site, not observed directly.

Two setup problems came first, both outside the code:
- Local emulator values had reached the deployment's settings, including `PAYPAL_BASE_URL`, giving "couldn't reach PayPal".
- PayPal's "merchant isn't able to accept PayPal payments" appeared before the owner changed the sandbox setup. A new US sandbox business account with a new app was the suggested fix.

## Scheduler on real infrastructure (2026-11-06)

A manual run of the workflow reached the deployed app: `{"checked":3,"ok":3,"failed":0,"observationsWritten":5,...}`. The Supabase step returned 401 because it read a table that logged-out access is blocked from, which is the intended rule. It now calls the auth health endpoint, which returned 200 when tested against the real project. The changed workflow has since passed on GitHub. Scheduled runs arrive far less often than the 30-minute schedule: GitHub's API showed 2 scheduled runs, about 6 hours apart, so the app's wording now says checks can run hours late. Whether the health call alone counts as activity for Supabase's pause rule isn't confirmed; the monitor's database queries are the main keep-alive.

## AI shopping agent and consumer experience (2026-11-06)

Plan: `docs/PLAN-AGENT.md`. No database migration was needed.

Built: a conversational assistant at `/assistant` and on Home; deal checks, alternatives, comparison and questions about saved items; `/categories`, `/saved`, `/price-drops`, `/compare`; a new four-step introduction; a getting-started checklist worked out from real records; new navigation; consumer wording throughout. AG Grid stays at `/price-intelligence`, titled Price details. `/watchlist` redirects to `/saved`.

Checked locally against the emulator and the Demo catalogue: 250 tests, lint, types, the bundle check, the RLS script and the HTTP security script, plus a browser walkthrough at 375px and 1280px: sign-up, introduction, the laptop and gift follow-up questions, budget search, relaxing a budget, deal check, alternatives, comparing, saving, setting an ideal price, a simulated drop, Saved items, Price drops, Price details, and the checklist reaching 6 of 6 and being dismissed.

Not checked: anything on the deployed site, and any new Channel3 call. The similar-products call and the specification and rating fields come from the SDK's types, with no real response seen. See `docs/UNVERIFIED.md`.

## What is real, what is emulated

| Piece | Status |
|---|---|
| Evaluation, alert policy, money, parsers, explanation verifier | Real code, tested |
| Migrations, RLS, state machine trigger, `finalize_capture` | Real SQL on real Postgres (PGlite), **not yet on Supabase** |
| Supabase Auth | **Emulated only** |
| PayPal client | **Create, approve and capture confirmed on the real sandbox** through Buy now. Deal checkouts, declines and refunds are tested only against the local fake |
| Channel3 client | **Called for real**: search and retrieve work. Fallback to the Demo catalogue tested |
| Gemini | **Never called**. Off by default, basic mode tested |
| Webhook | Logic tested, signature path tested as rejection only |
| Vercel, GitHub Actions | **Deployed and run.** The monitor step works on the live site. Scheduled frequency is still to be observed |

## Not done

Blocked on accounts you need to create (`docs/DEPLOY.md`):
1. First Vercel deploy and the rehearsal on the deployed URL.
3. `npm run test:rls -- --env` and `npm run test:security -- --env` on real Supabase.

Known gaps:
- Over-budget search results still show after the within-budget ones, deliberately, because tracking one until it drops is valid.
- Account deletion isn't offered.
- `npm audit --omit=dev` reports 6 low or moderate advisories (including deepmerge and minimatch, through the shadcn package). Not triaged further.
- Dashboard fetches live offers per tracked product (up to 12) on render, so it slows with many Channel3 products.

See `docs/UNVERIFIED.md` for every assumption.
