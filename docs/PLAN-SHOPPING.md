# Consumer shopping experience: implementation plan

Positioning: **Find it. Track it. Get it for less.**

## What inspection found

| Brief assumes | Reality | Decision |
|---|---|---|
| "Existing" brand colour `#E8557A` | Not in the repo. The accent is cobalt | Keep the original cobalt, at the owner's request. It overrides the `#E8557A` mentioned in the briefs |
| "Keep" the AG Grid integration | Not installed | Add `ag-grid-community` and `ag-grid-react` (MIT, free), loaded only on Price Intelligence |
| Existing category tables | None. Only `data/seed-products.json` has a loose `category` string | Add a reusable `categories` table |
| Browser push notifications | Only in-app notifications exist | Offer only in-app. No browser permission prompt, because nothing would use it |
| "Popular products" | No popularity data beyond tracking | Section appears only when at least 2 users track or save the same product |

## Reused

- Auth: `@supabase/ssr`, `src/proxy.ts`, `auth-form.tsx`. No second auth flow. Sign-up already leads to onboarding, so selections are saved directly to the signed-in profile.
- `profiles`, `products`, `tracked_products`, `price_observations`, `deal_alerts`, `notifications`, `usage_counters`.
- `catalogue/` budget guard and seed fallback, `channel3/` gateway, `tracking-sheet.tsx`, `deal-card.tsx`, `product-tile.tsx`, `ai/intent.ts`, `/api/tracking`, `/api/search`, `/api/assistant/intent`.
- Search and assistant merge into one `/search`. `/assistant` redirects there.

## Schema: `supabase/migrations/0003_shopping.sql`

- `profiles`: add `interests`, `favourite_brands`, `shopping_preferences`.
- `categories`: id, parent_id, slug, name, description, image_url, channel3_slugs, search_query, seed_terms, display_order, active. Adding a category is a new row, not a new page.
- `saved_products`, `recently_viewed`: per-user, read through RLS, written only through server routes.
- `discovery_cache`: server-only key/value store for search lists and product snapshots.
- `trending_price_drops()`, `popular_products()`: server-only aggregates that expose no user data.

Products aren't tagged with categories in our database: a category page queries Channel3 by its real category slugs, so catalogue data stays the source of truth.

## Staying inside 1,000 free credits

- `product.id` lists are cached for 48 hours per category. Channel3 says IDs are safe to cache.
- Prices come from the free `GET /v1/products/{id}`, cached for at most 30 minutes and always shown with a fetched time.
- The monitor refreshes at most one stale category per run, and only while under 60% of the monthly budget.
- Every paid call still goes through the existing budget guard. Beyond it, stale lists are used, then the labelled Demo catalogue.

## New

Services: `lib/discovery/service.ts`, `lib/discovery/filters.ts`.

Routes: `POST`/`DELETE /api/saved`.

Pages: `/categories/[slug]`, `/shop/[source]/[id]`, `/watchlist`, `/price-intelligence`. `/onboarding` and `/dashboard` are rebuilt.

Components: `onboarding-flow`, `category-tile`, `shop-card`, `product-grid`, `search-bar`, `price-grid`, `interests-form`.

## Honesty rules carried forward

- A "price drop" means our own recorded observation fell by at least 1%, from a real source, at the same retailer. Retailer `compare_at_price` is never shown as a discount.
- Demo simulations are excluded from drops unless `DEMO_MODE=true`, and then they carry the Demo simulation badge.
- "Picked for you" appears only when the person chose interests. It says which ones it used.
- Categories with no products show an empty state, never filler.

## Tests

Unit tests for filters, percentages and the new parser cases. Emulator tests for caching, budget, saved items, trending, popular and personalisation. RLS checks for the new tables. Browser pass at 375px and 1280px.
