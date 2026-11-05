import { cn } from "cn";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FallbackBanner, ProductGrid } from "@/components/product-grid";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/errors";
import { searchCatalogue } from "@/lib/catalogue";
import { applyCardFilters, brandsIn, type SortKey } from "@/lib/discovery/filters";
import { categoryProducts, childrenOf, loadCategories, type ListResult } from "@/lib/discovery/service";
import { parseMoneyInput } from "@/lib/format";
import { getDeps } from "@/lib/serverDeps";
import { shopperState } from "@/lib/shopper";
import { enforceRateLimit } from "@/lib/usage";
import { getViewer } from "@/lib/viewer";

type Params = { sub?: string; q?: string; brand?: string; max?: string; sort?: string; stock?: string };

const SORTS: { value: SortKey; label: string }[] = [
  { value: "relevance", label: "Best match" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: `${slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase())} - PriceDrop` };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Params> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { supabase, user, profile } = await getViewer();
  const deps = getDeps();
  const currency = profile?.currency ?? "USD";

  const all = await loadCategories(deps);
  const category = all.find((c) => c.slug === slug && c.parent_id === null);
  if (!category) notFound();
  const subs = childrenOf(all, category);
  const sub = subs.find((s) => s.slug === sp.sub) ?? null;
  const active = sub ?? category;

  const q = (sp.q ?? "").trim().slice(0, 200);
  let result: ListResult = { cards: [], source: "none", fallbackReason: null };
  let notice: string | null = null;
  try {
    if (q) {
      // Each search within a category is a paid call, so it is rate limited and budget guarded.
      await enforceRateLimit(deps.db, user.id, "search", 20, 60, deps.now());
      const r = await searchCatalogue(deps, q, { currency, categorySlugs: active.channel3_slugs, seedTerms: active.seed_terms });
      result = {
        cards: r.products.map((c) => ({ ...c, offers: c.offers.map((o) => ({ ...o, url: null })), fetchedAt: r.fetchedAt })),
        source: r.source,
        fallbackReason: r.fallbackReason,
      };
    } else {
      result = await categoryProducts(deps, active, currency, { allowRefresh: true });
    }
  } catch (e) {
    notice = e instanceof ApiError ? e.publicMessage : "We couldn't load products just now. Please try again.";
  }

  const prefs = profile?.shopping_preferences ?? [];
  const sort: SortKey = (SORTS.find((s) => s.value === sp.sort)?.value) ?? (prefs.includes("lowest_price") ? "price_asc" : "relevance");
  const inStockOnly = sp.stock === undefined ? prefs.includes("in_stock_only") : sp.stock === "1";
  const maxCents = sp.max ? (parseMoneyInput(sp.max) ?? undefined) : undefined;
  const cards = applyCardFilters(result.cards, { brand: sp.brand, maxCents, inStockOnly, sort });
  const brands = brandsIn(result.cards);

  const state = await shopperState(supabase);
  const hrefFor = (s: string | null) => `/categories/${category.slug}${s ? `?sub=${s}` : ""}`;
  const chip = (on: boolean) => cn("inline-flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm whitespace-nowrap", on ? "border-primary bg-accent font-medium text-accent-foreground" : "bg-card hover:bg-muted");

  return (
    <div className="grid gap-5">
      <nav aria-label="Breadcrumb"><Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">Home</Link></nav>
      <div>
        <h1 className="text-3xl font-semibold sm:text-4xl">{active.name}</h1>
        <p className="mt-1 text-muted-foreground">{sub ? `In ${category.name}` : category.description}</p>
      </div>

      {subs.length > 0 && (
        <nav aria-label="Subcategories" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <Link href={hrefFor(null)} aria-current={!sub ? "page" : undefined} className={chip(!sub)}>All</Link>
          {subs.map((s) => <Link key={s.slug} href={hrefFor(s.slug)} aria-current={sub?.slug === s.slug ? "page" : undefined} className={chip(sub?.slug === s.slug)}>{s.name}</Link>)}
        </nav>
      )}

      <form method="get" className="grid grid-cols-2 items-end gap-3 rounded-2xl border bg-card p-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto_auto]">
        {sub && <input type="hidden" name="sub" value={sub.slug} />}
        <div className="col-span-2 grid gap-1 md:col-span-1">
          <label htmlFor="c-q" className="text-xs font-medium">Search in {active.name}</label>
          <input id="c-q" name="q" type="search" defaultValue={q} className="h-10 rounded-lg border border-input bg-background px-3 text-base md:text-sm" />
        </div>
        <div className="grid gap-1">
          <label htmlFor="c-brand" className="text-xs font-medium">Brand</label>
          <select id="c-brand" name="brand" defaultValue={sp.brand ?? ""} className="h-10 min-w-0 rounded-lg border border-input bg-background px-2 text-sm">
            <option value="">Any</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="c-max" className="text-xs font-medium">Max price ({currency})</label>
          <input id="c-max" name="max" inputMode="decimal" defaultValue={sp.max ?? ""} className="tnum h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-base md:text-sm" />
        </div>
        <div className="grid gap-1">
          <label htmlFor="c-sort" className="text-xs font-medium">Sort</label>
          <select id="c-sort" name="sort" defaultValue={sort} className="h-10 min-w-0 rounded-lg border border-input bg-background px-2 text-sm">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="c-stock" className="text-xs font-medium">Availability</label>
          <select id="c-stock" name="stock" defaultValue={inStockOnly ? "1" : "0"} className="h-10 min-w-0 rounded-lg border border-input bg-background px-2 text-sm">
            <option value="0">Any</option>
            <option value="1">In stock</option>
          </select>
        </div>
        <Button type="submit" size="lg" variant="secondary" className="col-span-2 h-10 md:col-span-1">Apply</Button>
      </form>

      {notice && <p role="alert" className="text-sm text-destructive">{notice}</p>}
      <FallbackBanner reason={result.source === "seed" ? result.fallbackReason : null} />

      {cards.length > 0 ? (
        <ProductGrid cards={cards} currency={currency} {...state} />
      ) : !notice && (
        <div className="grid justify-items-center gap-2 rounded-2xl border border-dashed p-10 text-center">
          <p className="font-medium">{result.cards.length > 0 ? "Nothing matches those filters" : "No products here right now"}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {result.cards.length > 0
              ? "Try removing a filter or raising your maximum price."
              : "We only show real products, and we don't have any to show for this one yet. You can still search for what you want."}
          </p>
          <Link href="/search" className="mt-1 text-sm font-medium text-primary hover:underline">Search all products</Link>
        </div>
      )}
    </div>
  );
}
