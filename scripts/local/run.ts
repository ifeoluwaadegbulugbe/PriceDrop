/**
 * Starts the local emulator on port 54321 and writes .env.local-stack for the app to use:
 *   npm run local:stack
 *   npm run dev:local        (in another terminal)
 * All values are local throwaways. The emulator is never deployed.
 */
import { writeFileSync } from "node:fs";
import { ANON_KEY, SERVICE_KEY, startStack } from "./stack";

const PORT = 54321;

async function main() {
  const stack = await startStack(PORT);
  writeFileSync(
    ".env.local-stack",
    [
      `NEXT_PUBLIC_SUPABASE_URL=${stack.url}`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}`,
      `SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}`,
      "NEXT_PUBLIC_APP_URL=http://localhost:3000",
      "PAYPAL_CLIENT_ID=local-emulator",
      "PAYPAL_CLIENT_SECRET=local-emulator",
      `PAYPAL_BASE_URL=${stack.url}/paypal-sandbox`,
      "PAYPAL_WEBHOOK_ID=local-emulator",
      "CRON_SECRET=local-emulator-cron-secret",
      "DEMO_MODE=true",
      "LLM_ENABLED=false",
      "",
    ].join("\n"),
  );
  console.log(`Local emulator on ${stack.url}. Wrote .env.local-stack. This is NOT real Supabase or PayPal.`);
}

void main();
