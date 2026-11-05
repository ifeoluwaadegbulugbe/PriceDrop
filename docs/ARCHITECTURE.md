# Architecture

**AI interprets and explains. Code decides.** The LLM has one capability: return text. It has no tools, sees no credentials, and nothing it returns triggers an action or reaches `evaluateDeal`.

```
Browser ── pages (RLS client, reads) ───────────────► Supabase Postgres
   │                                                        ▲
   └─ /api/* (IDs and rules only) ─► services (service role, ownership checks in code)
                                       ├─ catalogue ─► Channel3 / Demo catalogue
                                       ├─ evaluation (pure)
                                       ├─ ai ─► Gemini, or deterministic fallback
                                       └─ checkout ─► PayPal sandbox
GitHub Actions (30 min, best effort) ─┐
Vercel cron (daily backup) ───────────┴─► /api/cron/monitor ─► monitor, then reconcile
```

## Modules (`src/lib`)
| Path | Job |
|---|---|
| `evaluation/evaluate.ts` | `evaluateDeal`. Pure, integers only, fails closed |
| `evaluation/alertPolicy.ts` | `decideAlert`: create, update, expire, or none |
| `ai/provider.ts` | Gemini wrapper, sanitising, personal data scrub |
| `ai/fallback.ts`, `ai/intent.ts` | Regex parser; LLM intent with Zod and a budget-must-appear-in-prompt check |
| `ai/explain.ts` | Template, then optional LLM rephrase verified figure by figure |
| `channel3/` | SDK wrapper, `normalize.ts` |
| `catalogue/` | Budget guard, seed fallback |
| `paypal/client.ts` | Typed fetch client, sandbox guard |
| `checkout/` | State machine, prepare, capture, cancel, reconcile, webhook handling |
| `monitor/` | `checkTracked` (the one pipeline), `runMonitor` |
| `tracking/` | Create, edit, remove, simulate |
| `deps.ts`, `serverDeps.ts` | Dependency injection, so tests run the same services |

## One pipeline
Monitor, Check now, baseline and demo simulation all call `checkTracked`: fetch offers, record the observation unless identical and under 6 hours old, evaluate, decide the alert, explain, notify, update status. A simulation only overrides one offer's price and its `source`.

## Money path
1. Client sends `alertId`. Bodies are `strictObject`, so any extra field such as an amount is a 400.
2. `prepare` verifies ownership, returns any live order, re-fetches the offer, re-runs `evaluateDeal`, requires `qualifies`, and computes the amount.
3. The row is inserted as `creating` with a deterministic key. Unique indexes make concurrent prepares collapse to one. PayPal gets the same key.
4. The buyer approves at PayPal. **There is no other way to approve.**
5. `capture` verifies ownership and expiry, GETs the order, requires `APPROVED` and an exact amount match, captures, and requires capture `COMPLETED` with an exact amount.
6. `finalize_capture` does everything in one DB transaction: order, purchase, alert, tracked product, notification, activity. Replays return the existing purchase.

`reconcile` never captures. It only records what PayPal reports. Webhooks verify the signature, dedupe, then reconcile through GET order, so a body's amounts are never read.

## Defence in depth
- `revoke all` from clients, then column-level grants, then RLS. Clients can write only: own profile, own tracked rules and status (never `purchased` or `deal_found`), `notifications.read_at`.
- The order state machine exists in TypeScript and in a DB trigger. `tests/db.test.ts` checks they agree on all 56 pairs.
- Service role only in `server-only` modules. `scripts/check-bundle.ts` proves secrets stay out of client bundles.
- Rate limits and budgets are atomic Postgres counters, and fail closed.

## Honesty rules in code
- Stored prices are labelled observations. Pages fetch live offers, or say the current price is unavailable.
- `isGenuineChange` needs a strictly higher previous observation. First prices say "First observed at this price".
- `source` on observations drives the Demo catalogue and Demo simulation badges.
- A failed source check writes no observation.

## Local emulator (`scripts/local/`)
Never imported by `src/`. PGlite runs the real migrations with real RLS, behind a PostgREST and GoTrue subset, plus a fake PayPal. It exists because no accounts or Docker were available. It proves our logic, not third-party behaviour.
