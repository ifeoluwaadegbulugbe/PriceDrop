import { createHash } from "node:crypto";
import { logActivity, notify } from "@/lib/activity";
import { ApiError, notFound } from "@/lib/api/errors";
import { fetchProductCard } from "@/lib/catalogue";
import type { AlertRow, OrderRow, OrderStatus, ProductRow, PurchaseRow, TrackedRow } from "@/lib/db/types";
import type { Deps } from "@/lib/deps";
import { upsertProduct } from "@/lib/discovery/service";
import { evaluateDeal, normalizeDomain, type Evaluation } from "@/lib/evaluation/evaluate";
import { currentOffers, latestObservation, rulesOf } from "@/lib/monitor/check";
import { networkReason, PaypalError, type PaypalApi, type PaypalOrder } from "@/lib/paypal/client";
import { assertTransition, LIVE_STATUSES } from "./stateMachine";

const ORDER_TTL_MS = 30 * 60 * 1000;
const RECONCILE_AFTER_MS = 10 * 60 * 1000;
const CREATING_STALE_MS = 60 * 1000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function requirePaypal(deps: Deps): PaypalApi {
  if (!deps.paypal) {
    throw new ApiError(503, "paypal_not_configured", "PayPal sandbox isn't configured on this deployment, so checkout is unavailable.");
  }
  return deps.paypal;
}

async function loadOwnedAlert(deps: Deps, userId: string, alertId: string): Promise<AlertRow> {
  const { data } = await deps.db.from("deal_alerts").select("*").eq("id", alertId).maybeSingle();
  const alert = data as AlertRow | null;
  // Same answer for missing and not-yours, so IDs can't be probed.
  if (!alert || alert.user_id !== userId) throw notFound("That deal");
  return alert;
}

async function loadOwnedOrder(deps: Deps, userId: string, orderRowId: string): Promise<OrderRow> {
  const { data } = await deps.db.from("paypal_orders").select("*").eq("id", orderRowId).maybeSingle();
  const order = data as OrderRow | null;
  if (!order || order.user_id !== userId) throw notFound("That checkout");
  return order;
}

/** State change through the machine, with a compare-and-swap on the current status. */
async function transition(deps: Deps, order: OrderRow, to: OrderStatus, patch: Partial<OrderRow> = {}): Promise<OrderRow> {
  if (order.status === to) {
    if (Object.keys(patch).length === 0) return order;
  } else {
    assertTransition(order.status, to);
  }
  const { data, error } = await deps.db
    .from("paypal_orders")
    .update({ ...patch, status: to })
    .eq("id", order.id)
    .eq("status", order.status)
    .select()
    .maybeSingle();
  if (error) throw new Error("order_update_failed");
  if (data) return data as OrderRow;
  // Lost the race: someone else moved it. Return the true state.
  const { data: fresh } = await deps.db.from("paypal_orders").select("*").eq("id", order.id).single();
  return fresh as OrderRow;
}

/** A Buy now order has no alert, so there's nothing to release. */
async function releaseAlert(deps: Deps, alertId: string | null) {
  if (!alertId) return;
  await deps.db.from("deal_alerts").update({ status: "open" }).eq("id", alertId).eq("status", "checkout_prepared");
}

/** PayPal's reason, in words a person can act on. The name and reference help whoever runs this deployment. */
export function paypalFailure(e: unknown): ApiError {
  const name = e instanceof PaypalError ? e.paypalName : "PAYPAL_UNREACHABLE";
  const issue = e instanceof PaypalError ? e.issue : null;
  const debugId = e instanceof PaypalError ? e.debugId : null;
  // Names and PayPal's reference only: no tokens, no credentials, no payloads.
  const why = e instanceof PaypalError ? null : networkReason(e);
  console.error(`paypal_create_failed ${name} ${issue ?? ""} ${why ?? ""} debug_id=${debugId ?? "none"}`);
  const ref = [issue ?? name, debugId].filter(Boolean).join(", ");
  const message =
    name === "AUTHENTICATION_FAILURE"
      ? "PayPal rejected this site's sandbox credentials, so no order was created. Nothing was charged. The PayPal client ID and secret need checking."
      : name === "PAYPAL_UNREACHABLE"
        ? `We couldn't reach PayPal (${why}), so no order was created. Nothing was charged. Please try again. If this keeps happening, your Profile page shows what to fix.`
        : `PayPal couldn't create the sandbox order. Nothing was charged. (PayPal said: ${ref})`;
  return new ApiError(502, "paypal_create_failed", message, { paypalCode: name, ...(issue ? { paypalIssue: issue } : {}) });
}

