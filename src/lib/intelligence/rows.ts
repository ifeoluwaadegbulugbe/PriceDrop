/**
 * Price Intelligence data. Pure and deterministic: every figure and status here is computed from recorded
 * observations with integer arithmetic. The grid, the phone cards and the AI answers all read these same rows.
 */
import type { AlertRow, ObservationRow, ProductRow, PurchaseRow, TrackedRow } from "@/lib/db/types";
import { dropPercent } from "@/lib/discovery/filters";

/** Target reached only counts on a price seen this recently. */
export const FRESH_MS = 24 * 3600 * 1000;
/** Within this percentage above the target counts as close. */
const CLOSE_PERCENT = 5;

export type RowStatus = "target_reached" | "price_dropped" | "watching" | "paused" | "purchased" | "not_checked";

export const STATUS_LABELS: Record<RowStatus, string> = {
  target_reached: "At ideal price",
  price_dropped: "Price dropped",
  watching: "Still watching",
  paused: "Paused",
  purchased: "Bought (sandbox)",
  not_checked: "Not checked yet",
};

export type IntelligenceRow = {
  id: string;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  source: "channel3" | "seed";
  externalId: string;
  domain: string | null;
  currency: string;
  currentCents: number | null;
  previousCents: number | null;
  reductionCents: number | null;
  reductionPercent: number | null;
  /** How much the latest recorded price rose at the same retailer. Null unless it did. */
  increaseCents: number | null;
  targetCents: number;
  maxCents: number;
  /** Current minus target. Positive means still above target. Null without a price. */
  toTargetCents: number | null;
  withinMax: boolean | null;
  status: RowStatus;
  trackedStatus: string;
  observedAt: string | null;
  lastCheckFailed: boolean;
  stale: boolean;
  isSimulated: boolean;
  addedAt: string;
};

export function buildRows(
  tracked: TrackedRow[],
  products: Map<string, ProductRow>,
  observations: ObservationRow[],
  now: Date,
): IntelligenceRow[] {
  // Newest first per product and retailer, whatever order they arrived in.
  const sorted = [...observations].sort((a, b) => b.observed_at.localeCompare(a.observed_at) || b.id - a.id);
  const history = new Map<string, Map<string, ObservationRow[]>>();
  for (const o of sorted) {
    const byDomain = history.get(o.tracked_product_id) ?? new Map<string, ObservationRow[]>();
    byDomain.set(o.domain, [...(byDomain.get(o.domain) ?? []), o]);
    history.set(o.tracked_product_id, byDomain);
  }

  return tracked.map((t) => {
    const p = products.get(t.product_id);
    const domains = [...(history.get(t.id)?.values() ?? [])];
    const inStock = domains.filter((d) => d[0]!.in_stock !== false);
    const pool = inStock.length ? inStock : domains;
    const allowed = t.allowed_domains?.length ? pool.filter((d) => t.allowed_domains.includes(d[0]!.domain)) : pool;
    const chosen = (allowed.length ? allowed : pool).sort((a, b) => a[0]!.price_cents - b[0]!.price_cents)[0];
    const current = chosen?.[0] ?? null;
    const previous = chosen?.[1] ?? null;

    const comparable = current && previous && previous.currency === current.currency;
    const dropped = comparable && previous.price_cents > current.price_cents;
    const rose = comparable && previous.price_cents < current.price_cents;
    const observedAt = current?.observed_at ?? null;
    const stale = observedAt ? now.getTime() - new Date(observedAt).getTime() > FRESH_MS : false;
    const toTarget = current ? current.price_cents - t.target_price_cents : null;
    const reached = current !== null && toTarget !== null && toTarget <= 0 && !stale && current.currency === t.currency;

    let status: RowStatus;
    if (t.status === "purchased") status = "purchased";
    else if (t.status === "paused") status = "paused";
    else if (!current) status = "not_checked";
    else if (reached) status = "target_reached";
    else if (dropped) status = "price_dropped";
    else status = "watching";

    return {
      id: t.id,
      title: p?.title ?? "Product",
      brand: p?.brand ?? null,
      imageUrl: p?.image_url ?? null,
      source: p?.source ?? "seed",
      externalId: p?.external_id ?? "",
      domain: current?.domain ?? null,
      currency: current?.currency ?? t.currency,
      currentCents: current?.price_cents ?? null,
      previousCents: previous?.price_cents ?? null,
      reductionCents: dropped ? previous.price_cents - current.price_cents : null,
      reductionPercent: dropped ? dropPercent(previous.price_cents, current.price_cents) : null,
      increaseCents: rose ? current.price_cents - previous.price_cents : null,
      targetCents: t.target_price_cents,
      maxCents: t.max_total_cents,
      toTargetCents: toTarget,
      withinMax: current ? current.price_cents + (current.shipping_cents ?? 0) <= t.max_total_cents : null,
      status,
      trackedStatus: t.status,
      observedAt,
      lastCheckFailed: Boolean(t.last_check_status && t.last_check_status !== "ok"),
      stale,
      isSimulated: current?.source === "demo_simulation",
      addedAt: t.created_at,
    };
  });
}

