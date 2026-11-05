import { ArrowRight, TrendingDown } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DeltaBadge, DemoCatalogueBadge, SimulationBadge, TrackedStatusBadge } from "@/components/badges";
import { CategoryTile } from "@/components/category-tile";
import { DealCard } from "@/components/deal-card";
import { FallbackBanner, GridSkeleton, ProductGrid } from "@/components/product-grid";
import { ProductTile } from "@/components/product-tile";
import { SearchBar } from "@/components/search-bar";
import { Skeleton } from "@/components/ui/skeleton";
import type { AlertRow, CategoryRow, ObservationRow, ProductRow, ProfileRow, TrackedRow } from "@/lib/db/types";
import {
  categoryImages, hydrateCards, loadCategories, pickedForYou, popularProducts, topLevel, trendingDrops, type ProductRef,
} from "@/lib/discovery/service";
import { shopHref, timeAgo } from "@/lib/format";
import { liveSnapshot } from "@/lib/live";
import { formatCents } from "@/lib/money";
import { getDeps } from "@/lib/serverDeps";
import { shopperState } from "@/lib/shopper";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Home - PriceDrop" };

type Supabase = Awaited<ReturnType<typeof getViewer>>["supabase"];
type State = { savedKeys: string[]; trackedByKey: Record<string, string> };

function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-3" aria-label={title}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold sm:text-2xl">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

async function CategoryTiles({ tops, currency }: { tops: CategoryRow[]; currency: string }) {
  const images = await categoryImages(getDeps(), tops, currency);
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tops.map((c, i) => (
        // Wide tiles at 0, 5, 6 and 11 fill the four-column grid exactly.
        <li key={c.slug} className={[0, 5, 6, 11].includes(i) ? "md:col-span-2" : ""}>
          <CategoryTile category={c} imageUrl={images[c.slug] ?? null} className="h-full" />
        </li>
      ))}
    </ul>
  );
}

async function PickedSection({ profile, all, state }: { profile: ProfileRow; all: CategoryRow[]; state: State }) {
  if ((profile.interests ?? []).length === 0) {
    return (
      <Section title="Picked for you">
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Tell us what you like and we&apos;ll pick products for you.{" "}
          <Link href="/settings" className="font-medium text-primary hover:underline">Choose your interests</Link>
        </p>
      </Section>
    );
  }
  const picks = await pickedForYou(getDeps(), profile, all);
  if (picks.cards.length === 0) {
    return (
      <Section title="Picked for you">
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          We don&apos;t have products to show for your interests right now. Try searching, or{" "}
          <Link href="/settings" className="font-medium text-primary hover:underline">add more interests</Link>.
        </p>
      </Section>
    );
  }
  return (
    <Section title="Picked for you" subtitle={`Based on your interest in ${picks.basedOn.join(", ")}`}>
      {picks.source === "seed" && <FallbackBanner reason="no_api_key" />}
      <ProductGrid rail cards={picks.cards} currency={profile.currency} {...state} />
    </Section>
  );
}

