import Link from "next/link";
import { DealCard } from "@/components/deal-card";
import { TrackedStatusBadge } from "@/components/badges";
import { ProductGrid } from "@/components/product-grid";
import { ProductTile } from "@/components/product-tile";
import type { AlertRow, ObservationRow, ProductRow, TrackedRow } from "@/lib/db/types";
import { hydrateCards, type ProductRef } from "@/lib/discovery/service";
import { timeAgo } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { getDeps } from "@/lib/serverDeps";
import { shopperState } from "@/lib/shopper";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Watchlist - PriceDrop" };

export default async function WatchlistPage() {
  const { supabase, profile } = await getViewer();
  const deps = getDeps();
  const currency = profile?.currency ?? "USD";

  const [savedRes, trackedRes, alertsRes, state] = await Promise.all([
    supabase.from("saved_products").select("product_id").order("created_at", { ascending: false }).limit(48),
    supabase.from("tracked_products").select("*").neq("status", "removed").order("created_at", { ascending: false }).limit(48),
    supabase.from("deal_alerts").select("*").in("status", ["open", "checkout_prepared"]).order("created_at", { ascending: false }).limit(20),
    shopperState(supabase),
  ]);
  const savedIds = ((savedRes.data ?? []) as { product_id: string }[]).map((r) => r.product_id);
  const tracked = (trackedRes.data ?? []) as TrackedRow[];
  const alerts = (alertsRes.data ?? []) as AlertRow[];
  const trackedById = new Map(tracked.map((t) => [t.id, t]));

  const productIds = [...new Set([...savedIds, ...tracked.map((t) => t.product_id)])];
  const { data: productData } = productIds.length ? await supabase.from("products").select("*").in("id", productIds) : { data: [] };
  const products = new Map(((productData ?? []) as ProductRow[]).map((p) => [p.id, p]));
  const { data: obsData } = alerts.length
    ? await supabase.from("price_observations").select("*").in("id", alerts.map((a) => a.observation_id))
    : { data: [] };
  const obsById = new Map(((obsData ?? []) as ObservationRow[]).map((o) => [o.id, o]));

  const refs: ProductRef[] = savedIds.flatMap((id) => {
    const p = products.get(id);
    return p ? [{ source: p.source, id: p.external_id }] : [];
  });
  const savedCards = await hydrateCards(deps, refs, currency);

  const nothing = savedCards.length === 0 && tracked.length === 0;

  return (
    <div className="grid gap-8">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-3xl font-semibold">Watchlist</h1>
        <Link href="/price-intelligence" className="text-sm font-medium text-primary hover:underline">Price Intelligence</Link>
      </div>

      {alerts.length > 0 && (
        <section aria-label="Deals waiting" className="grid gap-3">
          <h2 className="text-xl font-semibold">Deals waiting for you ({alerts.length})</h2>
          <p className="-mt-1 text-sm text-muted-foreground">These prices are as last observed. We re-check the live price before preparing a checkout.</p>
          <ul className="grid gap-3 md:grid-cols-2">
            {alerts.map((a) => {
              const t = trackedById.get(a.tracked_product_id);
              const siblings = alerts.filter((x) => x.tracked_product_id === a.tracked_product_id);
              const isLowest = siblings.length > 1 && a.price_cents === Math.min(...siblings.map((x) => x.price_cents));
              return (
                <li key={a.id}>
                  <DealCard alert={a} tracked={t} product={t ? products.get(t.product_id) : undefined} observation={obsById.get(a.observation_id)} lowestOf={isLowest ? siblings.length : undefined} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {tracked.length > 0 && (
        <section aria-label="Tracking" className="grid gap-3">
          <h2 className="text-xl font-semibold">Tracking</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {tracked.map((t) => {
              const p = products.get(t.product_id);
              return (
                <li key={t.id}>
                  <Link href={`/products/${t.id}`} className="flex gap-3 rounded-2xl border bg-card p-3 hover:bg-muted/40">
                    <ProductTile title={p?.title ?? "Product"} imageUrl={p?.image_url ?? null} className="size-16" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-sm leading-snug font-medium break-words">{p?.title ?? "Product"}</p>
                        <TrackedStatusBadge status={t.status} />
                      </div>
                      <p className="tnum mt-1 text-xs text-muted-foreground">
                        Target {formatCents(t.target_price_cents, t.currency)} · Last checked {timeAgo(t.last_checked_at)}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {savedCards.length > 0 && (
        <section aria-label="Saved" className="grid gap-3">
          <h2 className="text-xl font-semibold">Saved</h2>
          <ProductGrid cards={savedCards} currency={currency} {...state} />
        </section>
      )}

      {nothing && (
        <div className="grid justify-items-center gap-2 rounded-2xl border border-dashed p-10 text-center">
          <p className="font-medium">Your watchlist is empty</p>
          <p className="max-w-sm text-sm text-muted-foreground">Tap the heart on anything you like, or set a target price and we&apos;ll watch it for you.</p>
          <Link href="/dashboard" className="mt-1 text-sm font-medium text-primary hover:underline">Start shopping</Link>
        </div>
      )}
    </div>
  );
}
