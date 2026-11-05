/**
 * Services end to end against the emulator: real Postgres, real RLS, real supabase-js, the real PayPal client
 * talking to the fake PayPal. Proves our logic. Does not prove real PayPal behaves like the fake.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { cancelCheckout, captureCheckout, handleWebhookEvent, prepareCheckout, reconcileOrders } from "@/lib/checkout/service";
import type { AlertRow, ObservationRow, OrderRow, PurchaseRow, TrackedRow } from "@/lib/db/types";
import type { Deps } from "@/lib/deps";
import { checkTracked } from "@/lib/monitor/check";
import { runMonitor } from "@/lib/monitor/job";
import { createPaypalClient } from "@/lib/paypal/client";
import { createTracking, loadOwnedTracked, simulatePrice, updateTracking } from "@/lib/tracking/service";
import { searchCatalogue } from "@/lib/catalogue";
import { SERVICE_KEY, startStack, type Stack } from "../scripts/local/stack";

let stack: Stack;
let db: SupabaseClient;
let deps: Deps;
let clock = new Date("2026-11-05T12:00:00Z");
const advance = (ms: number) => { clock = new Date(clock.getTime() + ms); };

const seed = { source: "seed" as const, externalId: "seed-sony-wh-ch520", allowedDomains: [], allowedVariants: null, requireInStock: true };

async function newUser(): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({ email: `u-${randomUUID()}@example.com`, password: "pw-123456", email_confirm: true });
  if (error) throw error;
  return data.user.id;
}

/** Tracks a product, then simulates a drop. Returns the alert it created. */
async function dealFor(userId: string, priceCents = 7000): Promise<{ tracked: TrackedRow; alert: AlertRow }> {
  const { tracked } = await createTracking(deps, userId, { ...seed, targetPriceCents: 7500, maxTotalCents: 9000 });
  advance(1000);
  const r = await simulatePrice(deps, userId, tracked.id, priceCents);
  expect(r.alertsCreated).toBe(1);
  const { data } = await db.from("deal_alerts").select("*").eq("tracked_product_id", tracked.id).eq("status", "open");
  return { tracked, alert: data![0] as AlertRow };
}

const code = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof ApiError ? e.code : `other:${e}`));

