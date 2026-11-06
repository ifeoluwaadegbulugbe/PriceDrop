# Deploy (all free tiers, no payment method)

Put values in `.env.local` or the Vercel dashboard. Never paste them into chat or commit them.

## 1. Supabase
1. Create a free project at supabase.com.
2. SQL Editor: run `supabase/migrations/0001_init.sql`, then `0002_functions.sql`, then `0003_shopping.sql`. **On an existing project, run `0003_shopping.sql` before deploying code that needs it.** Or use `npx supabase link` and `npx supabase db push`.
3. Authentication > Sign In / Providers > Email: turn off **Confirm email** for a demo. Built-in email has low limits. If left on, add `<APP_URL>/auth/callback` to the redirect URLs.
4. Project Settings > API: copy the URL, the anon or publishable key, and the service role or secret key.
5. Locally, with those in `.env.local`:
   ```bash
   npm run test:rls -- --env
   ```

## 2. PayPal sandbox
1. developer.paypal.com > Apps & Credentials > **Sandbox** > Create App. Copy the client ID and secret.
2. Testing Tools > Sandbox Accounts: note the personal (buyer) account.
3. Smoke test:
   ```bash
   npm run paypal:smoke
   ```
   Open the printed link, approve as the sandbox buyer, then run the printed capture command.
4. Optional, after step 4 below: Webhooks > add `<APP_URL>/api/paypal/webhook` with `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.REFUNDED`. Put its ID in `PAYPAL_WEBHOOK_ID`. Without it, capture and reconcile still work.

Never set `ALLOW_LIVE_PAYPAL`.

## 3. Optional keys
- Channel3: key from trychannel3.com. Without it the labelled Demo catalogue is used. Check it with `npm run channel3:smoke` (costs 1 credit). Add it to Vercel and redeploy.
- Gemini: key from aistudio.google.com, no billing. Set `LLM_ENABLED=true`. Free-tier content may be used by Google. The app strips emails and phone numbers before sending.

## 4. Vercel (Hobby)
1. Push this repo to GitHub, and import it at vercel.com. Framework preset: Next.js.
2. Add all variables from `.env.example`. Generate `CRON_SECRET`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. Set `NEXT_PUBLIC_APP_URL` to the deployed URL. It is used for PayPal return links, and `NEXT_PUBLIC_SUPABASE_URL` feeds the CSP at build time, so **redeploy after changing either**.
4. `DEMO_MODE=true` if you want simulated prices for a demo.

`vercel.json` holds one daily cron as a backup. Hobby rejects anything more frequent.

## 5. GitHub Actions scheduler
Repo > Settings > Secrets and variables > Actions. Add `APP_URL`, `CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
Actions > Monitor prices > Run workflow, to test. It's scheduled every 30 minutes, but GitHub can run it hours late (about 6 hours apart when measured on 2026-11-06), and also pings Supabase so the free project doesn't pause.

## 6. Check the deployment
```bash
APP_URL=https://your-app.vercel.app npm run test:security -- --env
```
Needs `DEMO_MODE=true` on the target. Then rehearse by hand: sign up, assistant, track, Check now, simulate, prepare, approve as the sandbox buyer, confirm the capture, purchase history.

Demo user:
```bash
DEMO_USER_EMAIL=you@example.com DEMO_USER_PASSWORD=choose-one npm run seed:demo
```

## Troubleshooting
- The Profile page has a live PayPal check. It reports rejected keys, an unreachable or wrong address, or a missing `NEXT_PUBLIC_APP_URL`. Start there.
- "PayPal rejected this site's sandbox credentials": the client ID or secret in Vercel is wrong, or from Live rather than Sandbox. Redeploy after fixing it.
- "The merchant isn't able to accept PayPal payments" on PayPal's page: the sandbox business account can't receive payments. Create a new **United States** sandbox business account, create a new app linked to it, put its keys in Vercel, and redeploy.
- Never copy values from `.env.local-stack` into Vercel. They only work with the local emulator.
- Monitor workflow shows a "Skipped" warning: the GitHub secrets from step 5 aren't set.
- Any other PayPal error shows PayPal's code and reference on screen. It also appears in Vercel's logs as `paypal_create_failed`, and in the Supabase SQL Editor:
  `select failure_reason, created_at from paypal_orders where status = 'failed' order by created_at desc limit 5;`
- Home page has no categories: `0003_shopping.sql` hasn't been run.
- Signup shows "check your email": confirmation is on (step 1.3).
- Checkout says PayPal isn't configured: missing client ID or secret.
- App refuses to start, naming `PAYPAL_BASE_URL`: it isn't a sandbox URL. That is the guard working.
- Product page warns the scheduler is behind: check the Actions tab. Scheduled runs can be delayed.
