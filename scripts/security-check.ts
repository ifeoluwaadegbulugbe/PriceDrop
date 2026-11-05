/**
 * HTTP-level security checklist against a RUNNING app. Every route: no session, another user's IDs, tampered
 * amounts, expiry, replays.
 *
 *   npm run test:security -- --local      app + emulator (.env.local-stack); includes full capture replay
 *   npm run test:security -- --env        project in .env.local, APP_URL or NEXT_PUBLIC_APP_URL
 *
 * Needs DEMO_MODE=true on the target so a qualifying deal can be produced on demand.
 */
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

const local = !process.argv.includes("--env");
config({ path: local ? ".env.local-stack" : ".env.local" });

const APP = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const CRON = process.env.CRON_SECRET ?? "";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

const admin = createClient(SUPA, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

async function signedInCookie(tag: string) {
  const email = `sec-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const jar = new Map<string, string>();
  const client = createServerClient(SUPA, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (all) => all.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const si = await client.auth.signInWithPassword({ email, password });
  if (si.error) throw si.error;
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  await admin.from("profiles").update({ onboarded: true }).eq("id", data.user.id);
  return { id: data.user.id, cookie };
}

async function call(method: string, path: string, opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${APP}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...opts.headers,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> & { error?: { code?: string } } = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = {};
  }
  return { status: res.status, json, text, headers: res.headers };
}

const noLeak = (t: string) => !/stack|node_modules|supabase\.co|at async|SUPABASE_|service_role|PostgrestError|duplicate key/i.test(t);

async function main() {
  console.log(`Target app: ${APP} (${local ? "local emulator" : "env project"})`);
  const health = await fetch(APP).then((r) => r.status, () => 0);
  if (health !== 200) throw new Error(`App is not responding at ${APP}`);

  const A = await signedInCookie("a");
  const B = await signedInCookie("b");

  // Build A's state through the real routes.
  const track = await call("POST", "/api/tracking", {
    cookie: A.cookie,
    body: { source: "seed", externalId: "seed-sony-wh-ch520", targetPriceCents: 7500, maxTotalCents: 9000 },
  });
  check("A can create tracking", track.status === 201, `${track.status} ${track.text}`);
  const trackedId = String(track.json.id);
  const sim = await call("POST", "/api/demo/simulate-price", { cookie: A.cookie, body: { trackedProductId: trackedId, priceCents: 7000 } });
  check("A can simulate in demo mode", sim.status === 200, `${sim.status} ${sim.text}`);
  const { data: alerts } = await admin.from("deal_alerts").select("id").eq("tracked_product_id", trackedId);
  const alertId = String(alerts?.[0]?.id);
  const fakeId = randomUUID();

  // ---- No session -------------------------------------------------------------------------------
  const authed: [string, string, unknown?][] = [
    ["POST", "/api/assistant/intent", { prompt: "headphones under $90" }],
    ["GET", "/api/search?q=sony"],
    ["POST", "/api/tracking", { source: "seed", externalId: "seed-sony-wh-ch520", targetPriceCents: 1, maxTotalCents: 1 }],
    ["PATCH", `/api/tracking/${trackedId}`, { targetPriceCents: 1 }],
    ["DELETE", `/api/tracking/${trackedId}`],
    ["POST", `/api/tracking/${trackedId}/check`],
    ["POST", `/api/deals/${alertId}/explain`],
    ["POST", `/api/deals/${alertId}/dismiss`],
    ["POST", "/api/checkout/prepare", { alertId }],
    ["POST", "/api/checkout/capture", { orderId: fakeId }],
    ["POST", "/api/checkout/cancel", { orderId: fakeId }],
    ["POST", "/api/demo/simulate-price", { trackedProductId: trackedId, priceCents: 1 }],
  ];
  for (const [m, p, body] of authed) {
    const r = await call(m, p, { body });
    check(`no session: ${m} ${p.split("?")[0]!.replace(trackedId, ":id").replace(alertId, ":id")} is 401`, r.status === 401, String(r.status));
  }
  for (const page of ["/dashboard", "/purchases", `/deals/${alertId}`, `/products/${trackedId}`, "/settings"]) {
    const r = await call("GET", page);
    check(`no session: page ${page.split("/")[1]} redirects to login`, r.status === 307 && (r.headers.get("location") ?? "").includes("/login"), String(r.status));
  }

  // ---- Another user's IDs --------------------------------------------------------------------------
  const crossUser: [string, string, unknown?][] = [
    ["PATCH", `/api/tracking/${trackedId}`, { targetPriceCents: 1 }],
    ["DELETE", `/api/tracking/${trackedId}`],
    ["POST", `/api/tracking/${trackedId}/check`],
    ["POST", `/api/deals/${alertId}/explain`],
    ["POST", `/api/deals/${alertId}/dismiss`],
    ["POST", "/api/checkout/prepare", { alertId }],
    ["POST", "/api/demo/simulate-price", { trackedProductId: trackedId, priceCents: 1 }],
  ];
  for (const [m, p, body] of crossUser) {
    const r = await call(m, p, { cookie: B.cookie, body });
    check(`B with A's id: ${m} ${p.replace(trackedId, ":id").replace(alertId, ":id")} is 404`, r.status === 404, `${r.status} ${r.text}`);
  }
  for (const page of [`/deals/${alertId}`, `/products/${trackedId}`]) {
    const r = await call("GET", page, { cookie: B.cookie });
    check(`B sees nothing at A's ${page.split("/")[1]} page`, r.status === 404 || !r.text.includes("Sony WH-CH520"), String(r.status));
  }
  const after = await admin.from("tracked_products").select("target_price_cents,status").eq("id", trackedId).single();
  check("A's rules unchanged after B's attempts", after.data?.target_price_cents === 7500 && after.data?.status !== "removed");

  // ---- Tampered amounts and bad input ----------------------------------------------------------------
  const tampered: [string, string, unknown][] = [
    ["POST", "/api/checkout/prepare", { alertId, amount_cents: 1 }],
    ["POST", "/api/checkout/prepare", { alertId, amountCents: 1, currency: "USD" }],
    ["POST", "/api/checkout/capture", { orderId: fakeId, amount: "0.01" }],
    ["POST", "/api/checkout/cancel", { orderId: fakeId, status: "captured" }],
    ["POST", "/api/tracking", { source: "seed", externalId: "seed-sony-wh-ch520", targetPriceCents: 7500, maxTotalCents: 9000, priceCents: 1 }],
    ["POST", "/api/tracking", { source: "seed", externalId: "seed-sony-wh-ch520", targetPriceCents: 9500, maxTotalCents: 9000 }],
    ["POST", "/api/tracking", { source: "seed", externalId: "seed-sony-wh-ch520", targetPriceCents: 12.5, maxTotalCents: 9000 }],
    ["PATCH", `/api/tracking/${trackedId}`, { status: "purchased" }],
    ["PATCH", `/api/tracking/${trackedId}`, { user_id: B.id }],
    ["POST", "/api/checkout/prepare", { alertId: "'; drop table purchases; --" }],
    ["POST", "/api/assistant/intent", { prompt: "" }],
  ];
  for (const [m, p, body] of tampered) {
    const r = await call(m, p, { cookie: A.cookie, body });
    check(`tampered ${p.replace(trackedId, ":id")} ${JSON.stringify(body).slice(0, 60)} is 400`, r.status === 400, `${r.status} ${r.text}`);
    check("  no internals in the error", noLeak(r.text));
  }
  const badId = await call("POST", "/api/tracking/not-a-uuid/check", { cookie: A.cookie });
  check("malformed id is 400", badId.status === 400, String(badId.status));
  const notJson = await fetch(`${APP}/api/checkout/prepare`, { method: "POST", headers: { cookie: A.cookie, "content-type": "application/json" }, body: "{not json" });
  check("malformed JSON is 400", notJson.status === 400, String(notJson.status));

  // ---- Cron and webhook --------------------------------------------------------------------------
  check("cron without auth is 401", (await call("GET", "/api/cron/monitor")).status === 401);
  check("cron with wrong secret is 401", (await call("GET", "/api/cron/monitor", { headers: { authorization: "Bearer wrong" } })).status === 401);
  const cron = await call("GET", "/api/cron/monitor", { headers: { authorization: `Bearer ${CRON}` } });
  check("cron with secret is 200 with a summary", cron.status === 200 && typeof cron.json.checked === "number", `${cron.status} ${cron.text}`);
  const hook = await call("POST", "/api/paypal/webhook", { body: { id: "EV", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} } });
  check("webhook without a valid signature is rejected", hook.status === 401 || hook.status === 503, String(hook.status));

  // ---- Prepare and capture replays -----------------------------------------------------------------
  const prepares = await Promise.all([1, 2, 3].map(() => call("POST", "/api/checkout/prepare", { cookie: A.cookie, body: { alertId } })));
  const ids = new Set(prepares.map((r) => String(r.json.orderId)));
  check("triple-click prepare returns one order", ids.size === 1 && prepares.every((r) => r.status === 200), prepares.map((r) => `${r.status}`).join(","));
  const again = await call("POST", "/api/checkout/prepare", { cookie: A.cookie, body: { alertId } });
  check("prepare replay reuses it", again.json.reused === true && ids.has(String(again.json.orderId)));
  const { data: rows } = await admin.from("paypal_orders").select("*").eq("deal_alert_id", alertId);
  check("exactly one order row", rows?.length === 1);
  const orderId = String(rows?.[0]?.id);
  check("amount is server-computed ($70.00)", rows?.[0]?.amount_cents === 7000);

  const bCapture = await call("POST", "/api/checkout/capture", { cookie: B.cookie, body: { orderId } });
  check("B can't capture A's order", bCapture.status === 404, String(bCapture.status));
  const bCancel = await call("POST", "/api/checkout/cancel", { cookie: B.cookie, body: { orderId } });
  check("B can't cancel A's order", bCancel.status === 404, String(bCancel.status));

  const unapproved = await call("POST", "/api/checkout/capture", { cookie: A.cookie, body: { orderId } });
  check("capture before approval doesn't capture", unapproved.json.outcome === "awaiting_approval" && unapproved.json.purchaseId === null, unapproved.text);

  if (local) {
    const approveUrl = String(rows?.[0]?.approve_url).replace("/checkoutnow?", "/checkoutnow/approve?");
    await fetch(approveUrl, { method: "POST", redirect: "manual" });
    const captures = await Promise.all([1, 2, 3].map(() => call("POST", "/api/checkout/capture", { cookie: A.cookie, body: { orderId } })));
    check("triple-click capture all report captured", captures.every((r) => r.status === 200 && ["captured", "already_captured"].includes(String(r.json.outcome))), captures.map((r) => r.text).join(" | "));
    const replay = await call("POST", "/api/checkout/capture", { cookie: A.cookie, body: { orderId } });
    check("capture replay is idempotent", replay.json.outcome === "already_captured");
    const { data: purchases } = await admin.from("purchases").select("id").eq("paypal_order_row", orderId);
    check("exactly one purchase", purchases?.length === 1);
    const prepareBought = await call("POST", "/api/checkout/prepare", { cookie: A.cookie, body: { alertId } });
    check("can't prepare a purchased deal", prepareBought.status === 409, String(prepareBought.status));

    // Expiry: a second product, order forced past expiry.
    const t2 = await call("POST", "/api/tracking", { cookie: A.cookie, body: { source: "seed", externalId: "seed-anker-q30", targetPriceCents: 6000, maxTotalCents: 9000 } });
    await call("POST", "/api/demo/simulate-price", { cookie: A.cookie, body: { trackedProductId: t2.json.id, priceCents: 5000 } });
    const { data: a2 } = await admin.from("deal_alerts").select("id").eq("tracked_product_id", String(t2.json.id));
    const p2 = await call("POST", "/api/checkout/prepare", { cookie: A.cookie, body: { alertId: a2?.[0]?.id } });
    await admin.from("paypal_orders").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", String(p2.json.orderId));
    const expired = await call("POST", "/api/checkout/capture", { cookie: A.cookie, body: { orderId: p2.json.orderId } });
    check("capture after expiry is rejected", expired.status === 410, `${expired.status} ${expired.text}`);
    const { data: noPurchase } = await admin.from("purchases").select("id").eq("paypal_order_row", String(p2.json.orderId));
    check("no purchase from an expired order", noPurchase?.length === 0);
  } else {
    console.log("SKIP  full capture replay: needs a human approval in the real sandbox. Use the end-to-end rehearsal.");
  }

  // ---- Rate limit, headers ---------------------------------------------------------------------------
  const t3 = await call("POST", "/api/tracking", { cookie: B.cookie, body: { source: "seed", externalId: "seed-jbl-tune-770", targetPriceCents: 100, maxTotalCents: 200 } });
  const codes: number[] = [];
  for (let i = 0; i < 8; i++) codes.push((await call("POST", `/api/tracking/${t3.json.id}/check`, { cookie: B.cookie })).status);
  check("Check now is rate limited", codes.includes(429), codes.join(","));

  const home = await fetch(APP);
  const csp = home.headers.get("content-security-policy") ?? "";
  check("CSP present and frames denied", csp.includes("frame-ancestors 'none'") && csp.includes("default-src 'self'"));
  check("nosniff present", home.headers.get("x-content-type-options") === "nosniff");
  check("no x-powered-by", home.headers.get("x-powered-by") === null);

  await admin.auth.admin.deleteUser(A.id);
  await admin.auth.admin.deleteUser(B.id);
  console.log(failures ? `\n${failures} FAILED` : "\nAll security checks passed");
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => {
  console.error("Security check crashed:", e instanceof Error ? e.message : e);
  process.exitCode = 2;
});