async function createRemoteOrder(deps: Deps, paypal: PaypalApi, row: OrderRow): Promise<OrderRow> {
  let created: PaypalOrder;
  try {
    created = await paypal.createOrder({
      amountCents: row.amount_cents,
      currency: row.currency,
      requestId: row.idempotency_key,
      returnUrl: `${deps.appUrl}/checkout/${row.id}?paypal=return`,
      cancelUrl: `${deps.appUrl}/checkout/${row.id}?paypal=cancel`,
      customId: row.id,
    });
  } catch (e) {
    const failure = paypalFailure(e);
    const reason = e instanceof PaypalError ? [e.paypalName, e.issue].filter(Boolean).join(":") : `paypal_unreachable: ${networkReason(e)}`;
    await transition(deps, row, "failed", { failure_reason: reason });
    throw failure;
  }
  return transition(deps, row, "payer_action_required", {
    paypal_order_id: created.id,
    approve_url: created.payerActionUrl,
  });
}

// ---- prepare -----------------------------------------------------------------------------------

export type PrepareResult = { order: OrderRow; reused: boolean };

export async function prepareCheckout(deps: Deps, userId: string, alertId: string): Promise<PrepareResult> {
  const paypal = requirePaypal(deps);
  const alert = await loadOwnedAlert(deps, userId, alertId);
  const now = deps.now();

  if (alert.status === "purchased") throw new ApiError(409, "already_purchased", "This deal was already purchased.");
  if (alert.status === "dismissed" || alert.status === "expired") {
    throw new ApiError(409, "deal_not_active", "This deal is no longer active.");
  }

  // Never a second order while one is live.
  const { data: liveRows } = await deps.db
    .from("paypal_orders")
    .select("*")
    .eq("deal_alert_id", alert.id)
    .in("status", LIVE_STATUSES)
    .limit(1);
  let resume = (liveRows?.[0] as OrderRow | undefined) ?? null;
  if (resume) {
    if (new Date(resume.expires_at).getTime() <= now.getTime()) {
      await transition(deps, resume, "expired");
      resume = null;
    } else if (resume.status !== "creating") {
      return { order: resume, reused: true };
    } else if (now.getTime() - new Date(resume.created_at).getTime() < CREATING_STALE_MS) {
      return { order: resume, reused: true }; // another request is mid-create
    }
  }

  // Re-fetch the live offer and re-run the rules. The alert's stored numbers are not trusted.
  const { data: trackedData } = await deps.db.from("tracked_products").select("*").eq("id", alert.tracked_product_id).single();
  const tracked = trackedData as TrackedRow;
  const { data: productData } = await deps.db.from("products").select("*").eq("id", tracked.product_id).single();
  const product = productData as ProductRow;

  let offers;
  try {
    offers = await currentOffers(deps, tracked, product);
  } catch {
    throw new ApiError(502, "offer_unavailable", "We couldn't re-check the live price, so we didn't prepare a checkout. Try again shortly.");
  }
  const offer = offers.find((o) => o.domain === alert.domain);
  const last = await latestObservation(deps, tracked.id, alert.domain);
  const evaluation: Evaluation | null = offer
    ? evaluateDeal(offer, rulesOf(tracked), last ? { priceCents: last.price_cents, currency: last.currency } : null)
    : null;

  if (!offer || !evaluation || evaluation.decision !== "qualifies") {
    await deps.db.from("deal_alerts").update({ status: "expired" }).eq("id", alert.id).in("status", ["open", "checkout_prepared"]);
    await logActivity(deps.db, {
      user_id: userId, tracked_product_id: tracked.id, agent: "purchase", action: "prepare_rejected",
      output_summary: { decision: evaluation?.decision ?? "offer_gone" }, status: "rejected",
    });
    throw new ApiError(409, "deal_no_longer_qualifies", "The live price no longer meets your rules, so no checkout was prepared.", {
      evaluation,
    });
  }

  // Server-computed amount. The client never sends one.
  const amountCents = offer.priceCents + (offer.shippingCents ?? 0);

  let row: OrderRow;
  if (resume) {
    row = resume;
  } else {
    const { count } = await deps.db
      .from("paypal_orders")
      .select("id", { count: "exact", head: true })
      .eq("deal_alert_id", alert.id);
    const { data, error } = await deps.db
      .from("paypal_orders")
      .insert({
        user_id: userId,
        deal_alert_id: alert.id,
        // Deterministic so concurrent prepares collide. Attempt number allows a retry after an order ended.
        idempotency_key: sha256(`${alert.id}:${count ?? 0}`),
        amount_cents: amountCents,
        currency: offer.currency,
        status: "creating",
        expires_at: new Date(now.getTime() + ORDER_TTL_MS).toISOString(),
      })
      .select()
      .single();
    if (error || !data) {
      // Lost the unique-index race. Hand back the winner.
      const { data: winner } = await deps.db
        .from("paypal_orders")
        .select("*")
        .eq("deal_alert_id", alert.id)
        .in("status", LIVE_STATUSES)
        .limit(1);
      if (winner?.[0]) return { order: winner[0] as OrderRow, reused: true };
      throw new Error("order_insert_failed");
    }
    row = data as OrderRow;
  }

  const updated = await createRemoteOrder(deps, paypal, row);
  await deps.db.from("deal_alerts").update({ status: "checkout_prepared" }).eq("id", alert.id).eq("status", "open");
  await logActivity(deps.db, {
    user_id: userId, tracked_product_id: tracked.id, agent: "purchase", action: "checkout_prepared",
    output_summary: { amount_cents: updated.amount_cents, currency: updated.currency, retailer: alert.domain }, status: "ok",
  });
  return { order: updated, reused: false };
}

