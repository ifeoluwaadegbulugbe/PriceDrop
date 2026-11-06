# AI shopping agent overhaul: implementation plan

Promise: **Find what you love. Let PriceDrop help you get it for less.**

## Decisions

| Topic | Decision |
|---|---|
| Migration | None needed. Checklist progress is derived from existing records; dismissal and "updates on" are logged in `agent_activity` |
| Currency in examples | `$`, not `₦`. The owner asked to remove Nigeria-specific work and Channel3 has no NGN |
| Branding | Existing cobalt blue |
| Monitoring wording | The real schedule ran about every 6 hours when measured, so copy says checks are scheduled every 30 minutes but can run late |
| Replies | Written by code from real records. Gemini, when enabled, only extracts search details and is verified. So the assistant works with AI off |

## Reused

`extractIntent`, `parseIntentFallback`, `interpretQuestion` and `runQuery`, `loadIntelligence`, `searchCatalogue`, `hydrateCards`, `trendingDrops`, `saveProduct`, `createTracking`, `buyNow`, the checkout state machine, the PayPal client, AG Grid, `deal-card`, `tracking-sheet`, and every existing table.

## New

- `lib/assistant/engine.ts`: routes a message to find, compare, deal check, alternatives or saved-items question. Keeps context in validated slots.
- `lib/assistant/deal.ts`: "Is it a good deal?" from real offers and recorded prices. Pure.
- `lib/checklist.ts`: progress from real records. Pure.
- `POST /api/assistant/chat`, `POST /api/checklist`.
- Pages: `/assistant` (conversation), `/categories`, `/price-drops`, `/saved`, `/compare`.
- Components: `assistant-chat`, `ask-bar`, `compare-tray`, `checklist`, `drop-card`, `saved-view`.

## Changed

Navigation (Home, Categories, Saved items, Price drops, Profile), homepage, onboarding, product page order, product cards, all consumer wording. `/watchlist` redirects to `/saved`. AG Grid stays at `/price-intelligence`, titled "Price details", linked from Saved items and no longer in the main navigation.

## Limits to be honest about

- Channel3's similar-products call was added from SDK types and not run against the live API, because the owner withdrew the local key.
- Saved items without an ideal price aren't monitored, because monitoring needs tracked rules. The page says so.
- Specifications show only when Channel3 supplies them.