beforeAll(async () => {
  stack = await startStack();
  db = createClient(stack.url, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
});
afterAll(async () => stack.close());

beforeEach(() => {
  deps = {
    db,
    channel3: null,
    paypal: createPaypalClient({ clientId: "x", clientSecret: "y", baseUrl: `${stack.url}/paypal-sandbox` }),
    callLlm: async () => null,
    channel3Budget: 2,
    demoMode: true,
    appUrl: "http://localhost:3000",
    now: () => clock,
  };
  stack.paypal.nextCaptureStatus = null;
});

describe("tracking and baseline", () => {
  it("records real baseline observations and never calls a first price a drop", async () => {
    const user = await newUser();
    const { tracked, check } = await createTracking(deps, user, { ...seed, targetPriceCents: 7000, maxTotalCents: 9000 });
    expect(check.status).toBe("ok");
    expect(check.observationsWritten).toBe(2);
    const { data } = await db.from("price_observations").select("*").eq("tracked_product_id", tracked.id);
    const obs = data as ObservationRow[];
    expect(obs.every((o) => o.is_baseline && o.source === "seed")).toBe(true);
    expect(tracked.last_checked_at).not.toBeNull();
    const { data: alerts } = await db.from("deal_alerts").select("id").eq("tracked_product_id", tracked.id);
    expect(alerts).toEqual([]);
  });

  it("a baseline that already qualifies says first observed", async () => {
    const user = await newUser();
    const { tracked } = await createTracking(deps, user, { ...seed, targetPriceCents: 8000, maxTotalCents: 9000 });
    const { data } = await db.from("deal_alerts").select("*").eq("tracked_product_id", tracked.id);
    const a = data![0] as AlertRow;
    expect(a.previous_price_cents).toBeNull();
    expect(a.evaluation.isGenuineChange).toBe(false);
    expect(a.explanation).toMatch(/first price/);
    expect(tracked.status).toBe("deal_found");
  });

  it("dedupes identical checks under 6 hours and records one after", async () => {
    const user = await newUser();
    const { tracked } = await createTracking(deps, user, { ...seed, targetPriceCents: 7000, maxTotalCents: 9000 });
    advance(60_000);
    expect((await checkTracked(deps, tracked, { trigger: "user" })).observationsWritten).toBe(0);
    advance(6 * 3600 * 1000 + 1000);
    expect((await checkTracked(deps, tracked, { trigger: "user" })).observationsWritten).toBe(2);
    const { data } = await db.from("price_observations").select("is_baseline").eq("tracked_product_id", tracked.id).eq("is_baseline", false);
    expect(data!.length).toBe(2);
  });

  it("a source failure records nothing and says so", async () => {
    const user = await newUser();
    const { tracked } = await createTracking(deps, user, { ...seed, targetPriceCents: 7000, maxTotalCents: 9000 });
    const failing: Deps = { ...deps, channel3: { search: async () => [], retrieve: async () => { throw new Error("down"); } } };
    const { data: fakeProduct } = await db.from("products").insert({ source: "channel3", external_id: `x-${randomUUID()}`, title: "c3" }).select().single();
    const { data: t2 } = await db.from("tracked_products").insert({ user_id: user, product_id: fakeProduct!.id, target_price_cents: 100, max_total_cents: 100 }).select().single();
    const r = await checkTracked(failing, t2 as TrackedRow, { trigger: "monitor" });
    expect(r.status).toBe("source_unavailable");
    const { data } = await db.from("price_observations").select("id").eq("tracked_product_id", t2!.id);
    expect(data).toEqual([]);
    expect(tracked.id).toBeTruthy();
  });

  it("rule edits are ownership checked and validated", async () => {
    const a = await newUser();
    const b = await newUser();
    const { tracked } = await createTracking(deps, a, { ...seed, targetPriceCents: 7000, maxTotalCents: 9000 });
    expect(await code(updateTracking(deps, b, tracked.id, { targetPriceCents: 1 }))).toBe("not_found");
    expect(await code(updateTracking(deps, a, tracked.id, { targetPriceCents: 9999 }))).toBe("target_above_max");
    expect(await code(loadOwnedTracked(deps, b, tracked.id))).toBe("not_found");
  });
});

describe("demo simulation goes through the same pipeline", () => {
  it("creates a labelled alert with a true previous price", async () => {
    const user = await newUser();
    const { tracked, alert } = await dealFor(user);
    expect(alert.previous_price_cents).toBe(7999);
    expect(alert.evaluation.isGenuineChange).toBe(true);
    expect(alert.evaluation.savingsVsPreviousCents).toBe(999);
    const { data: o } = await db.from("price_observations").select("*").eq("id", alert.observation_id).single();
    expect((o as ObservationRow).source).toBe("demo_simulation");
    const { data: n } = await db.from("notifications").select("*").eq("user_id", user).eq("kind", "deal_found");
    expect(n![0].title).toContain("Demo simulation");
    const t = await loadOwnedTracked(deps, user, tracked.id);
    expect(t.status).toBe("deal_found");
  });

  it("simulates at the cheapest in-stock retailer, skipping a cheaper out-of-stock one", async () => {
    const user = await newUser();
    const { tracked } = await createTracking(deps, user, { ...seed, externalId: "seed-asus-zenbook-14", targetPriceCents: 70000, maxTotalCents: 90000 });
    advance(1000);
    const r = await simulatePrice(deps, user, tracked.id, 65000);
    expect(r.alertsCreated).toBe(1);
    const { data } = await db.from("deal_alerts").select("domain").eq("tracked_product_id", tracked.id);
    expect(data![0].domain).toBe("lumen-market.example");
  });

  it("does not exist outside demo mode", async () => {
    const user = await newUser();
    const { tracked } = await createTracking(deps, user, { ...seed, targetPriceCents: 7000, maxTotalCents: 9000 });
    expect(await code(simulatePrice({ ...deps, demoMode: false }, user, tracked.id, 100))).toBe("not_found");
  });

  it("at most one open alert; a later lower price refreshes it", async () => {
    const user = await newUser();
    const { tracked, alert } = await dealFor(user, 7000);
    advance(1000);
    expect((await simulatePrice(deps, user, tracked.id, 7000)).alertsCreated).toBe(0);
    advance(1000);
    await simulatePrice(deps, user, tracked.id, 6000);
    const { data } = await db.from("deal_alerts").select("*").eq("tracked_product_id", tracked.id);
    expect(data!.length).toBe(1);
    expect((data![0] as AlertRow).id).toBe(alert.id);
    expect((data![0] as AlertRow).price_cents).toBe(6000);
  });

  it("an open alert expires when the simulation ends and the price is back above target", async () => {
    const user = await newUser();
    const { tracked, alert } = await dealFor(user);
    advance(2 * 3600 * 1000 + 1000);
    const t = await loadOwnedTracked(deps, user, tracked.id);
    const r = await checkTracked(deps, t, { trigger: "monitor" });
    expect(r.alertsExpired).toBe(1);
    const { data } = await db.from("deal_alerts").select("status").eq("id", alert.id).single();
    expect(data!.status).toBe("expired");
    expect((await loadOwnedTracked(deps, user, tracked.id)).status).toBe("active");
  });
});

describe("checkout", () => {
  async function ready(user: string) {
    const { tracked, alert } = await dealFor(user);
    const { order } = await prepareCheckout(deps, user, alert.id);
    return { tracked, alert, order };
  }

  it("prepare computes the amount itself, creates a real order, marks the alert", async () => {
    const user = await newUser();
    const { alert, order } = await ready(user);
    expect(order.status).toBe("payer_action_required");
    expect(order.amount_cents).toBe(7000); // simulated price plus $0.00 known shipping
    expect(order.approve_url).toContain("checkoutnow");
    expect(stack.paypal.orders.get(order.paypal_order_id!)!.purchase_units[0]!.amount.value).toBe("70.00");
    const { data } = await db.from("deal_alerts").select("status").eq("id", alert.id).single();
    expect(data!.status).toBe("checkout_prepared");
  });

  it("prepare replay and concurrent double-click create exactly one order", async () => {
    const user = await newUser();
    const { alert } = await dealFor(user);
    const before = stack.paypal.createCalls;
    const results = await Promise.all([1, 2, 3, 4].map(() => prepareCheckout(deps, user, alert.id)));
    const again = await prepareCheckout(deps, user, alert.id);
    expect(new Set([...results, { order: again.order }].map((r) => r.order.id)).size).toBe(1);
    expect(stack.paypal.createCalls - before).toBe(1);
    const { data } = await db.from("paypal_orders").select("id").eq("deal_alert_id", alert.id);
    expect(data!.length).toBe(1);
  });

  it("prepare refuses another user's alert", async () => {
    const a = await newUser();
    const b = await newUser();
    const { alert } = await dealFor(a);
    expect(await code(prepareCheckout(deps, b, alert.id))).toBe("not_found");
    expect(await code(prepareCheckout(deps, b, randomUUID()))).toBe("not_found");
  });

  it("prepare re-evaluates live: if the deal is gone, no order and the alert expires", async () => {
    const user = await newUser();
    const { alert } = await dealFor(user);
    advance(2 * 3600 * 1000 + 1000); // simulation over, seed price above target
    const before = stack.paypal.createCalls;
    expect(await code(prepareCheckout(deps, user, alert.id))).toBe("deal_no_longer_qualifies");
    expect(stack.paypal.createCalls).toBe(before);
    const { data } = await db.from("deal_alerts").select("status").eq("id", alert.id).single();
    expect(data!.status).toBe("expired");
  });

  it("prepare without PayPal configured says so", async () => {
    const user = await newUser();
    const { alert } = await dealFor(user);
    expect(await code(prepareCheckout({ ...deps, paypal: null }, user, alert.id))).toBe("paypal_not_configured");
  });

  it("no capture without the buyer's approval, and nothing is recorded", async () => {
    const user = await newUser();
    const { order } = await ready(user);
    const calls = stack.paypal.captureCalls;
    const r = await captureCheckout(deps, user, order.id);
    expect(r.outcome).toBe("awaiting_approval");
    expect(stack.paypal.captureCalls).toBe(calls);
    const { data } = await db.from("purchases").select("id").eq("paypal_order_row", order.id);
    expect(data).toEqual([]);
  });

  it("approved then captured: one purchase, everything updated", async () => {
    const user = await newUser();
    const { tracked, alert, order } = await ready(user);
    stack.paypal.approve(order.paypal_order_id!);
    const r = await captureCheckout(deps, user, order.id);
    expect(r.outcome).toBe("captured");
    expect(r.order.status).toBe("captured");
    expect(r.purchase).toMatchObject({ amount_cents: 7000, is_sandbox: true, paypal_order_id: order.paypal_order_id, retailer_domain: alert.domain });
    expect(r.purchase!.paypal_capture_id).toBeTruthy();
    expect((await db.from("deal_alerts").select("status").eq("id", alert.id).single()).data!.status).toBe("purchased");
    expect((await db.from("tracked_products").select("status").eq("id", tracked.id).single()).data!.status).toBe("purchased");
    const { data: n } = await db.from("notifications").select("*").eq("user_id", user).eq("kind", "payment_status");
    expect(n!.length).toBe(1);
  });

  it("double-click and replay on capture make exactly one purchase and one PayPal capture", async () => {
    const user = await newUser();
    const { order } = await ready(user);
    stack.paypal.approve(order.paypal_order_id!);
    const calls = stack.paypal.captureCalls;
    const results = await Promise.all([1, 2, 3].map(() => captureCheckout(deps, user, order.id)));
    const replay = await captureCheckout(deps, user, order.id);
    expect(results.filter((r) => r.outcome === "captured").length).toBeGreaterThanOrEqual(1);
    expect(replay.outcome).toBe("already_captured");
    expect(stack.paypal.captureCalls - calls).toBe(1);
    const { data } = await db.from("purchases").select("*").eq("paypal_order_row", order.id);
    expect((data as PurchaseRow[]).length).toBe(1);
  });

  it("capture refuses another user", async () => {
    const a = await newUser();
    const b = await newUser();
    const { order } = await ready(a);
    stack.paypal.approve(order.paypal_order_id!);
    expect(await code(captureCheckout(deps, b, order.id))).toBe("not_found");
    expect((await db.from("paypal_orders").select("status").eq("id", order.id).single()).data!.status).toBe("payer_action_required");
  });

  it("capture after expiry is refused even if PayPal approved, and marks expired", async () => {
    const user = await newUser();
    const { order, alert } = await ready(user);
    stack.paypal.approve(order.paypal_order_id!);
    advance(31 * 60 * 1000);
    const calls = stack.paypal.captureCalls;
    expect(await code(captureCheckout(deps, user, order.id))).toBe("order_expired");
    expect(stack.paypal.captureCalls).toBe(calls);
    expect((await db.from("paypal_orders").select("status").eq("id", order.id).single()).data!.status).toBe("expired");
    expect((await db.from("deal_alerts").select("status").eq("id", alert.id).single()).data!.status).toBe("open");
    expect(await code(captureCheckout(deps, user, order.id))).toBe("order_expired");
  });

  it("a tampered PayPal amount is never captured", async () => {
    const user = await newUser();
    const { order } = await ready(user);
    const remote = stack.paypal.orders.get(order.paypal_order_id!)!;
    remote.status = "APPROVED";
    remote.purchase_units[0]!.amount.value = "1.00";
    const calls = stack.paypal.captureCalls;
    const r = await captureCheckout(deps, user, order.id);
    expect(r.outcome).toBe("failed");
    expect(r.order.status).toBe("failed");
    expect(r.order.failure_reason).toBe("amount_mismatch");
    expect(stack.paypal.captureCalls).toBe(calls);
    expect((await db.from("purchases").select("id").eq("paypal_order_row", order.id)).data).toEqual([]);
  });

  it("DECLINED records the truth: no purchase, order failed, deal back open", async () => {
    const user = await newUser();
    const { order, alert } = await ready(user);
    stack.paypal.approve(order.paypal_order_id!);
    stack.paypal.nextCaptureStatus = "DECLINED";
    const r = await captureCheckout(deps, user, order.id);
    expect(r.outcome).toBe("declined");
    expect(r.order.status).toBe("failed");
    expect(r.purchase).toBeNull();
    expect((await db.from("purchases").select("id").eq("paypal_order_row", order.id)).data).toEqual([]);
    expect((await db.from("deal_alerts").select("status").eq("id", alert.id).single()).data!.status).toBe("open");
  });

  it("PENDING is not a purchase", async () => {
    const user = await newUser();
    const { order } = await ready(user);
    stack.paypal.approve(order.paypal_order_id!);
    stack.paypal.nextCaptureStatus = "PENDING";
    const r = await captureCheckout(deps, user, order.id);
    expect(r.outcome).toBe("pending");
    expect(r.order.status).toBe("approved");
    expect(r.order.failure_reason).toBe("capture_pending");
    expect((await db.from("purchases").select("id").eq("paypal_order_row", order.id)).data).toEqual([]);
  });

  it("after a failed order, a new prepare makes a new order with a new key", async () => {
    const user = await newUser();
    const { order, alert } = await ready(user);
    stack.paypal.approve(order.paypal_order_id!);
    stack.paypal.nextCaptureStatus = "DECLINED";
    await captureCheckout(deps, user, order.id);
    const second = await prepareCheckout(deps, user, alert.id);
    expect(second.reused).toBe(false);
    expect(second.order.id).not.toBe(order.id);
    expect(second.order.idempotency_key).not.toBe(order.idempotency_key);
  });

  it("cancel releases the deal and is owner-only", async () => {
    const a = await newUser();
    const b = await newUser();
    const { order, alert } = await ready(a);
    expect(await code(cancelCheckout(deps, b, order.id))).toBe("not_found");
    expect((await cancelCheckout(deps, a, order.id)).status).toBe("cancelled");
    expect((await db.from("deal_alerts").select("status").eq("id", alert.id).single()).data!.status).toBe("open");
    expect(await code(captureCheckout(deps, a, order.id))).toBe("order_cancelled");
  });
});

describe("reconcile", () => {
  it("expires old orders and never captures", async () => {
    const user = await newUser();
    const { alert } = await dealFor(user);
    const { order } = await prepareCheckout(deps, user, alert.id);
    advance(31 * 60 * 1000);
    const calls = stack.paypal.captureCalls;
    await reconcileOrders(deps);
    expect(stack.paypal.captureCalls).toBe(calls);
    expect((await db.from("paypal_orders").select("status").eq("id", order.id).single()).data!.status).toBe("expired");
  });

  it("marks approved but does not capture", async () => {
    const user = await newUser();
    const { alert } = await dealFor(user);
    const { order } = await prepareCheckout(deps, user, alert.id);
    stack.paypal.approve(order.paypal_order_id!);
    advance(11 * 60 * 1000);
    const calls = stack.paypal.captureCalls;
    await reconcileOrders(deps);
    expect(stack.paypal.captureCalls).toBe(calls);
    expect((await db.from("paypal_orders").select("status").eq("id", order.id).single()).data!.status).toBe("approved");
  });

  it("recovers a capture PayPal completed that we never recorded", async () => {
    const user = await newUser();
    const { alert } = await dealFor(user);
    const { order } = await prepareCheckout(deps, user, alert.id);
    const remote = stack.paypal.orders.get(order.paypal_order_id!)!;
    remote.status = "COMPLETED";
    remote.purchase_units[0]!.payments = { captures: [{ id: "CAPLOST", status: "COMPLETED", amount: remote.purchase_units[0]!.amount }] };
    advance(11 * 60 * 1000);
    await reconcileOrders(deps);
    const { data } = await db.from("purchases").select("*").eq("paypal_order_row", order.id);
    expect((data![0] as PurchaseRow).paypal_capture_id).toBe("CAPLOST");
  });
});

describe("webhook", () => {
  it("dedupes, ignores unknown events, and trusts GET order over the body", async () => {
    const user = await newUser();
    const { alert } = await dealFor(user);
    const { order } = await prepareCheckout(deps, user, alert.id);
    stack.paypal.approve(order.paypal_order_id!);
    const event = { id: `EV-${randomUUID()}`, event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: order.paypal_order_id, amount: { value: "0.01" } } };
    expect(await handleWebhookEvent(deps, event)).toBe("processed");
    expect((await db.from("paypal_orders").select("status,amount_cents").eq("id", order.id).single()).data).toEqual({ status: "approved", amount_cents: 7000 });
    expect(await handleWebhookEvent(deps, event)).toBe("duplicate");
    expect(await handleWebhookEvent(deps, { id: `EV-${randomUUID()}`, event_type: "BILLING.OTHER" })).toBe("processed");
    expect(await handleWebhookEvent(deps, { event_type: "X" })).toBe("ignored");
  });

  it("a forged COMPLETED event can't create a purchase: PayPal's GET order decides", async () => {
    const user = await newUser();
    const { alert } = await dealFor(user);
    const { order } = await prepareCheckout(deps, user, alert.id);
    await handleWebhookEvent(deps, {
      id: `EV-${randomUUID()}`,
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "FORGED", status: "COMPLETED", supplementary_data: { related_ids: { order_id: order.paypal_order_id } } },
    });
    expect((await db.from("purchases").select("id").eq("paypal_order_row", order.id)).data).toEqual([]);
  });

  it("refund marks the purchase only when PayPal confirms it", async () => {
    const user = await newUser();
    const { alert } = await dealFor(user);
    const { order } = await prepareCheckout(deps, user, alert.id);
    stack.paypal.approve(order.paypal_order_id!);
    await captureCheckout(deps, user, order.id);
    const refundEvent = () => ({ id: `EV-${randomUUID()}`, event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { supplementary_data: { related_ids: { order_id: order.paypal_order_id } } } });
    await handleWebhookEvent(deps, refundEvent());
    expect((await db.from("purchases").select("refunded_at").eq("paypal_order_row", order.id).single()).data!.refunded_at).toBeNull();
    const remote = stack.paypal.orders.get(order.paypal_order_id!)!;
    (remote.purchase_units[0]!.payments as { captures: { status: string }[] }).captures[0]!.status = "REFUNDED";
    await handleWebhookEvent(deps, refundEvent());
    expect((await db.from("purchases").select("refunded_at").eq("paypal_order_row", order.id).single()).data!.refunded_at).not.toBeNull();
  });
});