// ---- buy now -----------------------------------------------------------------------------------

/**
 * A sandbox checkout at the current price, whether or not it meets any rule. The person is choosing to pay it.
 * Everything else holds: the client sends IDs only, the live offer is re-fetched and priced here, and nothing is
 * charged until the buyer approves at PayPal.
 */
export async function buyNow(
  deps: Deps,
  userId: string,
  ref: { source: "channel3" | "seed"; id: string; domain: string },
  currency: string,
): Promise<PrepareResult> {
  const paypal = requirePaypal(deps);
  let card;
  try {
    card = await fetchProductCard(deps, ref.source, ref.id, currency);
  } catch {
    throw new ApiError(502, "offer_unavailable", "We couldn't check the live price, so no checkout was prepared. Please try again.");
  }
  if (!card) throw notFound("That product");
  const offer = card.offers.find((o) => o.domain === normalizeDomain(ref.domain));
  if (!offer) throw new ApiError(409, "offer_gone", "That retailer no longer has an offer for this product.");
  if (offer.inStock === false) throw new ApiError(409, "out_of_stock", "That retailer is out of stock right now.");

  const product = await upsertProduct(deps, card);
  const live = async () => {
    const { data } = await deps.db
      .from("paypal_orders")
      .select("*")
      .eq("user_id", userId)
      .eq("product_id", product.id)
      .eq("retailer_domain", offer.domain)
      .is("deal_alert_id", null)
      .in("status", LIVE_STATUSES)
      .limit(1);
    return (data?.[0] as OrderRow | undefined) ?? null;
  };

  const amountCents = offer.priceCents + (offer.shippingCents ?? 0);
  const existing = await live();
  if (existing) {
    const expired = new Date(existing.expires_at).getTime() <= deps.now().getTime();
    if (!expired && existing.status === "creating") return { order: existing, reused: true };
    // A live order at an old price must not be reused: the person should pay today's price.
    if (!expired && existing.amount_cents === amountCents) return { order: existing, reused: true };
    await transition(deps, existing, expired ? "expired" : "cancelled", expired ? {} : { failure_reason: "price_changed" });
  }

  const { count } = await deps.db
    .from("paypal_orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("product_id", product.id);
  const { data, error } = await deps.db
    .from("paypal_orders")
    .insert({
      user_id: userId,
      product_id: product.id,
      retailer_domain: offer.domain,
      idempotency_key: sha256(`direct:${userId}:${product.id}:${offer.domain}:${count ?? 0}`),
      amount_cents: amountCents,
      currency: offer.currency,
      status: "creating",
      expires_at: new Date(deps.now().getTime() + ORDER_TTL_MS).toISOString(),
    })
    .select()
    .single();
  if (error || !data) {
    const winner = await live();
    if (winner) return { order: winner, reused: true };
    throw new Error("order_insert_failed");
  }
  const updated = await createRemoteOrder(deps, paypal, data as OrderRow);
  await logActivity(deps.db, {
    user_id: userId, agent: "purchase", action: "buy_now_prepared",
    output_summary: { amount_cents: updated.amount_cents, currency: updated.currency, retailer: offer.domain }, status: "ok",
  });
  return { order: updated, reused: false };
}

// ---- capture -----------------------------------------------------------------------------------

export type CaptureOutcome =
  | "captured" | "already_captured" | "awaiting_approval" | "pending" | "declined" | "expired" | "cancelled" | "failed";

export type CaptureResult = { outcome: CaptureOutcome; message: string; order: OrderRow; purchase: PurchaseRow | null };

async function loadPurchase(deps: Deps, orderRowId: string): Promise<PurchaseRow | null> {
  const { data } = await deps.db.from("purchases").select("*").eq("paypal_order_row", orderRowId).maybeSingle();
  return (data as PurchaseRow | null) ?? null;
}

async function reload(deps: Deps, id: string): Promise<OrderRow> {
  const { data } = await deps.db.from("paypal_orders").select("*").eq("id", id).single();
  return data as OrderRow;
}

const CAPTURED_MSG = "PayPal confirmed the sandbox capture. No real money moved and no retailer ships an item.";

/** All side effects of a confirmed capture happen in one database transaction (finalize_capture). */
async function retailerOf(deps: Deps, order: OrderRow): Promise<string> {
  if (order.retailer_domain) return order.retailer_domain;
  const { data } = await deps.db.from("deal_alerts").select("domain").eq("id", order.deal_alert_id).single();
  return (data as { domain: string }).domain;
}

async function finalize(deps: Deps, order: OrderRow, domain: string, captureId: string, cents: number, currency: string): Promise<CaptureResult> {
  const { data, error } = await deps.db.rpc("finalize_capture", {
    p_order_row: order.id,
    p_capture_id: captureId,
    p_amount_cents: cents,
    p_currency: currency,
    p_retailer_domain: domain,
  });
  if (error) throw new Error("finalize_failed");
  const already = (data as { already_captured?: boolean } | null)?.already_captured === true;
  return {
    outcome: already ? "already_captured" : "captured",
    message: CAPTURED_MSG,
    order: await reload(deps, order.id),
    purchase: await loadPurchase(deps, order.id),
  };
}

async function failOrder(deps: Deps, order: OrderRow, reason: string, message: string, outcome: CaptureOutcome): Promise<CaptureResult> {
  const updated = await transition(deps, order, "failed", { failure_reason: reason });
  await releaseAlert(deps, order.deal_alert_id);
  await notify(deps.db, { user_id: order.user_id, kind: "payment_status", title: "Sandbox payment failed", body: message, link: `/checkout/${order.id}` });
  await logActivity(deps.db, { user_id: order.user_id, agent: "purchase", action: "capture_failed", output_summary: { reason }, status: "failed" });
  return { outcome, message, order: updated, purchase: null };
}

export async function captureCheckout(deps: Deps, userId: string, orderRowId: string): Promise<CaptureResult> {
  const order = await loadOwnedOrder(deps, userId, orderRowId);

  if (order.status === "captured") {
    return { outcome: "already_captured", message: CAPTURED_MSG, order, purchase: await loadPurchase(deps, order.id) };
  }
  if (order.status === "cancelled") throw new ApiError(409, "order_cancelled", "This checkout was cancelled.");
  if (order.status === "failed") throw new ApiError(409, "order_failed", "This checkout failed. Prepare a new one from the deal page.");
  if (order.status === "expired") throw new ApiError(410, "order_expired", "This checkout expired. Prepare a new one from the deal page.");
  if (new Date(order.expires_at).getTime() <= deps.now().getTime()) {
    await transition(deps, order, "expired");
    await releaseAlert(deps, order.deal_alert_id);
    throw new ApiError(410, "order_expired", "This checkout expired. Nothing was charged. Prepare a new one from the deal page.");
  }
  if (!order.paypal_order_id) throw new ApiError(409, "order_not_ready", "This checkout is still being prepared.");

  const paypal = requirePaypal(deps);
  const domain = await retailerOf(deps, order);

  let remote: PaypalOrder;
  try {
    remote = await paypal.getOrder(order.paypal_order_id);
  } catch {
    throw new ApiError(502, "paypal_unreachable", "We couldn't reach PayPal to confirm this. Nothing is recorded as paid. Please try again.");
  }

  const amountMatches = (cents: number | null, currency: string | null) =>
    cents === order.amount_cents && currency === order.currency;

  // PayPal already captured (for example, a retry after we lost the response).
  if (remote.status === "COMPLETED") {
    const cap = remote.captures[0];
    if (cap?.status === "COMPLETED" && amountMatches(cap.amountCents, cap.currency)) {
      return finalize(deps, order, domain, cap.id, cap.amountCents!, cap.currency!);
    }
    if (cap?.status === "PENDING") {
      await transition(deps, order, order.status, { failure_reason: "capture_pending" });
      return { outcome: "pending", message: "PayPal says the capture is pending. This isn't a completed purchase yet.", order: await reload(deps, order.id), purchase: null };
    }
    return failOrder(deps, order, "unexpected_capture_state", "PayPal's capture didn't match this order, so it isn't recorded as a purchase.", "failed");
  }
  if (remote.status === "VOIDED") {
    const updated = await transition(deps, order, "cancelled", { failure_reason: "voided" });
    await releaseAlert(deps, order.deal_alert_id);
    return { outcome: "cancelled", message: "PayPal voided this order. Nothing was charged.", order: updated, purchase: null };
  }
  if (remote.status !== "APPROVED") {
    return { outcome: "awaiting_approval", message: "PayPal hasn't received your approval yet. Nothing has been charged.", order, purchase: null };
  }

  // Approved. Verify before capturing: PayPal's amount must equal ours, to the cent.
  if (!amountMatches(remote.amountCents, remote.currency)) {
    return failOrder(deps, order, "amount_mismatch", "The PayPal amount didn't match this order, so we did not capture it. Nothing was charged.", "failed");
  }
  const approved = await transition(deps, order, "approved");

  let captured: PaypalOrder;
  try {
    // Stable request id: PayPal documents repeating a /capture after a 5xx or timeout with the same id.
    captured = await paypal.captureOrder(order.paypal_order_id, sha256(`capture:${order.id}`));
  } catch (e) {
    if (e instanceof PaypalError && e.status >= 400 && e.status < 500) {
      if (e.issue === "ORDER_ALREADY_CAPTURED") {
        const again = await paypal.getOrder(order.paypal_order_id);
        const cap = again.captures[0];
        if (cap?.status === "COMPLETED" && amountMatches(cap.amountCents, cap.currency)) {
          return finalize(deps, approved, domain, cap.id, cap.amountCents!, cap.currency!);
        }
      }
      return failOrder(deps, approved, e.issue ?? e.paypalName, "PayPal declined this sandbox payment. Nothing is recorded as purchased.", "declined");
    }
    // Unknown result. Do not claim either way. Reconcile and retry settle it.
    throw new ApiError(502, "capture_unconfirmed", "We couldn't confirm the capture with PayPal. It isn't recorded as a purchase. Please try again.");
  }

  const cap = captured.captures[0];
  switch (cap?.status) {
    case "COMPLETED":
      if (!amountMatches(cap.amountCents, cap.currency)) {
        return failOrder(deps, approved, "captured_amount_mismatch", "PayPal's captured amount didn't match this order, so it isn't recorded as a purchase.", "failed");
      }
      return finalize(deps, approved, domain, cap.id, cap.amountCents!, cap.currency!);
    case "PENDING":
      await transition(deps, approved, "approved", { failure_reason: "capture_pending" });
      return { outcome: "pending", message: "PayPal says the capture is pending. This isn't a completed purchase yet.", order: await reload(deps, order.id), purchase: null };
    case "DECLINED":
    case "FAILED":
      return failOrder(deps, approved, `capture_${cap.status.toLowerCase()}`, "PayPal declined this sandbox payment. Nothing is recorded as purchased.", "declined");
    default:
      return failOrder(deps, approved, "unknown_capture_state", "PayPal returned a capture state we don't recognise, so it isn't recorded as a purchase.", "failed");
  }
}

// ---- cancel ------------------------------------------------------------------------------------

export async function cancelCheckout(deps: Deps, userId: string, orderRowId: string): Promise<OrderRow> {
  const order = await loadOwnedOrder(deps, userId, orderRowId);
  if (order.status === "cancelled") return order;
  if (!["created", "payer_action_required", "approved"].includes(order.status)) {
    throw new ApiError(409, "order_not_cancellable", "This checkout can't be cancelled.");
  }
  const updated = await transition(deps, order, "cancelled");
  await releaseAlert(deps, order.deal_alert_id);
  await logActivity(deps.db, { user_id: userId, agent: "purchase", action: "checkout_cancelled", status: "ok" });
  return updated;
}

// ---- reconcile ---------------------------------------------------------------------------------

/** Bring one row in line with PayPal. Never captures: capture only follows the buyer's return to the app. */
export async function reconcileOrder(deps: Deps, order: OrderRow): Promise<void> {
  if (new Date(order.expires_at).getTime() <= deps.now().getTime()) {
    await transition(deps, order, "expired");
    await releaseAlert(deps, order.deal_alert_id);
    return;
  }
  if (!order.paypal_order_id || !deps.paypal) return;
  const remote = await deps.paypal.getOrder(order.paypal_order_id);
  if (remote.status === "APPROVED" && order.status !== "approved") {
    await transition(deps, order, "approved");
  } else if (remote.status === "VOIDED") {
    await transition(deps, order, "cancelled", { failure_reason: "voided" });
    await releaseAlert(deps, order.deal_alert_id);
  } else if (remote.status === "COMPLETED") {
    const cap = remote.captures[0];
    if (cap?.status === "COMPLETED" && cap.amountCents === order.amount_cents && cap.currency === order.currency) {
      await finalize(deps, order, await retailerOf(deps, order), cap.id, cap.amountCents, cap.currency);
    } else if (cap?.status === "DECLINED" || cap?.status === "FAILED") {
      await failOrder(deps, order, `capture_${cap.status.toLowerCase()}`, "PayPal declined this sandbox payment. Nothing is recorded as purchased.", "declined");
    }
  }
}

export async function reconcileOrders(deps: Deps): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - RECONCILE_AFTER_MS).toISOString();
  const { data } = await deps.db
    .from("paypal_orders")
    .select("*")
    .in("status", ["creating", "created", "payer_action_required", "approved"])
    .lt("created_at", cutoff)
    .limit(50);
  let done = 0;
  for (const row of (data ?? []) as OrderRow[]) {
    try {
      await reconcileOrder(deps, row);
      done++;
    } catch {
      // Per-item isolation. The next run retries.
    }
  }
  return done;
}

