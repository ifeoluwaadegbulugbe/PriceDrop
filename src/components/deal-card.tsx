import { ArrowRight, CircleCheck, CircleHelp } from "lucide-react";
import Link from "next/link";
import { DeltaBadge, DemoCatalogueBadge, LiveBadge, SimulationBadge } from "@/components/badges";
import { ProductTile } from "@/components/product-tile";
import type { AlertRow, ObservationRow, ProductRow, TrackedRow } from "@/lib/db/types";
import { timeAgo } from "@/lib/format";
import { formatCents } from "@/lib/money";

function changeText(alert: AlertRow, money: (c: number) => string): string {
  if (alert.previous_price_cents === null) return "First observed";
  const saved = alert.evaluation.savingsVsPreviousCents;
  if (alert.evaluation.isGenuineChange && saved) return `${money(saved)} less`;
  return "No drop";
}

export function DealCard({
  alert,
  tracked,
  product,
  observation,
  lowestOf,
}: {
  alert: AlertRow;
  tracked?: TrackedRow;
  product?: ProductRow;
  observation?: ObservationRow;
  /** Number of waiting deals for this product, when this one is the cheapest of several. */
  lowestOf?: number;
}) {
  const currency = observation?.currency ?? tracked?.currency ?? "USD";
  const money = (c: number) => formatCents(c, currency);
  const { passed, unknown } = alert.evaluation;
  const shipping = observation?.shipping_cents ?? null;
  const shippingUnknown = unknown.includes("shipping_unknown");
  const inCheckout = alert.status === "checkout_prepared";

  return (
    <Link
      href={`/deals/${alert.id}`}
      className="group flex h-full flex-col gap-3 rounded-2xl border-2 border-deal/40 bg-card p-4 transition-colors hover:border-deal"
    >
      <div className="flex gap-3">
        <ProductTile title={product?.title ?? "Product"} imageUrl={product?.image_url ?? null} className="size-16 sm:size-20" />
        <div className="min-w-0 flex-1">
          {product?.brand && <p className="text-xs text-muted-foreground">{product.brand}</p>}
          <p className="line-clamp-2 text-sm leading-snug font-medium break-words">{product?.title ?? "Tracked product"}</p>
          <p className="tnum mt-1 font-display text-2xl font-semibold">{money(alert.price_cents)}</p>
          <p className="text-xs break-all text-muted-foreground">at {alert.domain}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {tracked && <DeltaBadge priceCents={alert.price_cents} targetCents={tracked.target_price_cents} currency={currency} />}
        {lowestOf && (
          <span className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-xs font-medium whitespace-nowrap text-accent-foreground">
            Lowest of your {lowestOf} deals
          </span>
        )}
      </div>

      <dl className="tnum grid grid-cols-3 gap-2 border-y py-2.5 text-sm">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Your target</dt>
          <dd className="font-medium">{tracked ? formatCents(tracked.target_price_cents, currency) : "Not available"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Since last price</dt>
          <dd className="font-medium">{changeText(alert, money)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Total</dt>
          <dd className="font-medium">
            {shippingUnknown || shipping === null ? "Unknown" : money(alert.price_cents + shipping)}
          </dd>
        </div>
      </dl>

      <ul className="grid gap-1 text-xs">
        <li className="flex items-start gap-1.5">
          <CircleCheck aria-hidden className="mt-px size-3.5 shrink-0 text-deal" />
          {passed.length} {passed.length === 1 ? "rule" : "rules"} passed
        </li>
        {shippingUnknown && (
          <li className="flex items-start gap-1.5">
            <CircleHelp aria-hidden className="mt-px size-3.5 shrink-0 text-caution" />
            Shipping isn&apos;t stated, so the total could be higher
          </li>
        )}
        {!shippingUnknown && shipping !== null && (
          <li className="flex items-start gap-1.5 text-muted-foreground">
            <CircleCheck aria-hidden className="mt-px size-3.5 shrink-0 text-deal" />
            Includes {shipping === 0 ? "free shipping" : `${money(shipping)} shipping`}
          </li>
        )}
      </ul>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          Observed {timeAgo(observation?.observed_at ?? alert.created_at)}
          {observation?.source === "demo_simulation" && <SimulationBadge />}
          {observation?.source === "seed" && <DemoCatalogueBadge />}
          {observation?.source === "channel3_live" && <LiveBadge />}
        </p>
        <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
          {inCheckout ? "Continue checkout" : "Review deal"}
          <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
