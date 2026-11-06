import Link from "next/link";
import { notFound } from "next/navigation";
import { DealExplanation } from "@/components/deal-explanation";
import { DealActions } from "@/components/deal-actions";
import { DeltaBadge, DemoCatalogueBadge, SandboxBanner, SimulationBadge } from "@/components/badges";
import { ProductTile } from "@/components/product-tile";
import { RuleList } from "@/components/rule-list";
import { UNKNOWN_LABELS } from "@/lib/ai/explain";
import type { AlertRow, ObservationRow, OrderRow, ProductRow, TrackedRow } from "@/lib/db/types";
import { dateTime } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Deal - PriceDrop" };

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await getViewer();

  const { data } = await supabase.from("deal_alerts").select("*").eq("id", id).maybeSingle();
  const alert = data as AlertRow | null;
  if (!alert) notFound();
  const { data: t } = await supabase.from("tracked_products").select("*").eq("id", alert.tracked_product_id).single();
  const tracked = t as TrackedRow;
  const { data: p } = await supabase.from("products").select("*").eq("id", tracked.product_id).single();
  const product = p as ProductRow;
  const { data: o } = await supabase.from("price_observations").select("*").eq("id", alert.observation_id).single();
  const observation = o as ObservationRow;
  const { data: orders } = await supabase
    .from("paypal_orders")
    .select("*")
    .eq("deal_alert_id", alert.id)
    .in("status", ["creating", "created", "payer_action_required", "approved"])
    .limit(1);
  const liveOrder = (orders?.[0] as OrderRow | undefined) ?? null;

  const c = (n: number) => formatCents(n, observation.currency);
  const e = alert.evaluation;
  const simulated = observation.source === "demo_simulation";
  const genuineSavings = e.isGenuineChange && e.savingsVsPreviousCents ? e.savingsVsPreviousCents : null;

  return (
    <div className="grid max-w-3xl gap-6">
      <nav aria-label="Breadcrumb"><Link href={`/products/${tracked.id}`} className="text-sm text-muted-foreground hover:underline">Back to product</Link></nav>

      {simulated && (
        <p role="note" className="rounded-lg bg-sim-soft px-3 py-2 text-sm text-sim">
          <strong className="font-semibold">Demo simulation.</strong> This retailer price was made up to demonstrate the flow. A checkout from it is still a real PayPal sandbox order.
        </p>
      )}

      <div className="flex gap-4">
        <ProductTile title={product.title} imageUrl={product.image_url} className="size-24 sm:size-32" />
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            {simulated && <SimulationBadge />}
            {product.source === "seed" && <DemoCatalogueBadge />}
          </div>
          <h1 className="mt-1 text-2xl font-semibold break-words">{product.title}</h1>
          <p className="text-sm break-all text-muted-foreground">{alert.domain}</p>
        </div>
      </div>

      <dl className="tnum grid grid-cols-2 gap-4 rounded-2xl border bg-card p-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Observed price</dt>
          <dd className="font-display text-2xl font-semibold">{c(alert.price_cents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Previous</dt>
          <dd className="text-sm font-medium">{alert.previous_price_cents === null ? "First observed at this price" : c(alert.previous_price_cents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">My ideal price</dt>
          <dd className="text-sm font-medium">{c(tracked.target_price_cents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Savings vs previous</dt>
          <dd className="text-sm font-medium">{genuineSavings ? c(genuineSavings) : "None to report"}</dd>
        </div>
        <div className="col-span-2 sm:col-span-4">
          <DeltaBadge priceCents={alert.price_cents} targetCents={tracked.target_price_cents} currency={observation.currency} />
          <p className="mt-1 text-xs text-muted-foreground">Observed {dateTime(observation.observed_at)}. We re-check the live price before preparing a checkout.</p>
        </div>
      </dl>

      <section aria-label="Why" className="grid gap-2">
        <h2 className="text-lg font-semibold">Why this was flagged</h2>
        <DealExplanation alertId={alert.id} explanation={alert.explanation} source={alert.explanation_source} />
      </section>

      <section aria-label="Your rules" className="grid gap-3">
        <h2 className="text-lg font-semibold">Your rules</h2>
        <RuleList evaluation={e} />
      </section>

      {e.unknown.length > 0 && (
        <section aria-label="Missing information" className="grid gap-1.5 rounded-2xl bg-caution-soft p-4 text-sm text-caution">
          <h2 className="font-display font-semibold">What we don&apos;t know</h2>
          <ul className="grid gap-1">
            {e.unknown.map((u) => <li key={u}>{UNKNOWN_LABELS[u]}</li>)}
          </ul>
          {e.unknown.includes("shipping_unknown") && <p>A sandbox checkout charges the item price only.</p>}
        </section>
      )}

      <SandboxBanner />
      <DealActions alertId={alert.id} status={alert.status} liveOrderId={liveOrder?.id ?? null} />
    </div>
  );
}
