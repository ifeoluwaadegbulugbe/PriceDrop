import { logActivity } from "@/lib/activity";
import { ApiError, notFound } from "@/lib/api/errors";
import { fetchProductCard } from "@/lib/catalogue";
import type { TrackedRow } from "@/lib/db/types";
import type { Deps } from "@/lib/deps";
import { upsertProduct } from "@/lib/discovery/service";
import { normalizeDomain } from "@/lib/evaluation/evaluate";
import { checkTracked, type CheckSummary } from "@/lib/monitor/check";

export type TrackingInput = {
  source: "channel3" | "seed";
  externalId: string;
  targetPriceCents: number;
  maxTotalCents: number;
  allowedDomains: string[];
  allowedVariants: string[] | null;
  requireInStock: boolean;
};

export async function loadOwnedTracked(deps: Deps, userId: string, id: string): Promise<TrackedRow> {
  const { data } = await deps.db.from("tracked_products").select("*").eq("id", id).maybeSingle();
  const row = data as TrackedRow | null;
  if (!row || row.user_id !== userId || row.status === "removed") throw notFound("That tracked product");
  return row;
}

/** Title, brand and image come from the source, never from the request. Then a baseline check runs. */
export async function createTracking(
  deps: Deps,
  userId: string,
  input: TrackingInput,
): Promise<{ tracked: TrackedRow; check: CheckSummary }> {
  const { data: profile } = await deps.db.from("profiles").select("currency").eq("id", userId).single();
  const currency = (profile as { currency: string } | null)?.currency ?? "USD";

  let card;
  try {
    card = await fetchProductCard(deps, input.source, input.externalId, currency);
  } catch {
    throw new ApiError(502, "source_unavailable", "We couldn't reach the product source. Please try again.");
  }
  if (!card) throw notFound("That product");

  const product = await upsertProduct(deps, card);

  const row = {
    user_id: userId,
    product_id: product.id,
    status: "active",
    currency,
    target_price_cents: input.targetPriceCents,
    max_total_cents: input.maxTotalCents,
    allowed_domains: input.allowedDomains.map(normalizeDomain),
    allowed_variants: input.allowedVariants,
    require_in_stock: input.requireInStock,
  };
  const { data, error } = await deps.db
    .from("tracked_products")
    .upsert(row, { onConflict: "user_id,product_id" })
    .select()
    .single();
  if (error || !data) throw new Error("tracked_upsert_failed");
  const tracked = data as TrackedRow;

  await logActivity(deps.db, {
    user_id: userId,
    tracked_product_id: tracked.id,
    agent: "discovery",
    action: "tracking_started",
    output_summary: { source: card.source, target_cents: input.targetPriceCents, offers: card.offers.length },
    status: "ok",
  });

  const check = await checkTracked(deps, tracked, { trigger: "baseline" });
  const { data: fresh } = await deps.db.from("tracked_products").select("*").eq("id", tracked.id).single();
  return { tracked: fresh as TrackedRow, check };
}

export type TrackingPatch = {
  targetPriceCents?: number;
  maxTotalCents?: number;
  allowedDomains?: string[];
  allowedVariants?: string[] | null;
  requireInStock?: boolean;
  status?: "active" | "paused";
};

export async function updateTracking(deps: Deps, userId: string, id: string, patch: TrackingPatch): Promise<TrackedRow> {
  const current = await loadOwnedTracked(deps, userId, id);
  if (current.status === "purchased") throw new ApiError(409, "already_purchased", "This product was already purchased.");

  const target = patch.targetPriceCents ?? current.target_price_cents;
  const max = patch.maxTotalCents ?? current.max_total_cents;
  if (target > max) throw new ApiError(400, "target_above_max", "Your target can't be above your maximum total.");

  const update: Record<string, unknown> = { target_price_cents: target, max_total_cents: max };
  if (patch.allowedDomains) update.allowed_domains = patch.allowedDomains.map(normalizeDomain);
  if (patch.allowedVariants !== undefined) update.allowed_variants = patch.allowedVariants;
  if (patch.requireInStock !== undefined) update.require_in_stock = patch.requireInStock;
  if (patch.status) {
    // Resuming a product with a live deal goes back to deal_found on its next check.
    update.status = patch.status;
  }

  const { data, error } = await deps.db.from("tracked_products").update(update).eq("id", id).select().single();
  if (error || !data) throw new Error("tracked_update_failed");
  return data as TrackedRow;
}

export async function removeTracking(deps: Deps, userId: string, id: string): Promise<void> {
  await loadOwnedTracked(deps, userId, id);
  await deps.db.from("tracked_products").update({ status: "removed" }).eq("id", id);
  await deps.db
    .from("deal_alerts")
    .update({ status: "dismissed" })
    .eq("tracked_product_id", id)
    .eq("status", "open");
}

/** Demo mode only. Runs the normal pipeline with one simulated price. Labelled at every layer by its source. */
export async function simulatePrice(deps: Deps, userId: string, id: string, priceCents: number): Promise<CheckSummary> {
  if (!deps.demoMode) throw notFound("That endpoint");
  const tracked = await loadOwnedTracked(deps, userId, id);
  const { data } = await deps.db
    .from("price_observations")
    .select("domain,price_cents,in_stock")
    .eq("tracked_product_id", id)
    .order("price_cents", { ascending: true });
  // Cheapest retailer that isn't out of stock, or a simulated drop could never become a deal.
  const rows = (data ?? []) as { domain: string; in_stock: boolean | null }[];
  const domain = (rows.find((r) => r.in_stock !== false) ?? rows[0])?.domain;
  if (!domain) throw new ApiError(409, "no_baseline", "This product has no observations to simulate against yet.");
  return checkTracked(deps, tracked, { trigger: "demo", simulate: { domain, priceCents } });
}
