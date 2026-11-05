import { explainDeal } from "@/lib/ai/explain";
import { fetchProductCard } from "@/lib/catalogue";
import { logActivity, notify } from "@/lib/activity";
import type { NormalizedOffer } from "@/lib/channel3/normalize";
import type { AlertRow, ObservationRow, ObservationSource, ProductRow, ProfileRow, TrackedRow } from "@/lib/db/types";
import type { Deps } from "@/lib/deps";
import { decideAlert } from "@/lib/evaluation/alertPolicy";
import { evaluateDeal, type EvalRules, type Evaluation } from "@/lib/evaluation/evaluate";
import { formatCents } from "@/lib/money";

const SIX_HOURS_MS = 6 * 3600 * 1000;
/** A demo simulated price stands in for the source price this long, so a demo can reach checkout. */
export const SIMULATION_TTL_MS = 2 * 3600 * 1000;

export type CurrentOffer = NormalizedOffer & { observationSource: ObservationSource };

export function rulesOf(t: TrackedRow): EvalRules {
  return {
    currency: t.currency,
    targetPriceCents: t.target_price_cents,
    maxTotalCents: t.max_total_cents,
    allowedDomains: t.allowed_domains ?? [],
    allowedVariants: t.allowed_variants ?? null,
    requireInStock: t.require_in_stock,
  };
}

