import Link from "next/link";
import { notFound } from "next/navigation";
import { AskBar } from "@/components/ask-bar";
import { DeltaBadge, DemoCatalogueBadge, LiveBadge, SimulationBadge, SourceBadge, TrackedStatusBadge } from "@/components/badges";
import { PriceChart } from "@/components/price-chart";
import { ProductActions, SimulatePanel } from "@/components/product-actions";
import { ProductTile } from "@/components/product-tile";
import { RuleList } from "@/components/rule-list";
import type { AlertRow, ObservationRow, ProductRow, TrackedRow } from "@/lib/db/types";
import { getEnv } from "@/lib/env";
import { dateTime, timeAgo } from "@/lib/format";
import { liveSnapshot } from "@/lib/live";
import { formatCents } from "@/lib/money";
import { getDeps } from "@/lib/serverDeps";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Product - PriceDrop" };

const BEHIND_MS = 90 * 60 * 1000;

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await getViewer();

  const { data } = await supabase.from("tracked_products").select("*").eq("id", id).maybeSingle();
  const tracked = data as TrackedRow | null;
  if (!tracked || tracked.status === "removed") notFound();
  const { data: productData } = await supabase.from("products").select("*").eq("id", tracked.product_id).single();
  const product = productData as ProductRow;
  const { data: obsData } = await supabase
    .from("price_observations")
    .select("*")
    .eq("tracked_product_id", id)
    .order("observed_at", { ascending: false })
    .limit(300);
  const observations = ((obsData ?? []) as ObservationRow[]).reverse();
  const { data: alertData } = await supabase
    .from("deal_alerts")
    .select("*")
    .eq("tracked_product_id", id)
    .in("status", ["open", "checkout_prepared"])
    .order("created_at", { ascending: false });
  const alerts = (alertData ?? []) as AlertRow[];

  const snap = await liveSnapshot(getDeps(), tracked, product);
  const best = snap.ok ? snap.best : null;
  const lastObs = observations[observations.length - 1];
  const hasHistory = new Set(observations.map((o) => o.observed_at)).size > 1;
  const sorted = snap.ok ? [...snap.offers].sort((a, b) => a.priceCents - b.priceCents) : [];
  const watching = tracked.status === "active" || tracked.status === "deal_found";
  // eslint-disable-next-line react-hooks/purity -- request-time render of a server component
  const nowMs = Date.now();
  const behind = watching && (!tracked.last_checked_at || nowMs - new Date(tracked.last_checked_at).getTime() > BEHIND_MS);

  return (
    <div className="grid gap-6">
      <nav aria-label="Breadcrumb"><Link href="/saved" className="text-sm text-muted-foreground hover:underline">Saved items</Link></nav>

      <div className="grid gap-5 md:grid-cols-[220px_1fr]">
        <ProductTile title={product.title} imageUrl={product.image_url} className="w-full max-w-56" />
        <div className="grid content-start gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <TrackedStatusBadge status={tracked.status} />
            {product.source === "seed" && <DemoCatalogueBadge />}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{product.brand ?? "Unknown brand"}</p>
            <h1 className="text-2xl font-semibold break-words sm:text-3xl">{product.title}</h1>
          </div>

          {best ? (
            <div className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tnum font-display text-4xl font-semibold">{formatCents(best.priceCents, best.currency)}</span>
                <DeltaBadge priceCents={best.priceCents} targetCents={tracked.target_price_cents} currency={tracked.currency} />
                {best.observationSource === "channel3_live" && <LiveBadge />}
                {best.observationSource === "demo_simulation" && <SimulationBadge />}
              </div>
              <p className="text-sm break-all text-muted-foreground">
                at {best.domain}
                {best.url && (
                  <> · <a href={best.url} target="_blank" rel="noopener noreferrer nofollow sponsored" className="text-primary hover:underline">View retailer</a></>
                )}
              </p>
              <p className="text-xs text-muted-foreground">Today&apos;s price, checked {dateTime(snap.fetchedAt)}</p>
            </div>
          ) : lastObs ? (
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t check the price right now. Last recorded:{" "}
              <span className="tnum font-medium text-foreground">{formatCents(lastObs.price_cents, lastObs.currency)}</span> at {lastObs.domain}, {timeAgo(lastObs.observed_at)}.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No price available yet.</p>
          )}

          <dl className="tnum grid grid-cols-2 gap-3 text-sm sm:max-w-sm">
            <div><dt className="text-muted-foreground">My ideal price</dt><dd className="font-semibold">{formatCents(tracked.target_price_cents, tracked.currency)}</dd></div>
            <div><dt className="text-muted-foreground">The most I&apos;d pay</dt><dd className="font-semibold">{formatCents(tracked.max_total_cents, tracked.currency)}</dd></div>
          </dl>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="grid gap-2">
          {alerts.map((a) => (
            <Link key={a.id} href={`/deals/${a.id}`} className="tnum block rounded-2xl border-2 border-deal/40 bg-deal-soft p-4 text-sm font-medium text-deal hover:border-deal">
              Ready when you are: {formatCents(a.price_cents, tracked.currency)} at {a.domain}. Take a look →
            </Link>
          ))}
        </div>
      )}

      {tracked.status !== "purchased" && (
        <p className="text-sm text-muted-foreground">
          Don&apos;t want to wait?{" "}
          <Link href={`/shop/${product.source}/${encodeURIComponent(product.external_id)}`} className="font-medium text-primary hover:underline">Buy at the current price</Link>
        </p>
      )}

      <ProductActions
        trackedId={tracked.id}
        status={tracked.status}
        currency={tracked.currency}
        sheet={{
          mode: "edit",
          trackedId: tracked.id,
          title: product.title,
          domains: [...new Set([...observations.map((o) => o.domain), ...sorted.map((o) => o.domain)])],
          variants: [...new Set(sorted.flatMap((o) => (o.variantLabel ? [o.variantLabel] : [])))],
          targetCents: tracked.target_price_cents,
          maxCents: tracked.max_total_cents,
          allowedDomains: tracked.allowed_domains,
          allowedVariants: tracked.allowed_variants,
          requireInStock: tracked.require_in_stock,
        }}
      />

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section aria-label="How the price has changed" className="grid content-start gap-3 rounded-2xl border bg-card p-4">
          <h2 className="text-lg font-semibold">How the price has changed</h2>
          {observations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No prices recorded yet. Tap Check now to record the first one.</p>
          ) : !hasHistory ? (
            <p className="text-sm text-muted-foreground">Starting prices recorded. A chart appears once we record a price at a later time.</p>
          ) : null}
          {hasHistory && (
            <PriceChart observations={observations} targetCents={tracked.target_price_cents} currency={tracked.currency} />
          )}
          {observations.length > 0 && (
            <ul className="grid gap-1.5 text-sm">
              {observations.slice(-5).reverse().map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="tnum font-medium">{formatCents(o.price_cents, o.currency)}</span>
                  <span className="min-w-0 flex-1 break-all text-muted-foreground">{o.domain}{o.is_baseline ? " · first observed" : ""}</span>
                  <SourceBadge source={o.source} />
                  <span className="text-xs text-muted-foreground">{timeAgo(o.observed_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid content-start gap-6">
          <section aria-label="Is it a good deal?" className="grid gap-3 rounded-2xl border bg-card p-4">
            <h2 className="text-lg font-semibold">Is it a good deal?</h2>
            {snap.ok && snap.evaluation && best ? (
              <>
                <p className="text-sm text-muted-foreground break-all">
                  {snap.evaluation.decision === "qualifies" ? "Matches what you asked for" : snap.evaluation.decision === "insufficient_info" ? "Missing information" : "Doesn't match what you asked for yet"} at {best.domain}
                </p>
                <RuleList evaluation={snap.evaluation} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">We can&apos;t say without today&apos;s price.</p>
            )}
            {sorted.length > 1 && (
              <div className="grid gap-1.5 border-t pt-3">
                <h3 className="text-sm font-semibold">Every retailer today</h3>
                <ul className="tnum grid gap-1 text-sm">
                  {sorted.map((o) => (
                    <li key={o.domain} className="flex justify-between gap-3">
                      <span className="min-w-0 break-all text-muted-foreground">{o.domain}{o.inStock === false ? " (out of stock)" : ""}</span>
                      <span className="shrink-0 font-medium">{formatCents(o.priceCents, o.currency)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          {getEnv().DEMO_MODE && watching && <SimulatePanel trackedId={tracked.id} currency={tracked.currency} />}
        </div>
      </div>

      <AskBar
        placeholder="Ask PriceDrop about this item"
        suggestions={["Is this a good deal?", "Find cheaper alternatives", "Compare with similar products"]}
        context={{ product: `${product.source}:${product.external_id}` }}
      />

      <footer className="grid gap-2 border-t pt-4 text-sm text-muted-foreground">
        <p>Last checked {timeAgo(tracked.last_checked_at)}. Checks are scheduled every 30 minutes but can run hours late.</p>
        {product.source === "channel3" && <p className="text-xs">Retailer links may earn PriceDrop a commission.</p>}
        {tracked.status === "paused" && <p>Automatic checks are paused for this product.</p>}
        {behind && (
          <p role="status" className="rounded-lg bg-caution-soft px-3 py-2 text-caution">
            This item hasn&apos;t been checked in over 90 minutes, which can happen on our free scheduler. Use Check now for a fresh price.
          </p>
        )}
      </footer>
    </div>
  );
}
