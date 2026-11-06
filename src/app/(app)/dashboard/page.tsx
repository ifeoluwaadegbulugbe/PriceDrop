import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AskBar } from "@/components/ask-bar";
import { CategoryTile } from "@/components/category-tile";
import { GettingStarted } from "@/components/checklist";
import { DropCard } from "@/components/drop-card";
import { Greeting } from "@/components/greeting";
import { FallbackBanner, GridSkeleton, ProductGrid } from "@/components/product-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { loadChecklist } from "@/lib/checklist-load";
import type { CategoryRow, ProfileRow } from "@/lib/db/types";
import {
  hydrateCards, loadCategories, pickedForYou, popularProducts, topLevel, trendingDrops, type ProductRef,
} from "@/lib/discovery/service";
import { getDeps } from "@/lib/serverDeps";
import { shopperState } from "@/lib/shopper";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Home - PriceDrop" };

type Supabase = Awaited<ReturnType<typeof getViewer>>["supabase"];
type State = { savedKeys: string[]; trackedByKey: Record<string, string> };

const PROMPTS = [
  "Find me a good phone under $300",
  "I need a laptop for university",
  "Find affordable skincare for my routine",
  "Help me find a birthday gift for my sister",
  "Which of my saved items has the best price?",
];

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

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>
);

function CategoryTiles({ tops }: { tops: CategoryRow[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tops.map((c, i) => (
        // Wide tiles at 0, 5, 6 and 11 fill the four-column grid exactly.
        <li key={c.slug} className={[0, 5, 6, 11].includes(i) ? "md:col-span-2" : ""}>
          <CategoryTile category={c} className="h-full" />
        </li>
      ))}
    </ul>
  );
}

async function PickedSection({ profile, all, state }: { profile: ProfileRow; all: CategoryRow[]; state: State }) {
  const title = "Picked for you";
  if ((profile.interests ?? []).length === 0) {
    return (
      <Section title={title}>
        <Empty>
          Tell us what you like and we&apos;ll pick products for you.{" "}
          <Link href="/settings" className="font-medium text-primary hover:underline">Choose what you love</Link>
        </Empty>
      </Section>
    );
  }
  const picks = await pickedForYou(getDeps(), profile, all);
  if (picks.cards.length === 0) {
    return (
      <Section title={title}>
        <Empty>
          We don&apos;t have products to show for your interests right now. Try asking PriceDrop, or{" "}
          <Link href="/settings" className="font-medium text-primary hover:underline">add more interests</Link>.
        </Empty>
      </Section>
    );
  }
  return (
    <Section title={title} subtitle={`Products we think you'll love, based on your interest in ${picks.basedOn.join(", ")}.`}>
      {picks.source === "seed" && <FallbackBanner reason="no_api_key" />}
      <ProductGrid rail cards={picks.cards} currency={profile.currency} {...state} />
    </Section>
  );
}

async function DropsSection() {
  const drops = await trendingDrops(getDeps(), 8);
  const title = "Prices have dropped";
  return (
    <Section
      title={title}
      subtitle="Take another look at these products."
      action={drops.length > 0 ? <Link href="/price-drops" className="shrink-0 text-sm font-medium text-primary hover:underline">See all</Link> : undefined}
    >
      {drops.length === 0 ? (
        <Empty>No price drops this week. We only show a drop when we recorded the higher price ourselves.</Empty>
      ) : (
        <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 lg:grid-cols-4">
          {drops.map((d) => (
            <li key={`${d.ref.source}:${d.ref.id}`} className="w-48 shrink-0 snap-start md:w-auto"><DropCard drop={d} /></li>
          ))}
        </ul>
      )}
    </Section>
  );
}

async function PopularSection({ profile, state }: { profile: ProfileRow; state: State }) {
  const cards = await popularProducts(getDeps(), profile.currency);
  if (cards.length === 0) return null; // Only with real signal.
  return (
    <Section title="Popular on PriceDrop" subtitle="Saved or watched by several shoppers">
      <ProductGrid rail cards={cards} currency={profile.currency} {...state} />
    </Section>
  );
}