describe("monitor job", () => {
  it("one failing item doesn't abort the batch, and it summarises truthfully", async () => {
    const user = await newUser();
    await createTracking(deps, user, { ...seed, targetPriceCents: 7000, maxTotalCents: 9000 });
    const { data: bad } = await db.from("products").insert({ source: "channel3", external_id: `x-${randomUUID()}`, title: "bad" }).select().single();
    await db.from("tracked_products").insert({ user_id: user, product_id: bad!.id, target_price_cents: 100, max_total_cents: 100 });
    advance(60_000);
    const s = await runMonitor({ ...deps, channel3: null });
    expect(s.checked).toBeGreaterThanOrEqual(2);
    expect(s.failed).toBeGreaterThanOrEqual(1);
    expect(s.ok).toBeGreaterThanOrEqual(1);
  });
});

describe("catalogue budget guard", () => {
  it("falls back to the labelled seed with the reason, and counts paid calls", async () => {
    const paid = { calls: 0 };
    const gateway = {
      async search() { paid.calls++; return []; },
      async retrieve() { throw new Error("n/a"); },
    };
    const when = new Date("2031-01-15T00:00:00Z");
    const d: Deps = { ...deps, channel3: gateway, channel3Budget: 2, now: () => when };
    expect((await searchCatalogue(d, "sony", {})).source).toBe("channel3");
    expect((await searchCatalogue(d, "sony", {})).source).toBe("channel3");
    const third = await searchCatalogue(d, "sony", {});
    expect(third).toMatchObject({ source: "seed", fallbackReason: "budget_exhausted" });
    expect(paid.calls).toBe(2);
    expect((await searchCatalogue({ ...deps, channel3: null }, "sony headphones", {})).fallbackReason).toBe("no_api_key");
    const failing = await searchCatalogue({ ...d, channel3: { ...gateway, search: async () => { throw new Error("x"); } }, now: () => new Date("2032-01-01") }, "sony", {});
    expect(failing).toMatchObject({ source: "seed", fallbackReason: "api_error" });
  });

  it("seed search with filters", async () => {
    const r = await searchCatalogue({ ...deps, channel3: null }, "headphones", { brand: "Sony", maxCents: 15000 });
    expect(r.products.map((p) => p.id).sort()).toEqual(["seed-sony-wh-ch520", "seed-sony-wh-ch720n"]);
  });
});

export type { OrderRow };