async function TrendingSection() {
  const drops = await trendingDrops(getDeps(), 8);
  return (
    <Section title="Verified price drops" subtitle="Prices we watched fall at the same retailer in the last 7 days">
      {drops.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No verified drops this week. We only show a drop when we recorded the higher price ourselves.
        </p>
      ) : (
        <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 lg:grid-cols-4">
          {drops.map((d) => {
            return (
              <li key={`${d.ref.source}:${d.ref.id}`} className="w-48 shrink-0 snap-start md:w-auto">
                <Link href={shopHref(d.ref.source, d.ref.id)} className="flex h-full flex-col overflow-hidden rounded-2xl border bg-card hover:border-primary/50">
                  <div className="relative">
                    <ProductTile title={d.title} imageUrl={d.imageUrl} className="w-full rounded-none bg-white" />
                    <span className="tnum absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-deal px-2 py-0.5 text-xs font-semibold text-background">
                      <TrendingDown aria-hidden className="size-3.5" />
                      {d.percent}% lower
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <p className="line-clamp-2 text-sm leading-snug font-medium break-words">{d.title}</p>
                    <p className="tnum">
                      <span className="font-display text-lg font-semibold">{formatCents(d.priceCents, d.currency)}</span>{" "}
                      <s className="text-xs text-muted-foreground">{formatCents(d.previousCents, d.currency)}</s>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{d.domain}</p>
                    <p className="text-xs text-muted-foreground">Checked {timeAgo(d.observedAt)}</p>
                    {d.simulated && <SimulationBadge className="self-start" />}
                    <span className="mt-auto pt-1 text-sm font-medium text-primary">Track price</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

async function PopularSection({ profile, state }: { profile: ProfileRow; state: State }) {
  const cards = await popularProducts(getDeps(), profile.currency);
  if (cards.length === 0) return null; // Only with real signal.
  return (
    <Section title="Popular on PriceDrop" subtitle="Saved or tracked by several shoppers">
      <ProductGrid rail cards={cards} currency={profile.currency} {...state} />
    </Section>
  );
}

async function RecentSection({ supabase, profile, state }: { supabase: Supabase; profile: ProfileRow; state: State }) {
  const { data } = await supabase.from("recently_viewed").select("product_id").order("viewed_at", { ascending: false }).limit(8);
  const ids = ((data ?? []) as { product_id: string }[]).map((r) => r.product_id);
  if (ids.length === 0) return null;
  const { data: products } = await supabase.from("products").select("id,source,external_id").in("id", ids);
  const byId = new Map(((products ?? []) as { id: string; source: "channel3" | "seed"; external_id: string }[]).map((p) => [p.id, p]));
  const refs: ProductRef[] = ids.flatMap((id) => {
    const p = byId.get(id);
    return p ? [{ source: p.source, id: p.external_id }] : [];
  });
  const cards = await hydrateCards(getDeps(), refs, profile.currency);
  if (cards.length === 0) return null;
  return (
    <Section title="Recently viewed">
      <ProductGrid rail cards={cards} currency={profile.currency} {...state} />
    </Section>
  );
}

async function TrackedPreview({ supabase, alerts }: { supabase: Supabase; alerts: AlertRow[] }) {
  const { data: trackedData } = await supabase
    .from("tracked_products")
    .select("*")
    .neq("status", "removed")
    .order("created_at", { ascending: false })
    .limit(4);
  const tracked = (trackedData ?? []) as TrackedRow[];

  const alertTrackedIds = [...new Set(alerts.slice(0, 2).map((a) => a.tracked_product_id))];
  const { data: alertTracked } = alertTrackedIds.length
    ? await supabase.from("tracked_products").select("*").in("id", alertTrackedIds)
    : { data: [] };
  const allTracked = [...tracked, ...((alertTracked ?? []) as TrackedRow[])];
  const productIds = [...new Set(allTracked.map((t) => t.product_id))];
  const { data: productData } = productIds.length ? await supabase.from("products").select("*").in("id", productIds) : { data: [] };
  const products = new Map(((productData ?? []) as ProductRow[]).map((p) => [p.id, p]));
  const trackedById = new Map(allTracked.map((t) => [t.id, t]));
  const { data: obsData } = alerts.length
    ? await supabase.from("price_observations").select("*").in("id", alerts.slice(0, 2).map((a) => a.observation_id))
    : { data: [] };
  const obsById = new Map(((obsData ?? []) as ObservationRow[]).map((o) => [o.id, o]));

  const deps = getDeps();
  const snapshots = new Map(await Promise.all(tracked.map(async (t) => {
    const p = products.get(t.product_id);
    if (!p || t.status === "purchased") return [t.id, null] as const;
    return [t.id, await liveSnapshot(deps, t, p)] as const;
  })));

  return (
    <Section title="Your watchlist" action={<Link href="/watchlist" className="text-sm font-medium text-primary hover:underline">See all</Link>}>
      {alerts.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {alerts.slice(0, 2).map((a) => {
            const t = trackedById.get(a.tracked_product_id);
            return (
              <li key={a.id}>
                <DealCard alert={a} tracked={t} product={t ? products.get(t.product_id) : undefined} observation={obsById.get(a.observation_id)} />
              </li>
            );
          })}
        </ul>
      )}
      {tracked.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nothing tracked yet. Find something you like and tap Track price.
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {tracked.map((t) => {
            const p = products.get(t.product_id);
            const s = snapshots.get(t.id);
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
  );
}

const sectionFallback = (
  <div className="grid gap-3">
    <Skeleton className="h-7 w-48" />
    <GridSkeleton count={4} />
  </div>
);

export default async function Home() {
  const { supabase, profile } = await getViewer();
  if (profile && !profile.onboarded) redirect("/onboarding");
  if (!profile) redirect("/login");

  const deps = getDeps();
  const [all, state, alertsRes] = await Promise.all([
    loadCategories(deps),
    shopperState(supabase),
    supabase.from("deal_alerts").select("*").in("status", ["open", "checkout_prepared"]).order("created_at", { ascending: false }).limit(10),
  ]);
  const alerts = (alertsRes.data ?? []) as AlertRow[];
  const tops = topLevel(all);

  return (
    <div className="grid gap-8 sm:gap-10">
      <h1 className="sr-only">Shop with PriceDrop</h1>
      <SearchBar />

      {alerts.length > 0 && (
        <Link href="/watchlist" className="flex items-center justify-between gap-3 rounded-2xl bg-deal-soft px-4 py-3 text-sm font-medium text-deal">
          {alerts.length === 1 ? "1 deal is" : `${alerts.length} deals are`} waiting for your review
          <ArrowRight aria-hidden className="size-4 shrink-0" />
        </Link>
      )}

      <Section title="Shop by category">
        <Suspense fallback={<GridSkeleton count={8} />}>
          <CategoryTiles tops={tops} currency={profile.currency} />
        </Suspense>
      </Section>

      <Suspense fallback={sectionFallback}><PickedSection profile={profile} all={all} state={state} /></Suspense>
      <Suspense fallback={sectionFallback}><TrendingSection /></Suspense>
      <Suspense fallback={null}><PopularSection profile={profile} state={state} /></Suspense>
      <Suspense fallback={null}><RecentSection supabase={supabase} profile={profile} state={state} /></Suspense>
      <Suspense fallback={sectionFallback}><TrackedPreview supabase={supabase} alerts={alerts} /></Suspense>
    </div>
  );
}
