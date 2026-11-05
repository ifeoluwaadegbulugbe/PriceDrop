/**
 * Two-user RLS test. Runs real policies through supabase-js as real signed-in users.
 *
 *   npm run test:rls                     against an in-process emulator (real Postgres, real RLS)
 *   npm run test:rls -- --env            against NEXT_PUBLIC_SUPABASE_URL from .env.local
 *
 * The --env mode creates two throwaway users in that project and deletes them afterwards.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { ANON_KEY, SERVICE_KEY, startStack } from "./local/stack";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const useEnv = process.argv.includes("--env");
  let url: string, anon: string, service: string, stop = async () => {};
  if (useEnv) {
    config({ path: ".env.local" });
    url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (!url || !anon || !service) throw new Error("Supabase env vars missing from .env.local");
    console.log("Target: project from .env.local");
  } else {
    const stack = await startStack();
    url = stack.url; anon = ANON_KEY; service = SERVICE_KEY; stop = stack.close;
    console.log("Target: in-process emulator (real Postgres + real RLS)");
  }

  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, service, opts);
  const pw = randomUUID();
  const mk = async (tag: string) => {
    const email = `rls-${tag}-${randomUUID().slice(0, 8)}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
    if (error) throw error;
    const client = createClient(url, anon, opts);
    const si = await client.auth.signInWithPassword({ email, password: pw });
    if (si.error) throw si.error;
    return { id: data.user.id, client };
  };
  const a = await mk("a");
  const b = await mk("b");
  const anonClient = createClient(url, anon, opts);

  try {
    // Fixture for user A, written with the service role.
    const product = (await admin.from("products").insert({ source: "seed", external_id: `rls-${randomUUID()}`, title: "RLS item" }).select().single()).data!;
    const tracked = (await admin.from("tracked_products").insert({ user_id: a.id, product_id: product.id, target_price_cents: 100, max_total_cents: 200, currency: "USD" }).select().single()).data!;
    const obs = (await admin.from("price_observations").insert({ tracked_product_id: tracked.id, domain: "x.test", price_cents: 90, currency: "USD", source: "seed", is_baseline: true }).select().single()).data!;
    const alert = (await admin.from("deal_alerts").insert({ tracked_product_id: tracked.id, user_id: a.id, observation_id: obs.id, domain: "x.test", price_cents: 90, evaluation: {}, explanation: "x", explanation_source: "template" }).select().single()).data!;
    const notif = (await admin.from("notifications").insert({ user_id: a.id, kind: "deal_found", title: "t", body: "b" }).select().single()).data!;
    const order = (await admin.from("paypal_orders").insert({ user_id: a.id, deal_alert_id: alert.id, paypal_order_id: `RLS${randomUUID().slice(0, 8)}`, idempotency_key: randomUUID(), amount_cents: 90, currency: "USD", status: "payer_action_required", expires_at: new Date(Date.now() + 1e6).toISOString() }).select().single()).data!;
    const purchase = (await admin.from("purchases").insert({ user_id: a.id, paypal_order_row: order.id, product_id: product.id, retailer_domain: "x.test", amount_cents: 90, currency: "USD", paypal_order_id: order.paypal_order_id, paypal_capture_id: "CAP" }).select().single()).data!;

    const readable = async (c: SupabaseClient, table: string, col: string, val: unknown) => {
      const { data, error } = await c.from(table).select("*").eq(col, val as string);
      return error ? 0 : (data?.length ?? 0);
    };

    const owned: [string, string, unknown][] = [
      ["tracked_products", "id", tracked.id],
      ["price_observations", "id", obs.id],
      ["deal_alerts", "id", alert.id],
      ["notifications", "id", notif.id],
      ["paypal_orders", "id", order.id],
      ["purchases", "id", purchase.id],
    ];
    for (const [t, c, v] of owned) {
      check(`A can read own ${t}`, (await readable(a.client, t, c, v)) === 1);
      check(`B cannot read A's ${t}`, (await readable(b.client, t, c, v)) === 0);
      check(`anon cannot read ${t}`, (await readable(anonClient, t, c, v)) === 0);
    }
    check("B cannot read A's profile", (await readable(b.client, "profiles", "id", a.id)) === 0);
    check("signup trigger created profile", (await readable(a.client, "profiles", "id", a.id)) === 1);

    // B cannot modify A's rows. Updates either error or match zero rows, so verify state after.
    await b.client.from("tracked_products").update({ target_price_cents: 1 }).eq("id", tracked.id);
    const t1 = (await admin.from("tracked_products").select("target_price_cents").eq("id", tracked.id).single()).data!;
    check("B cannot update A's tracked_products", t1.target_price_cents === 100);
    await b.client.from("tracked_products").delete().eq("id", tracked.id);
    check("B cannot delete A's tracked_products", (await readable(admin, "tracked_products", "id", tracked.id)) === 1);
    await b.client.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", notif.id);
    const n1 = (await admin.from("notifications").select("read_at").eq("id", notif.id).single()).data!;
    check("B cannot mark A's notification read", n1.read_at === null);
    const stolen = await b.client.from("tracked_products").insert({ user_id: a.id, product_id: product.id, target_price_cents: 5, max_total_cents: 5 });
    check("B cannot insert tracked_products for A", !!stolen.error);

    // No client writes on server-only tables, even as the owner.
    const forbiddenInserts: [string, Record<string, unknown>][] = [
      ["deal_alerts", { tracked_product_id: tracked.id, user_id: a.id, observation_id: obs.id, domain: "evil.test", price_cents: 1, evaluation: {}, explanation: "x", explanation_source: "template" }],
      ["paypal_orders", { user_id: a.id, deal_alert_id: alert.id, idempotency_key: randomUUID(), amount_cents: 1, currency: "USD", status: "captured", expires_at: new Date().toISOString() }],
      ["purchases", { user_id: a.id, paypal_order_row: order.id, product_id: product.id, retailer_domain: "evil.test", amount_cents: 1, currency: "USD", paypal_order_id: "X", paypal_capture_id: "X" }],
      ["price_observations", { tracked_product_id: tracked.id, domain: "evil.test", price_cents: 1, currency: "USD", source: "seed" }],
      ["agent_activity", { user_id: a.id, agent: "purchase", action: "forged", status: "ok" }],
      ["webhook_events", { event_id: randomUUID(), event_type: "forged" }],
      ["products", { source: "seed", external_id: randomUUID(), title: "forged" }],
      ["notifications", { user_id: a.id, kind: "payment_status", title: "forged", body: "forged" }],
    ];
    for (const [t, row] of forbiddenInserts) {
      const { error } = await a.client.from(t).insert(row);
      check(`owner cannot insert into ${t}`, !!error);
    }
    const u1 = await a.client.from("paypal_orders").update({ amount_cents: 1 }).eq("id", order.id);
    const o1 = (await admin.from("paypal_orders").select("amount_cents").eq("id", order.id).single()).data!;
    check("owner cannot update paypal_orders", !!u1.error && o1.amount_cents === 90);
    const u2 = await a.client.from("deal_alerts").update({ status: "purchased" }).eq("id", alert.id);
    check("owner cannot update deal_alerts", !!u2.error);
    const u3 = await a.client.from("purchases").update({ amount_cents: 1 }).eq("id", purchase.id);
    check("owner cannot update purchases", !!u3.error);
    const d1 = await a.client.from("purchases").delete().eq("id", purchase.id);
    check("owner cannot delete purchases", !!d1.error && (await readable(admin, "purchases", "id", purchase.id)) === 1);

    // Column and status guards on the rows clients may touch.
    const fake = await a.client.from("tracked_products").update({ status: "purchased" }).eq("id", tracked.id);
    check("owner cannot self-mark tracked product purchased", !!fake.error);
    const col = await a.client.from("tracked_products").update({ last_checked_at: new Date().toISOString() }).eq("id", tracked.id);
    check("owner cannot forge last_checked_at", !!col.error);
    const nb = await a.client.from("notifications").update({ body: "forged" }).eq("id", notif.id);
    check("owner cannot rewrite notification body", !!nb.error);
    const ok1 = await a.client.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", notif.id);
    check("owner can mark own notification read", !ok1.error);
    const ok2 = await a.client.from("tracked_products").update({ status: "paused" }).eq("id", tracked.id);
    check("owner can pause own tracked product", !ok2.error);

    // Server-only functions and counters.
    const rpc = await a.client.rpc("finalize_capture", { p_order_row: order.id, p_capture_id: "X", p_amount_cents: 90, p_currency: "USD", p_retailer_domain: "x" });
    check("client cannot call finalize_capture", !!rpc.error);
    const rpc2 = await a.client.rpc("bump_counter", { p_key: "x", p_limit: 1 });
    check("client cannot call bump_counter", !!rpc2.error);
    const c1 = await a.client.from("usage_counters").select("*");
    check("client cannot read usage_counters", !!c1.error);

    // Shopping tables: saved items and recently viewed are private and server-written.
    await admin.from("saved_products").insert({ user_id: a.id, product_id: product.id });
    await admin.from("recently_viewed").insert({ user_id: a.id, product_id: product.id });
    for (const t of ["saved_products", "recently_viewed"]) {
      check(`A can read own ${t}`, (await readable(a.client, t, "user_id", a.id)) === 1);
      check(`B cannot read A's ${t}`, (await readable(b.client, t, "user_id", a.id)) === 0);
      check(`anon cannot read ${t}`, (await readable(anonClient, t, "user_id", a.id)) === 0);
      const w = await a.client.from(t).insert({ user_id: a.id, product_id: product.id });
      check(`owner cannot write ${t} directly`, !!w.error);
    }
    check("client cannot read discovery_cache", !!(await a.client.from("discovery_cache").select("*")).error);
    check("client cannot write discovery_cache", !!(await a.client.from("discovery_cache").insert({ key: "x", value: {} })).error);
    const cats = await a.client.from("categories").select("slug");
    check("signed-in user can read categories", !cats.error && (cats.data?.length ?? 0) > 12);
    check("anon cannot read categories", (await anonClient.from("categories").select("slug")).error !== null);
    check("client cannot write categories", !!(await a.client.from("categories").insert({ slug: "x", name: "x", search_query: "x" })).error);
    check("client cannot call trending_price_drops", !!(await a.client.rpc("trending_price_drops", { p_since: new Date().toISOString(), p_limit: 1, p_include_simulated: true })).error);
    check("client cannot call popular_products", !!(await a.client.rpc("popular_products", { p_min_users: 1, p_limit: 1 })).error);
    const own = await a.client.from("profiles").update({ interests: ["beauty"] }).eq("id", a.id);
    const saved = await admin.from("profiles").select("interests").eq("id", a.id).single();
    check("owner can update own interests", !own.error && saved.data?.interests?.[0] === "beauty");
    await b.client.from("profiles").update({ interests: ["forged"] }).eq("id", a.id);
    const after = await admin.from("profiles").select("interests").eq("id", a.id).single();
    check("B cannot change A's interests", after.data?.interests?.[0] === "beauty");

    // State machine trigger: captured is terminal. Run even with the service role.
    await admin.from("paypal_orders").update({ status: "expired" }).eq("id", order.id);
    const back = await admin.from("paypal_orders").update({ status: "approved" }).eq("id", order.id);
    check("illegal transition rejected by DB even for service role", !!back.error);

    // Cleanup for the --env target.
    await admin.from("saved_products").delete().eq("user_id", a.id);
    await admin.from("recently_viewed").delete().eq("user_id", a.id);
    await admin.from("purchases").delete().eq("id", purchase.id);
    await admin.from("tracked_products").delete().eq("id", tracked.id);
    await admin.from("products").delete().eq("id", product.id);
  } finally {
    await admin.auth.admin.deleteUser(a.id);
    await admin.auth.admin.deleteUser(b.id);
    await stop();
  }

  console.log(failures ? `\n${failures} FAILED` : "\nAll RLS checks passed");
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => {
  console.error("RLS test crashed:", e instanceof Error ? e.message : e);
  process.exitCode = 2;
});
