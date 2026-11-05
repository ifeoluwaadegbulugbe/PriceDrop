/**
 * Creates a demo user with tracked products and a labelled history.
 *   DEMO_USER_EMAIL=... DEMO_USER_PASSWORD=... npm run seed:demo
 * Uses .env.local, or the file named by --env=...
 *
 * Backdated rows are stored with source 'demo_simulation', so the UI labels them as simulated.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import type { Deps } from "../src/lib/deps";
import { checkTracked } from "../src/lib/monitor/check";
import { createTracking } from "../src/lib/tracking/service";

const envArg = process.argv.find((a) => a.startsWith("--env="));
config({ path: envArg ? envArg.split("=")[1] : ".env.local" });

const DAY = 86400 * 1000;

const PRODUCTS = [
  { externalId: "seed-sony-wh-ch520", targetPriceCents: 7500, maxTotalCents: 9000, history: [8999, 8799, 8499, 8199] },
  { externalId: "seed-apple-macbook-air-13", targetPriceCents: 92900, maxTotalCents: 99900, history: [109900, 104900, 102900, 101900] },
  { externalId: "seed-nike-pegasus-41", targetPriceCents: 11000, maxTotalCents: 13000, history: [14995, 14495, 13995, 13495] },
];

async function main() {
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, DEMO_USER_EMAIL: email, DEMO_USER_PASSWORD: password } = process.env;
  if (!url || !key) throw new Error("Supabase env vars are missing.");
  if (!email || !password) throw new Error("Set DEMO_USER_EMAIL and DEMO_USER_PASSWORD. This script won't invent or print credentials.");

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  let userId = created.data.user?.id;
  if (!userId) {
    const { data } = await db.auth.admin.listUsers();
    userId = data?.users.find((u) => u.email === email)?.id;
    if (!userId) throw new Error(`Couldn't create or find the demo user: ${created.error?.message}`);
  }
  await db.from("profiles").update({ onboarded: true, display_name: "Demo" }).eq("id", userId);

  const deps: Deps = {
    db,
    channel3: null,
    paypal: null,
    callLlm: async () => null,
    channel3Budget: 0,
    demoMode: true,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    now: () => new Date(),
  };

  for (const p of PRODUCTS) {
    // First the backdated, labelled rows, so the real seed price below is the latest observation.
    const { tracked } = await createTrackingWithHistory(deps, userId, p);
    await checkTracked(deps, tracked, { trigger: "baseline" });
    console.log(`Tracked ${p.externalId}`);
  }
  console.log("Demo data ready. Log in and use 'Try a price change' on a product (needs DEMO_MODE=true).");
}

async function createTrackingWithHistory(deps: Deps, userId: string, p: (typeof PRODUCTS)[number]) {
  const result = await createTracking(deps, userId, {
    source: "seed",
    externalId: p.externalId,
    targetPriceCents: p.targetPriceCents,
    maxTotalCents: p.maxTotalCents,
    allowedDomains: [],
    allowedVariants: null,
    requireInStock: true,
  });
  const { data: first } = await deps.db
    .from("price_observations")
    .select("domain,currency,shipping_cents,in_stock")
    .eq("tracked_product_id", result.tracked.id)
    .order("price_cents", { ascending: true })
    .limit(1);
  const base = first?.[0];
  if (base) {
    const rows = p.history.map((price_cents, i) => ({
      tracked_product_id: result.tracked.id,
      domain: base.domain,
      price_cents,
      shipping_cents: base.shipping_cents,
      currency: base.currency,
      in_stock: base.in_stock,
      source: "demo_simulation",
      is_baseline: false,
      observed_at: new Date(Date.now() - (p.history.length - i) * DAY).toISOString(),
    }));
    await deps.db.from("price_observations").insert(rows);
  }
  return result;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