async function refsFor(supabase: Supabase, ids: string[]): Promise<ProductRef[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("products").select("id,source,external_id").in("id", ids);
  const byId = new Map(((data ?? []) as { id: string; source: "channel3" | "seed"; external_id: string }[]).map((p) => [p.id, p]));
  return ids.flatMap((id) => {
    const p = byId.get(id);
    return p ? [{ source: p.source, id: p.external_id }] : [];
  });
}

async function RecentSection({ supabase, profile, state }: { supabase: Supabase; profile: ProfileRow; state: State }) {
  const { data } = await supabase.from("recently_viewed").select("product_id").order("viewed_at", { ascending: false }).limit(8);
  const refs = await refsFor(supabase, ((data ?? []) as { product_id: string }[]).map((r) => r.product_id));
  const cards = await hydrateCards(getDeps(), refs, profile.currency);
  if (cards.length === 0) return null;
  return (
    <Section title="Recently viewed">
      <ProductGrid rail cards={cards} currency={profile.currency} {...state} />
    </Section>
  );
}

async function SavedPreview({ supabase, profile, state }: { supabase: Supabase; profile: ProfileRow; state: State }) {
  const [saved, watched] = await Promise.all([
    supabase.from("saved_products").select("product_id,created_at").order("created_at", { ascending: false }).limit(4),
    supabase.from("tracked_products").select("product_id,created_at").neq("status", "removed").order("created_at", { ascending: false }).limit(4),
  ]);
  const recent = [...((saved.data ?? []) as { product_id: string; created_at: string }[]), ...((watched.data ?? []) as { product_id: string; created_at: string }[])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const ids = [...new Set(recent.map((r) => r.product_id))].slice(0, 4);
  const cards = await hydrateCards(getDeps(), await refsFor(supabase, ids), profile.currency);
  return (
    <Section title="Your saved items" action={cards.length > 0 ? <Link href="/saved" className="shrink-0 text-sm font-medium text-primary hover:underline">See all</Link> : undefined}>
      {cards.length === 0 ? (
        <Empty>Nothing saved yet. Tap the heart on anything you like and it&apos;ll wait for you here.</Empty>
      ) : (
        <ProductGrid rail cards={cards} currency={profile.currency} {...state} />
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
  const [all, state, checklist, waiting] = await Promise.all([
    loadCategories(deps),
    shopperState(supabase),
    loadChecklist(supabase, profile),
    supabase.from("deal_alerts").select("id", { count: "exact", head: true }).in("status", ["open", "checkout_prepared"]),
  ]);
  const ready = waiting.count ?? 0;
  const tops = topLevel(all);

  return (
    <div className="grid gap-8 sm:gap-10">
      {checklist.visible && <GettingStarted checklist={checklist} />}

      <section aria-label="Ask PriceDrop" className="grid gap-4 rounded-3xl bg-accent/70 p-5 sm:p-8">
        <Greeting />
        <div>
          <h1 className="text-3xl leading-tight font-semibold sm:text-4xl">What are we shopping for today?</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">Tell me what you need, what you love or how much you want to spend. I&apos;ll help you find it.</p>
        </div>
        <AskBar large suggestions={PROMPTS} />
      </section>

      {ready > 0 && (
        <Link href="/saved" className="flex items-center justify-between gap-3 rounded-2xl bg-deal-soft px-4 py-3 text-sm font-medium text-deal">
          {ready === 1 ? "1 item is" : `${ready} items are`} at your ideal price
          <ArrowRight aria-hidden className="size-4 shrink-0" />
        </Link>
      )}

      <Section title="Explore products">
        <CategoryTiles tops={tops} />
      </Section>

      <Suspense fallback={sectionFallback}><PickedSection profile={profile} all={all} state={state} /></Suspense>
      <Suspense fallback={sectionFallback}><DropsSection /></Suspense>
      <Suspense fallback={null}><RecentSection supabase={supabase} profile={profile} state={state} /></Suspense>
      <Suspense fallback={sectionFallback}><SavedPreview supabase={supabase} profile={profile} state={state} /></Suspense>
      <Suspense fallback={null}><PopularSection profile={profile} state={state} /></Suspense>
    </div>
  );
}