// ---- webhook -----------------------------------------------------------------------------------

type WebhookEvent = { id?: unknown; event_type?: unknown; resource?: Record<string, unknown> };

export const HANDLED_EVENTS = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.REFUNDED",
];

/** Where an event carries the order id. Capture events: unconfirmed path, read defensively (docs/UNVERIFIED.md). */
function orderIdFromEvent(event: WebhookEvent): string | null {
  const r = event.resource ?? {};
  if (event.event_type === "CHECKOUT.ORDER.APPROVED") return typeof r.id === "string" ? r.id : null;
  const sd = r.supplementary_data as { related_ids?: { order_id?: unknown } } | undefined;
  return typeof sd?.related_ids?.order_id === "string" ? sd.related_ids.order_id : null;
}

/** Body is already signature-verified. Amounts in it are not trusted: state comes from GET order. */
export async function handleWebhookEvent(deps: Deps, event: WebhookEvent): Promise<"processed" | "duplicate" | "ignored"> {
  if (typeof event.id !== "string" || typeof event.event_type !== "string") return "ignored";
  const { data: seen } = await deps.db.from("webhook_events").select("event_id").eq("event_id", event.id).maybeSingle();
  if (seen) return "duplicate";

  if (HANDLED_EVENTS.includes(event.event_type)) {
    const orderId = orderIdFromEvent(event);
    if (orderId) {
      const { data } = await deps.db.from("paypal_orders").select("*").eq("paypal_order_id", orderId).maybeSingle();
      const order = data as OrderRow | null;
      if (order && deps.paypal) {
        if (order.status === "captured") {
          const remote = await deps.paypal.getOrder(orderId);
          const refunded = remote.captures.some((c) => c.status === "REFUNDED" || c.status === "PARTIALLY_REFUNDED");
          if (refunded) {
            await deps.db.from("purchases").update({ refunded_at: deps.now().toISOString() }).eq("paypal_order_row", order.id).is("refunded_at", null);
            await notify(deps.db, { user_id: order.user_id, kind: "payment_status", title: "Sandbox payment refunded", body: "PayPal reports this sandbox capture was refunded.", link: "/purchases" });
          }
        } else if (LIVE_STATUSES.includes(order.status)) {
          await reconcileOrder(deps, order);
        }
      }
    }
  }
  // Recorded last, so a failure above gets PayPal's retry instead of being swallowed as a duplicate.
  await deps.db.from("webhook_events").insert({ event_id: event.id, event_type: event.event_type });
  return "processed";
}
