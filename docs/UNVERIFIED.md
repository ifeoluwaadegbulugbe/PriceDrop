# Unverified items and spec discrepancies

Nothing here has been executed against a real third-party API. No keys were available when this was built.
"Confirmed" means read in official docs, the installed SDK types, or PayPal's published schema.

## Where the brief and the docs disagree (docs followed)

| Topic | Brief | What the source says | What the code does |
|---|---|---|---|
| Channel3 shipping | Offers have `shippingCents`; unknown shipping means no pass on max-total | `ProductOffer` has **no shipping field** (SDK 4.8.0 types), so every live offer has unknown shipping | See "Decision needed" below |
| Channel3 offer URLs | `price_observations.offer_url` stores the URL | Caching guide: don't cache offer URLs, they are short-lived | Column exists, always `null`. Retailer links are fetched fresh on the product page only |
| Channel3 SDK usage | "read the types" | README says `Channel3Client` and `response.products`. Types and docs differ. **Package exports `Channel3`; `retrieve({product_id})`; `search` returns a `Page` with `.data`** | Follows the installed types |
| Channel3 docs URL | docs.trychannel3.com | Redirects to channel3.ai/docs. API host is still api.trychannel3.com | SDK default host |
| PayPal idempotency retention | "about 6 hours" | Docs give no general figure. Only example: refunds, up to 45 days | Idempotency enforced in our DB regardless |
| Capture request id | "fresh request id" | Docs: after a 5xx or timeout on capture, repeat with the same id | Stable per order (`sha256("capture:"+row)`), so a retry can't double-capture |
| Order idempotency key | Deterministic hash of alertId | A UNIQUE key would block retry after a failed or expired order | Hash of alertId plus attempt number. Concurrent prepares still collide |
| Supabase key names | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Current docs say `..._PUBLISHABLE_KEY` | Both accepted |
| Next middleware | not specified | Next 16 renamed it to `proxy.ts` | `src/proxy.ts` |

## Decision needed: unknown shipping

Applied strictly, "unknown shipping means insufficient info, and checkout requires qualifies" would mean **no live
Channel3 product could ever reach checkout**, because Channel3 never states shipping. The brief also says the amount is
"price (+ shipping if known)", which implies unknown shipping can proceed.

Implemented: shipping unknown stays in `unknown`, is never added to `passed`, fails if price alone exceeds the max, and on its own
does not block `qualifies`. The deal and checkout pages say the total could be higher and that the charge is the item price only.
Any other unknown (stock, variant) still gives `insufficient_info`. To change this, edit `blockingUnknown` in `src/lib/evaluation/evaluate.ts`.

## Channel3 (real calls made 2026-11-05)
- **Price units: confirmed major units** from real responses. `tests/fixtures/channel3-product.recorded.json` is a real response with URL query strings removed. The synthetic fixture remains for malformed-data cases.
- **Offer URLs are affiliate-tracked** per Channel3's skill docs (`buy.trychannel3.com`). "View retailer" uses them, so sales through that link may earn commission on your account. The UI doesn't currently disclose this.
- `.agents/skills/channel3-api` is Channel3's own agent documentation, installed on request. The installer's scanner listed it as Gen Safe, Socket 0 alerts, Snyk Med Risk. Reading it found only docs, no scripts. It isn't used at runtime.
- `GET /v1/products/{id}` can return 429 with an unquantified limit. Monitoring is bounded to 50 per run at concurrency 4.
- Long-term storage of price observations: the caching guide discourages long-lived caching of full product data. Observations are timestamped history and are never shown as current. Not explicitly addressed by their docs.
- `products.image_url` is stored as display metadata, refreshed only when tracking starts, and may go stale. Docs: don't assume image URLs are permanent.

## PayPal (no credentials: never called, only the local fake)
Confirmed in `orders/v2/schema.json`: `NO_SHIPPING`, capture statuses `COMPLETED, DECLINED, PARTIALLY_REFUNDED, PENDING, REFUNDED, FAILED`, capture path `purchase_units[].payments.captures[]`, `payer-action` link, order examples `CREATED, APPROVED, PAYER_ACTION_REQUIRED, COMPLETED`.

Unconfirmed, coded defensively:
- **Webhook order id location.** `resource.supplementary_data.related_ids.order_id` for capture events comes from memory, no sample payload found. If absent, the event is recorded and ignored, and capture plus reconcile still work.
- `verification_status` values other than `SUCCESS`: anything else is treated as invalid.
- Full order status enum: unknown statuses are treated as not yet approved, so nothing is captured.
- Whether PayPal accepts `http://localhost` return URLs in sandbox. If not, test on the deployed HTTPS URL.
- `PAYMENT.CAPTURE.DENIED` vs `DECLINED`: docs list both. Both handled.
- Run `npm run paypal:smoke` first once you have sandbox credentials. It exercises token, create and get for real.

## Gemini (no key: never called)
- Model `gemini-3.5-flash-lite` shown as free tier on the pricing page. `gemini-2.5-flash` reroutes on 1 Dec 2026 per the models page, so it was avoided.
- `generateContent` URL and `x-goog-api-key` confirmed. `systemInstruction`, `contents`, `generationConfig.responseMimeType`, and the response text path are from memory: the doc's request section was truncated. Any failure falls back to basic mode, so the worst case is no AI text.
- Free-tier RPM/RPD aren't in the public docs (shown in AI Studio). `LLM_DAILY_CAP=100` is a guess; lower it if you see 429s.

## Supabase (no project: real service never called)
- Migrations ran on PGlite (real Postgres) with a stub `auth` schema, not on Supabase itself. The `--env` mode of `scripts/test-rls.ts` runs the same checks against a real project: **run it after applying migrations**.
- Whether legacy anon and service_role keys still work on new projects: not confirmed. New `sb_publishable` and `sb_secret` keys should work in the same variables, not tested.
- Session check uses `getUser()` (network round trip, sees revocation). Supabase docs now recommend `getClaims()` for speed. Deliberate.
- Email confirmation is on by default with low built-in email limits. See `docs/DEPLOY.md`.

## Vercel and GitHub (never deployed)
- GET for Vercel cron is implied by the docs' examples, not stated. `CRON_SECRET` as a Bearer header is confirmed.
- `vercel.json` daily cron not yet validated by a real deploy.
- GitHub may delay scheduled workflows and disables them after long repo inactivity (from memory). UI wording says best effort.

## Scope decisions beyond the brief
- Added routes: `POST /api/checkout/cancel`, `POST /api/deals/[id]/dismiss`. Added table `usage_counters`, column `purchases.refunded_at`.
- A dismissed alert only re-alerts on a meaningfully lower price, so a dismissal isn't undone 30 minutes later.
- An open alert expires, with a notification, if the offer stops qualifying.
- A demo simulated price stands in for the source price for 2 hours, so a demo can reach checkout. Labelled at every layer.
- Script CSP uses `'unsafe-inline'`: Next's bootstrap scripts need it without a nonce setup. No secrets are rendered into pages.
- Demo catalogue uses real brand names with invented prices and `.example` retailers, labelled everywhere.
- Dark mode follows the system. There is no manual toggle.
