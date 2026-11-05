/**
 * Talks to the PayPal sandbox with the real client. Prints statuses and IDs, never credentials.
 *   npm run paypal:smoke                    token, create $1.00 order, get order; prints the approval link
 *   npm run paypal:smoke -- --capture ID    capture an order you approved in the browser
 * Uses .env.local, or the file named by --env=...
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createPaypalClient, PaypalError } from "../src/lib/paypal/client";

const envArg = process.argv.find((a) => a.startsWith("--env="));
config({ path: envArg ? envArg.split("=")[1] : ".env.local" });

async function main() {
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_BASE_URL } = process.env;
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    console.log("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET aren't set. Nothing was run.");
    process.exitCode = 1;
    return;
  }
  const client = createPaypalClient({
    clientId: PAYPAL_CLIENT_ID,
    clientSecret: PAYPAL_CLIENT_SECRET,
    baseUrl: PAYPAL_BASE_URL || undefined,
    allowLive: false,
  });

  const captureIdx = process.argv.indexOf("--capture");
  if (captureIdx !== -1) {
    const id = process.argv[captureIdx + 1] ?? "";
    const before = await client.getOrder(id);
    console.log(`Order ${before.id}: ${before.status}`);
    const after = await client.captureOrder(id, randomUUID());
    console.log(`After capture: ${after.status}`, after.captures);
    return;
  }

  const created = await client.createOrder({
    amountCents: 100,
    currency: "USD",
    requestId: randomUUID(),
    returnUrl: "https://example.com/return",
    cancelUrl: "https://example.com/cancel",
    customId: "smoke-test",
  });
  console.log(`Token OK. Created order ${created.id}: ${created.status}`);
  const got = await client.getOrder(created.id);
  console.log(`GET order: ${got.status}, amount ${got.amountCents} ${got.currency}`);
  console.log(`Approve as a sandbox buyer: ${created.payerActionUrl}`);
  console.log(`Then run: npm run paypal:smoke -- --capture ${created.id}`);
}

main().catch((e) => {
  if (e instanceof PaypalError) console.error(`PayPal said: ${e.status} ${e.paypalName} ${e.issue ?? ""} debug_id=${e.debugId ?? "none"}`);
  else console.error(e instanceof Error ? e.message : "Failed");
  process.exitCode = 1;
});
