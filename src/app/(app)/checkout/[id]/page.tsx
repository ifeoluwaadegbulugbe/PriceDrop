import Link from "next/link";
import { notFound } from "next/navigation";
import { SandboxBanner, SimulationBadge } from "@/components/badges";
import { CheckoutPanel } from "@/components/checkout-panel";
import type { AlertRow, ObservationRow, OrderRow, ProductRow, PurchaseRow, TrackedRow } from "@/lib/db/types";
import { formatCents } from "@/lib/money";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Checkout - PriceDrop" };

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paypal?: string }>;
}) {
  const { id } = await params;
  const { paypal } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await getViewer();

  const { data } = await supabase.from("paypal_orders").select("*").eq("id", id).maybeSingle();
  const order = data as OrderRow | null;
  if (!order) notFound();
  const { data: a } = await supabase.from("deal_alerts").select("*").eq("id", order.deal_alert_id).single();
  const alert = a as AlertRow;
  const { data: t } = await supabase.from("tracked_products").select("*").eq("id", alert.tracked_product_id).single();
  const tracked = t as TrackedRow;
  const { data: p } = await supabase.from("products").select("*").eq("id", tracked.product_id).single();
  const product = p as ProductRow;
  const { data: o } = await supabase.from("price_observations").select("*").eq("id", alert.observation_id).single();
  const observation = o as ObservationRow;
  const { data: pu } = await supabase.from("purchases").select("*").eq("paypal_order_row", order.id).maybeSingle();
  const purchase = pu as PurchaseRow | null;

  return (
    <div className="mx-auto grid max-w-xl gap-6">
      <nav aria-label="Breadcrumb"><Link href={`/deals/${alert.id}`} className="text-sm text-muted-foreground hover:underline">Back to deal</Link></nav>
      <h1 className="text-3xl font-semibold">Checkout</h1>
      <SandboxBanner />
      {observation.source === "demo_simulation" && (
        <p role="note" className="text-sm text-sim">
          <SimulationBadge className="mr-1" /> The retailer price is simulated. The PayPal transaction is genuinely executed in the sandbox.
        </p>
      )}

      <div className="grid gap-1 rounded-2xl border bg-card p-4">
        <p className="text-sm font-medium break-words">{product.title}</p>
        <p className="text-sm break-all text-muted-foreground">{alert.domain}</p>
        <p className="tnum mt-2 font-display text-3xl font-semibold">{formatCents(order.amount_cents, order.currency)}</p>
        {alert.evaluation.unknown.includes("shipping_unknown") && (
          <p className="text-xs text-muted-foreground">Item price only. Shipping isn&apos;t stated by the retailer data.</p>
        )}
      </div>

      <CheckoutPanel
        orderId={order.id}
        status={order.status}
        approveUrl={order.approve_url}
        expiresAt={order.expires_at}
        alertId={alert.id}
        failureReason={order.failure_reason}
        paypalParam={paypal === "return" || paypal === "cancel" ? paypal : null}
      />

      {purchase && (
        <dl className="grid gap-2 rounded-2xl border bg-card p-4 text-sm">
          <div><dt className="text-xs text-muted-foreground">PayPal order ID</dt><dd className="font-mono text-xs break-all">{purchase.paypal_order_id}</dd></div>
          <div><dt className="text-xs text-muted-foreground">PayPal capture ID</dt><dd className="font-mono text-xs break-all">{purchase.paypal_capture_id}</dd></div>
        </dl>
      )}
    </div>
  );
}