export type ActivityKind = "price_up" | "price_drop" | "target_reached" | "close_to_target" | "check_failed" | "paused" | "awaiting_decision" | "purchase";
export type ActivityEvent = {
  id: string;
  kind: ActivityKind;
  label: string;
  description: string;
  productTitle: string;
  href: string | null;
  at: string;
};

const money = (c: number, currency: string) => {
  const symbol = ({ USD: "$", GBP: "£", EUR: "€" } as Record<string, string>)[currency] ?? `${currency} `;
  return `${symbol}${Math.trunc(c / 100).toLocaleString("en-US")}.${String(c % 100).padStart(2, "0")}`;
};

/** Only events that records prove. Nothing is added to make the list look busy. */
export function buildActivity(
  rows: IntelligenceRow[],
  alerts: AlertRow[],
  purchases: PurchaseRow[],
  products: Map<string, ProductRow>,
): ActivityEvent[] {
  const byTracked = new Map(rows.map((r) => [r.id, r]));
  const events: ActivityEvent[] = [];

  for (const a of alerts) {
    const r = byTracked.get(a.tracked_product_id);
    if (!r) continue; // The shopper removed this product, so its history goes with it.
    const title = r.title;
    const currency = r.currency;
    if (a.status === "open" || a.status === "checkout_prepared") {
      events.push({
        id: `alert-wait-${a.id}`,
        kind: "awaiting_decision",
        label: "Ready when you are",
        description: `${money(a.price_cents, currency)} at ${a.domain} matches what you asked for.`,
        productTitle: title,
        href: `/deals/${a.id}`,
        at: a.created_at,
      });
    }
    if (a.evaluation?.isGenuineChange && a.previous_price_cents !== null) {
      events.push({
        id: `alert-drop-${a.id}`,
        kind: "price_drop",
        label: "The price just dropped.",
        description: `Fell from ${money(a.previous_price_cents, currency)} to ${money(a.price_cents, currency)} at ${a.domain}.`,
        productTitle: title,
        href: `/deals/${a.id}`,
        at: a.created_at,
      });
    } else {
      events.push({
        id: `alert-target-${a.id}`,
        kind: "target_reached",
        label: "It's reached your ideal price!",
        description: `${money(a.price_cents, currency)} at ${a.domain} is at or below your ideal price. It isn't a price drop.`,
        productTitle: title,
        href: `/deals/${a.id}`,
        at: a.created_at,
      });
    }
  }

  for (const r of rows) {
    if (r.lastCheckFailed && r.observedAt) {
      events.push({
        id: `check-${r.id}`,
        kind: "check_failed",
        label: "We couldn't check the price right now.",
        description: "The last price we show may be out of date.",
        productTitle: r.title,
        href: `/products/${r.id}`,
        at: r.observedAt,
      });
    }
    if (r.increaseCents !== null && r.observedAt && r.currentCents !== null && r.previousCents !== null) {
      events.push({
        id: `up-${r.id}`,
        kind: "price_up",
        label: "The price has gone up.",
        description: `Rose from ${money(r.previousCents, r.currency)} to ${money(r.currentCents, r.currency)}${r.domain ? ` at ${r.domain}` : ""}.`,
        productTitle: r.title,
        href: `/products/${r.id}`,
        at: r.observedAt,
      });
    }
    if (r.status === "paused") {
      events.push({
        id: `paused-${r.id}`,
        kind: "paused",
        label: "Paused",
        description: "You paused automatic checks for this product.",
        productTitle: r.title,
        href: `/products/${r.id}`,
        at: r.observedAt ?? r.addedAt,
      });
    }
    if (
      r.observedAt && r.toTargetCents !== null && r.toTargetCents > 0 && r.currentCents !== null &&
      r.status !== "paused" && r.status !== "purchased" && r.toTargetCents * 100 <= r.targetCents * CLOSE_PERCENT
    ) {
      events.push({
        id: `close-${r.id}`,
        kind: "close_to_target",
        label: "Getting close",
        description: `${money(r.toTargetCents, r.currency)} away from your ${money(r.targetCents, r.currency)} ideal price.`,
        productTitle: r.title,
        href: `/products/${r.id}`,
        at: r.observedAt,
      });
    }
  }

  for (const p of purchases) {
    events.push({
      id: `purchase-${p.id}`,
      kind: "purchase",
      label: "Sandbox purchase",
      description: `PayPal confirmed ${money(p.amount_cents, p.currency)} in the sandbox. No real money moved.`,
      productTitle: products.get(p.product_id)?.title ?? "A product",
      href: "/purchases",
      at: p.purchased_at,
    });
  }

  return events.sort((a, b) => b.at.localeCompare(a.at));
}
