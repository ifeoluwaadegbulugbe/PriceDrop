# PriceDrop

**Find what you love. Let PriceDrop help you get it for less.** Tell the AI shopping assistant what you need, or browse by category. PriceDrop finds products, watches prices, checks offers against your rules with deterministic code, explains the verdict, and prepares a PayPal **sandbox** checkout that only you can approve. You can also buy at the current price whenever you like.

Sandbox only: no real money moves and no retailer ships an item. Runs entirely on free tiers.

## Try it in 2 minutes, no accounts

A local emulator runs the real migrations and RLS on an embedded Postgres, with a fake PayPal.

```bash
npm install
```
```bash
npm run local:stack
```
In a second terminal:
```bash
npm run dev:local
```
Open http://localhost:3000, sign up with any email, type `Sony headphones, no more than $90`, track a product with a target of 75, then use **Try a price change** with 69.99, and follow the deal through checkout.

The emulator resets when stopped. It is not real Supabase or PayPal.

## Run it for real

Copy `.env.example` to `.env.local`, and follow [docs/DEPLOY.md](docs/DEPLOY.md). Supabase and PayPal sandbox are needed for the full flow. Channel3 and Gemini are optional: without them you get the labelled Demo catalogue and basic mode.

## Tests

```bash
npm run typecheck
```
```bash
npm run lint
```
```bash
npm test
```
```bash
npm run test:rls
```
```bash
npm run test:bundle
```
With the emulator stack and `npm run dev:local` running:
```bash
npm run test:security -- --local
```

## Price Intelligence and AG Grid

PriceDrop uses [AG Grid Community](https://www.ag-grid.com/) (MIT licence, no Enterprise package) for one job: managing the products you track. Shopping itself stays image-led with product cards, and the grid lives on its own page.

- **Why a grid:** comparing several tracked products on price, target and recency is what a grid is good at.
- **Community features used:** sorting, quick-filter search, inline cell editing with validation, custom cell renderers, pagination for longer lists, and a theme built from PriceDrop's own colour tokens.
- **Connection to Supabase:** the page reads `tracked_products`, `price_observations`, `deal_alerts` and `purchases` through the signed-in person's RLS client. There are no grid-specific tables. Edits go through `PATCH /api/tracking/[id]`, the same route the rest of the app uses.
- **Sorting and filtering:** plain-language options (lowest price, biggest drop, closest to target, and so on) run through shared, tested functions. Every figure is computed from recorded observations with integer arithmetic.
- **Phones:** under 1100px wide you get cards with the same data, logic and actions, and the grid code is never downloaded.
- **What AI does:** it only turns a question like "which has dropped the most?" into a validated filter. Code finds the rows and writes the figures, and the box works with AI turned off.
- **Testing:** unit tests for calculations and query guards, HTTP checks for access control, and a browser pass covering sort, filter, search, editing, invalid edits, persistence, pause, resume and remove.

## Docs

- [ARCHITECTURE](docs/ARCHITECTURE.md): how it fits together and the money path
- [DEPLOY](docs/DEPLOY.md): Supabase, PayPal, Vercel, GitHub Actions
- [PROGRESS](docs/PROGRESS.md): what was run and what is still unproven
- [UNVERIFIED](docs/UNVERIFIED.md): every assumption and where the brief and docs disagree
- [PLAN](docs/PLAN.md) and [shopping plan](docs/PLAN-SHOPPING.md)

## Stack

Next.js 16, TypeScript, Tailwind, shadcn/ui, Recharts, Zod, Vitest, Supabase, Channel3, PayPal Orders v2, Gemini, Vercel Hobby, GitHub Actions.

MIT licensed.
