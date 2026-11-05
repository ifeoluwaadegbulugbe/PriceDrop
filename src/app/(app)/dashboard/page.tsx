import Link from "next/link";
import { redirect } from "next/navigation";
import { AssistantBox } from "@/components/assistant-box";
import { DeltaBadge, DemoCatalogueBadge, SimulationBadge, TrackedStatusBadge } from "@/components/badges";
import { DealCard } from "@/components/deal-card";
import { ProductTile } from "@/components/product-tile";
import type { ActivityRow, AlertRow, ObservationRow, ProductRow, PurchaseRow, TrackedRow } from "@/lib/db/types";
import { timeAgo } from "@/lib/format";
import { liveSnapshot } from "@/lib/live";
import { formatCents } from "@/lib/money";
import { getDeps } from "@/lib/serverDeps";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Dashboard - PriceDrop" };

const ACTIVITY: Record<string, string> = {
  interpreted_request: "Read your request",
  searched: "Searched for products",
  tracking_started: "Started tracking a product",
  check_monitor: "Automatic price check",
  check_user: "You ran a price check",
  check_baseline: "Recorded a starting price",
  check_demo: "Ran a demo simulation",
  deal_found: "Found a deal that meets your rules",
  deal_improved: "An open deal got cheaper",
  deal_dismissed: "You dismissed a deal",
  checkout_prepared: "Prepared a sandbox checkout",
  prepare_rejected: "Live price no longer qualified, so no checkout was prepared",
  capture_confirmed: "PayPal confirmed a sandbox capture",
  capture_failed: "A sandbox payment didn't complete",
  checkout_cancelled: "You cancelled a sandbox checkout",
};

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-3" aria-label={title}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function Dashboard() {
  const { supabase, user, profile } = await getViewer();
  if (profile && !profile.onboarded) redirect("/onboarding");

  const [trackedRes, alertsRes, activityRes, purchasesRes] = await Promise.all([
    supabase.from("tracked_products").select("*").neq("status", "removed").order("created_at", { ascending: false }).limit(12),
    supabase.from("deal_alerts").select("*").in("status", ["open", "checkout_prepared"]).order("created_at", { ascending: false }).limit(10),
    supabase.from("agent_activity").select("*").order("created_at", { ascending: false }).limit(8),
    supabase.from("purchases").select("*").order("purchased_at", { ascending: false }).limit(3),
  ]);
  const tracked = (trackedRes.data ?? []) as TrackedRow[];
  const alerts = (alertsRes.data ?? []) as AlertRow[];
  const activity = (activityRes.data ?? []) as ActivityRow[];
  const purchases = (purchasesRes.data ?? []) as PurchaseRow[];

  // A deal can belong to a product outside the 12 most recent, so fetch those too.
  const shownTracked = new Set(tracked.map((t) => t.id));
  const missingTrackedIds = [...new Set(alerts.map((a) => a.tracked_product_id))].filter((id) => !shownTracked.has(id));
  const { data: extraTracked } = missingTrackedIds.length
    ? await supabase.from("tracked_products").select("*").in("id", missingTrackedIds)
    : { data: [] };
  const allTracked = [...tracked, ...((extraTracked ?? []) as TrackedRow[])];

  const productIds = [...new Set([...allTracked.map((t) => t.product_id), ...purchases.map((p) => p.product_id)])];
  const { data: productData } = productIds.length
    ? await supabase.from("products").select("*").in("id", productIds)
    : { data: [] };
  const products = new Map(((productData ?? []) as ProductRow[]).map((p) => [p.id, p]));
  const trackedById = new Map(allTracked.map((t) => [t.id, t]));
  // Keep each product's deals together, cheapest first.
  const sortedAlerts = [...alerts].sort(
    (a, b) => a.tracked_product_id.localeCompare(b.tracked_product_id) || a.price_cents - b.price_cents,
  );
  const { data: alertObs } = alerts.length
    ? await supabase.from("price_observations").select("*").in("id", alerts.map((a) => a.observation_id))
    : { data: [] };
  const obsById = new Map(((alertObs ?? []) as ObservationRow[]).map((o) => [o.id, o]));

  const deps = getDeps();
  const snapshots = await Promise.all(
    tracked.map(async (t) => {
      const p = products.get(t.product_id);
      if (!p || t.status === "purchased") return [t.id, null] as const;
      return [t.id, await liveSnapshot(deps, t, p)] as const;
    }),
  );
  const snapshot = new Map(snapshots);
  const name = profile?.display_name?.trim();

  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <h1 className="text-3xl font-semibold">{name ? `Hi ${name}. What are we watching?` : "What are we watching?"}</h1>
        <AssistantBox />
      </div>

      {alerts.length > 0 && (
        <Section title={`Deals waiting for you (${alerts.length})`}>
          <p className="-mt-1 text-sm text-muted-foreground">These prices are as last observed. We re-check the live price before preparing a checkout.</p>
          <ul className="grid gap-3 md:grid-cols-2">
            {sortedAlerts.map((a) => {
              const t = trackedById.get(a.tracked_product_id);
              const siblings = alerts.filter((x) => x.tracked_product_id === a.tracked_product_id);
              const isLowest = siblings.length > 1 && a.price_cents === Math.min(...siblings.map((x) => x.price_cents));
              return (
                <li key={a.id}>
                  <DealCard
                    alert={a}
                    tracked={t}
                    product={t ? products.get(t.product_id) : undefined}
                    observation={obsById.get(a.observation_id)}
                    lowestOf={isLowest ? siblings.length : undefined}
                  />
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title="Tracked products" action={<Link href="/search" className="text-sm font-medium text-primary hover:underline">Find more</Link>}>
        {tracked.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nothing tracked yet. Tell the assistant what you want and what you&apos;d pay.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {tracked.map((t) => {
              const p = products.get(t.product_id);
              const s = snapshot.get(t.id);
              const best = s?.ok ? s.best : null;
              return (
                <li key={t.id}>
                  <Link href={`/products/${t.id}`} className="flex gap-3 rounded-2xl border bg-card p-3 hover:bg-muted/40">
                    <ProductTile title={p?.title ?? "Product"} imageUrl={p?.image_url ?? null} className="size-20" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-sm leading-snug font-medium break-words">{p?.title ?? "Product"}</p>
                        <TrackedStatusBadge status={t.status} />
                      </div>
                      {best ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="tnum text-lg font-semibold">{formatCents(best.priceCents, best.currency)}</span>
                          <DeltaBadge priceCents={best.priceCents} targetCents={t.target_price_cents} currency={t.currency} />
                          {best.observationSource === "seed" && <DemoCatalogueBadge />}
                          {best.observationSource === "demo_simulation" && <SimulationBadge />}
                        </div>
                      ) : t.status === "purchased" ? (
                        <p className="mt-1.5 text-sm text-muted-foreground">Bought in the sandbox</p>
                      ) : (
                        <p className="mt-1.5 text-sm text-muted-foreground">Current price unavailable right now</p>
                      )}
                      <p className="tnum mt-1 text-xs text-muted-foreground">
                        Target {formatCents(t.target_price_cents, t.currency)} · Last checked {timeAgo(t.last_checked_at)}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="grid gap-8 md:grid-cols-2">
        <Section title="Recent activity">
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet. What PriceDrop does for you will appear here.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {activity.map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-3">
                  <span>{ACTIVITY[a.action] ?? a.action.replace(/_/g, " ")}{a.status !== "ok" && <span className="text-muted-foreground"> ({a.status.replace(/_/g, " ")})</span>}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Purchase history" action={<Link href="/purchases" className="text-sm font-medium text-primary hover:underline">View all</Link>}>
          {purchases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No purchases yet. Purchases appear here only after PayPal confirms a capture.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {purchases.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{products.get(p.product_id)?.title ?? "Product"}</span>
                  <span className="tnum shrink-0 font-medium">{formatCents(p.amount_cents, p.currency)} <span className="text-xs font-normal text-caution">Sandbox</span></span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <p className="sr-only">Signed in as {user.email}</p>
    </div>
  );
}
