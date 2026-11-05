# PriceDrop

**The shopping agent that knows when to buy.** Say what you want and what you'll pay. PriceDrop finds products, watches prices, checks offers against your rules with deterministic code, explains the verdict, and prepares a PayPal **sandbox** checkout that only you can approve.

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

## Docs

- [ARCHITECTURE](docs/ARCHITECTURE.md): how it fits together and the money path
- [DEPLOY](docs/DEPLOY.md): Supabase, PayPal, Vercel, GitHub Actions
- [PROGRESS](docs/PROGRESS.md): what was run and what is still unproven
- [UNVERIFIED](docs/UNVERIFIED.md): every assumption and where the brief and docs disagree
- [PLAN](docs/PLAN.md)

## Stack

Next.js 16, TypeScript, Tailwind, shadcn/ui, Recharts, Zod, Vitest, Supabase, Channel3, PayPal Orders v2, Gemini, Vercel Hobby, GitHub Actions.

MIT licensed.
