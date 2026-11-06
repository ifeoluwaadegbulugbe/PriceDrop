import Link from "next/link";
import { AskBar } from "@/components/ask-bar";
import { DealCard } from "@/components/deal-card";
import { SavedView } from "@/components/saved-view";
import type { AlertRow, ObservationRow, ProductRow, TrackedRow } from "@/lib/db/types";
import { hydrateCards, type ProductRef } from "@/lib/discovery/service";
import { loadIntelligence } from "@/lib/intelligence/load";
import { getDeps } from "@/lib/serverDeps";
import { productKey, shopperState } from "@/lib/shopper";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Saved items - PriceDrop" };

export default async function SavedPage() {
  const { supabase, profile } = await getViewer();
  const deps = getDeps();
  const currency = profile?.currency ?? "USD";

  const [{ rows, activity }, savedRes, alertsRes, trackedRes, state] = await Promise.all([
    loadIntelligence(supabase, deps.now()),
    supabase.from("saved_products").select("product_id,created_at").order("created_at", { ascending: false }).limit(48),
    supabase.from("deal_alerts").select("*").in("status", ["open", "checkout_prepared"]).order("created_at", { ascending: false }).limit(20),
    supabase.from("tracked_products").select("*").neq("status", "removed").limit(200),
    shopperState(supabase),
  ]);
  const savedRows = (savedRes.data ?? []) as { product_id: string; created_at: string }[];
  const alerts = (alertsRes.data ?? []) as AlertRow[];
  const trackedById = new Map(((trackedRes.data ?? []) as TrackedRow[]).map((t) => [t.id, t]));

  const productIds = [...new Set([...savedRows.map((s) => s.product_id), ...[...trackedById.values()].map((t) => t.product_id)])];
  const { data: productData } = productIds.length ? await supabase.from("products").select("*").in("id", productIds) : { data: [] };
  const products = new Map(((productData ?? []) as ProductRow[]).map((p) => [p.id, p]));
  const { data: obsData } = alerts.length ? await supabase.from("price_observations").select("*").in("id", alerts.map((a) => a.observation_id)) : { data: [] };
  const obsById = new Map(((obsData ?? []) as ObservationRow[]).map((o) => [o.id, o]));

  // Hearted items with no ideal price. Anything being watched already appears as a row.
  const watching = new Set(rows.map((r) => productKey(r.source, r.externalId)));
  const refs: ProductRef[] = savedRows.flatMap((s) => {
    const p = products.get(s.product_id);
    return p && !watching.has(productKey(p.source, p.external_id)) ? [{ source: p.source, id: p.external_id }] : [];
  });
  const savedOnly = await hydrateCards(deps, refs, currency);
  const nothing = rows.length === 0 && savedOnly.length === 0;

  return (
    <div className="grid gap-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-semibold">Saved items</h1>
        <div className="flex gap-4 text-sm font-medium">
          <Link href="/price-intelligence" className="text-primary hover:underline">Price details</Link>
          <Link href="/purchases" className="text-primary hover:underline">Purchases</Link>
        </div>
      </div>

      {!nothing && (
        <AskBar
          placeholder="Ask about your saved items"
          suggestions={["Which of my saved items is cheapest?", "Which one has dropped the most?", "Which are closest to my ideal price?", "Are any of my saved items at my ideal price?"]}
        />
      )}

      {alerts.length > 0 && (
        <section aria-label="Ready when you are" className="grid gap-3">
          <h2 className="text-xl font-semibold">Ready when you are ({alerts.length})</h2>
          <p className="-mt-1 text-sm text-muted-foreground">These prices are as last checked. We check the live price again before checkout.</p>
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

      {nothing ? (
        <div className="grid justify-items-center gap-2 rounded-2xl border border-dashed p-10 text-center">
          <p className="font-medium">Nothing saved yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">Tap the heart on anything you like and it&apos;ll wait for you here. Set your ideal price and I&apos;ll keep an eye on it.</p>
          <Link href="/assistant" className="mt-1 text-sm font-medium text-primary hover:underline">Find something you&apos;ll love</Link>
        </div>
      ) : (
        <SavedView rows={rows} savedOnly={savedOnly} updates={activity} currency={currency} savedKeys={state.savedKeys} trackedByKey={state.trackedByKey} />
      )}
    </div>
  );
}