export async function latestObservation(deps: Deps, trackedId: string, domain: string): Promise<ObservationRow | null> {
  const { data } = await deps.db
    .from("price_observations")
    .select("*")
    .eq("tracked_product_id", trackedId)
    .eq("domain", domain)
    .order("observed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  return (data?.[0] as ObservationRow | undefined) ?? null;
}

/**
 * Current offers for a tracked product. In demo mode only, a recent simulated price replaces the source price
 * for its domain and stays labelled as a simulation.
 */
export async function currentOffers(
  deps: Deps,
  tracked: TrackedRow,
  product: ProductRow,
  simulate?: { domain: string; priceCents: number },
): Promise<CurrentOffer[]> {
  const card = await fetchProductCard(deps, product.source, product.external_id, tracked.currency);
  const baseSource: ObservationSource = product.source === "channel3" ? "channel3_live" : "seed";
  const offers: CurrentOffer[] = (card?.offers ?? []).map((o) => ({ ...o, observationSource: baseSource }));
  if (!deps.demoMode) return offers;

  for (const offer of offers) {
    if (simulate && simulate.domain === offer.domain) {
      offer.priceCents = simulate.priceCents;
      offer.observationSource = "demo_simulation";
      continue;
    }
    const last = await latestObservation(deps, tracked.id, offer.domain);
    if (
      last?.source === "demo_simulation" &&
      deps.now().getTime() - new Date(last.observed_at).getTime() < SIMULATION_TTL_MS
    ) {
      offer.priceCents = last.price_cents;
      offer.observationSource = "demo_simulation";
    }
  }
  return offers;
}

async function loadProduct(deps: Deps, productId: string): Promise<ProductRow> {
  const { data, error } = await deps.db.from("products").select("*").eq("id", productId).single();
  if (error || !data) throw new Error("product_missing");
  return data as ProductRow;
}

export type CheckSummary = {
  trackedId: string;
  status: string;
  observationsWritten: number;
  alertsCreated: number;
  alertsExpired: number;
};

/** One check of one tracked product. Shared by the monitor, Check now, tracking setup and the demo simulator. */
export async function checkTracked(
  deps: Deps,
  tracked: TrackedRow,
  opts: { trigger: "monitor" | "user" | "baseline" | "demo"; simulate?: { domain: string; priceCents: number } },
): Promise<CheckSummary> {
  const summary: CheckSummary = { trackedId: tracked.id, status: "ok", observationsWritten: 0, alertsCreated: 0, alertsExpired: 0 };
  const now = deps.now();

  const finish = async (status: string) => {
    summary.status = status;
    const { data: live } = await deps.db
      .from("deal_alerts")
      .select("id")
      .eq("tracked_product_id", tracked.id)
      .in("status", ["open", "checkout_prepared"])
      .limit(1);
    const patch: Record<string, unknown> = { last_checked_at: now.toISOString(), last_check_status: status };
    if (tracked.status === "active" && live?.length) patch.status = "deal_found";
    if (tracked.status === "deal_found" && !live?.length) patch.status = "active";
    await deps.db.from("tracked_products").update(patch).eq("id", tracked.id);
    await logActivity(deps.db, {
      user_id: tracked.user_id,
      tracked_product_id: tracked.id,
      agent: "monitoring",
      action: `check_${opts.trigger}`,
      output_summary: { observations: summary.observationsWritten, alerts: summary.alertsCreated, expired: summary.alertsExpired },
      status,
    });
    return summary;
  };

  let product: ProductRow;
  let offers: CurrentOffer[];
  try {
    product = await loadProduct(deps, tracked.product_id);
    offers = await currentOffers(deps, tracked, product, opts.simulate);
  } catch {
    return finish("source_unavailable"); // Never invent an observation when the source fails.
  }
  if (offers.length === 0) return finish("no_offers");

  const { data: profileData } = await deps.db.from("profiles").select("*").eq("id", tracked.user_id).single();
  const profile = profileData as ProfileRow | null;
  const rules = rulesOf(tracked);

  for (const offer of offers) {
    const last = await latestObservation(deps, tracked.id, offer.domain);
    const identical =
      last !== null &&
      last.price_cents === offer.priceCents &&
      last.shipping_cents === offer.shippingCents &&
      last.in_stock === offer.inStock &&
      last.currency === offer.currency &&
      now.getTime() - new Date(last.observed_at).getTime() < SIX_HOURS_MS;

    let observation = last;
    if (!identical) {
      const { data, error } = await deps.db
        .from("price_observations")
        .insert({
          tracked_product_id: tracked.id,
          domain: offer.domain,
          // Channel3 says offer URLs are short-lived and must not be cached. See docs/UNVERIFIED.md.
          offer_url: null,
          price_cents: offer.priceCents,
          shipping_cents: offer.shippingCents,
          currency: offer.currency,
          in_stock: offer.inStock,
          source: offer.observationSource,
          is_baseline: last === null,
          observed_at: now.toISOString(),
        })
        .select()
        .single();
      if (error || !data) throw new Error("observation_write_failed");
      observation = data as ObservationRow;
      summary.observationsWritten++;
    }

    const previousForCompare = last ? { priceCents: last.price_cents, currency: last.currency } : null;
    const evaluation: Evaluation = evaluateDeal(offer, rules, previousForCompare);

    const { data: alertRows } = await deps.db
      .from("deal_alerts")
      .select("*")
      .eq("tracked_product_id", tracked.id)
      .eq("domain", offer.domain)
      .order("created_at", { ascending: false })
      .limit(5);
    const alerts = (alertRows ?? []) as AlertRow[];
    const liveAlert = alerts.find((a) => a.status === "open" || a.status === "checkout_prepared") ?? null;

    const action = decideAlert({
      evaluation,
      priceCents: offer.priceCents,
      previousCents: previousForCompare?.priceCents ?? null,
      liveAlert,
      lastAlert: alerts[0] ?? null,
    });
    if (action === "none") continue;

    if (action === "expire" && liveAlert) {
      await deps.db.from("deal_alerts").update({ status: "expired" }).eq("id", liveAlert.id);
      summary.alertsExpired++;
      if (profile?.notify_in_app) {
        await notify(deps.db, {
          user_id: tracked.user_id,
          kind: "tracking_status",
          title: "A deal ended",
          body: `The offer at ${offer.domain} no longer meets your rules.`,
          link: `/products/${tracked.id}`,
        });
      }
      continue;
    }

    // create or update
    const previousPriceCents = previousForCompare?.priceCents ?? null;
    const { explanation, source: explanationSource } = await explainDeal(
      {
        title: product.title,
        domain: offer.domain,
        priceCents: offer.priceCents,
        shippingCents: offer.shippingCents,
        targetPriceCents: tracked.target_price_cents,
        maxTotalCents: tracked.max_total_cents,
        previousPriceCents,
        currency: offer.currency,
        evaluation,
      },
      deps.callLlm,
    );
    const fields = {
      observation_id: observation!.id,
      price_cents: offer.priceCents,
      previous_price_cents: previousPriceCents,
      evaluation,
      explanation,
      explanation_source: explanationSource,
    };

    let alertId: string | null = null;
    if (action === "update" && liveAlert) {
      const { error } = await deps.db.from("deal_alerts").update(fields).eq("id", liveAlert.id);
      if (!error) alertId = liveAlert.id;
    } else {
      const { data, error } = await deps.db
        .from("deal_alerts")
        .insert({ ...fields, tracked_product_id: tracked.id, user_id: tracked.user_id, domain: offer.domain })
        .select("id")
        .single();
      // A concurrent check won the partial unique index. Exactly one live alert is the point.
      if (!error && data) alertId = (data as { id: string }).id;
    }
    if (!alertId) continue;
    summary.alertsCreated++;

    await logActivity(deps.db, {
      user_id: tracked.user_id,
      tracked_product_id: tracked.id,
      agent: "evaluation",
      action: action === "update" ? "deal_improved" : "deal_found",
      output_summary: { decision: evaluation.decision, price_cents: offer.priceCents, retailer: offer.domain },
      status: "ok",
    });
    if (profile?.notify_in_app) {
      const simulated = offer.observationSource === "demo_simulation" ? " (Demo simulation)" : "";
      await notify(deps.db, {
        user_id: tracked.user_id,
        kind: "deal_found",
        title: `Deal found${simulated}`,
        body: `${product.title.slice(0, 80)} is ${formatCents(offer.priceCents, offer.currency)} at ${offer.domain}.`,
        link: `/deals/${alertId}`,
      });
    }
  }

  return finish("ok");
}
