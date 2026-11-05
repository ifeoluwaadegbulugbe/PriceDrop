import { logActivity } from "@/lib/activity";
import { ApiError, notFound } from "@/lib/api/errors";
import type { FallbackReason } from "@/lib/catalogue";
import { fetchProductCard } from "@/lib/catalogue";
import { searchSeed, seedById } from "@/lib/catalogue/seed";
import type { ProductCard } from "@/lib/channel3/normalize";
import type { CategoryRow, ProductRow } from "@/lib/db/types";
import type { Deps } from "@/lib/deps";
import { channel3BudgetKey, bumpCounter } from "@/lib/usage";
import { applyCardFilters, boostBrands, dropPercent, interleave } from "./filters";

/** A product ID list may be reused for 2 days. Channel3 says IDs are safe to cache. */
export const LIST_TTL_MS = 48 * 3600 * 1000;
/** A snapshot, with prices, is reused for at most 30 minutes, and always shown with its fetched time. */
export const SNAPSHOT_TTL_MS = 30 * 60 * 1000;

export type ProductRef = { source: "channel3" | "seed"; id: string };
export type ShopCard = ProductCard & { fetchedAt: string };
export type ListResult = {
  cards: ShopCard[];
  source: "channel3" | "seed" | "none";
  fallbackReason: FallbackReason | null;
};
export type TrendingDrop = {
  ref: ProductRef;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  domain: string;
  priceCents: number;
  previousCents: number;
  percent: number;
  currency: string;
  observedAt: string;
  simulated: boolean;
};

const listKey = (currency: string, slug: string) => `list:${currency}:${slug}`;
const snapKey = (currency: string, id: string) => `product:${currency}:${id}`;

export async function loadCategories(deps: Deps): Promise<CategoryRow[]> {
  const { data } = await deps.db.from("categories").select("*").eq("active", true).order("display_order");
  return (data ?? []) as CategoryRow[];
}
export const topLevel = (all: CategoryRow[]) => all.filter((c) => c.parent_id === null);
export const childrenOf = (all: CategoryRow[], parent: CategoryRow) => all.filter((c) => c.parent_id === parent.id);

/** Stored offer URLs would go stale, and Channel3 says not to cache them. */
const withoutUrls = (card: ProductCard): ProductCard => ({ ...card, offers: card.offers.map((o) => ({ ...o, url: null })) });

async function writeSnapshots(deps: Deps, currency: string, cards: ProductCard[]) {
  if (cards.length === 0) return;
  const fetched_at = deps.now().toISOString();
  await deps.db.from("discovery_cache").upsert(
    cards.map((c) => ({ key: snapKey(currency, c.id), value: withoutUrls(c), fetched_at })),
    { onConflict: "key" },
  );
}

/** Cards for product refs. Fresh snapshot, else the free retrieve call, else an older snapshot. Never invented. */
export async function hydrateCards(deps: Deps, refs: ProductRef[], currency: string): Promise<ShopCard[]> {
  const now = deps.now();
  const byId = new Map<string, ShopCard>();
  const live = refs.filter((r) => r.source === "channel3");

  for (const r of refs) {
    if (r.source !== "seed") continue;
    const card = seedById(r.id);
    if (card) byId.set(`seed:${r.id}`, { ...card, fetchedAt: now.toISOString() });
  }

  if (live.length > 0) {
    const { data } = await deps.db
      .from("discovery_cache")
      .select("key,value,fetched_at")
      .in("key", live.map((r) => snapKey(currency, r.id)));
    const snaps = new Map(((data ?? []) as { key: string; value: ProductCard; fetched_at: string }[]).map((s) => [s.key, s]));

    const queue: ProductRef[] = [];
    for (const r of live) {
      const s = snaps.get(snapKey(currency, r.id));
      if (s && now.getTime() - new Date(s.fetched_at).getTime() < SNAPSHOT_TTL_MS) {
        byId.set(`channel3:${r.id}`, { ...s.value, fetchedAt: s.fetched_at });
      } else {
        queue.push(r);
      }
    }

    const fetched: ProductCard[] = [];
    const worker = async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        const stale = snaps.get(snapKey(currency, r.id));
        try {
          if (!deps.channel3) throw new Error("no gateway");
          const card = await deps.channel3.retrieve(r.id, currency);
          fetched.push(card);
          byId.set(`channel3:${r.id}`, { ...withoutUrls(card), fetchedAt: now.toISOString() });
        } catch {
          // Older data keeps its true timestamp, so the card reads "Checked 3 hr ago".
          if (stale) byId.set(`channel3:${r.id}`, { ...stale.value, fetchedAt: stale.fetched_at });
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    await writeSnapshots(deps, currency, fetched);
  }

  return refs.flatMap((r) => {
    const card = byId.get(`${r.source}:${r.id}`);
    return card ? [card] : [];
  });
}

function seedForCategory(terms: string[], query?: string): ProductCard[] {
  if (terms.length === 0) return [];
  const pool = new Map(terms.flatMap((t) => searchSeed(t)).map((c) => [c.id, c]));
  if (!query) return [...pool.values()];
  const matches = new Set(searchSeed(query).map((c) => c.id));
  return [...pool.values()].filter((c) => matches.has(c.id));
}

type CachedList = { ids: string[]; imageUrl: string | null };

async function readList(deps: Deps, key: string) {
  const { data } = await deps.db.from("discovery_cache").select("value,fetched_at").eq("key", key).maybeSingle();
  return data as { value: CachedList; fetched_at: string } | null;
}

/** Spends one credit, inside the monthly budget. Returns null when it couldn't. */
async function refreshList(deps: Deps, category: CategoryRow, currency: string): Promise<CachedList | "budget" | null> {
  if (!deps.channel3) return null;
  const allowed = await bumpCounter(deps.db, channel3BudgetKey(deps.now()), deps.channel3Budget);
  if (!allowed) return "budget";
  try {
    const cards = await deps.channel3.search({
      query: category.search_query,
      limit: 24,
      currency,
      categorySlugs: category.channel3_slugs,
    });
    const usable = cards.filter((c) => c.offers.length > 0);
    await writeSnapshots(deps, currency, usable);
    const value: CachedList = { ids: usable.map((c) => c.id), imageUrl: usable.find((c) => c.imageUrl)?.imageUrl ?? null };
    await deps.db
      .from("discovery_cache")
      .upsert({ key: listKey(currency, category.slug), value, fetched_at: deps.now().toISOString() }, { onConflict: "key" });
    return value;
  } catch {
    return null;
  }
}

/**
 * A category's products. Cached list if fresh; otherwise one paid refresh when allowed. A stale list beats
 * spending past the budget, and the labelled Demo catalogue is the last resort. Empty is an allowed answer.
 */
export async function categoryProducts(
  deps: Deps,
  category: CategoryRow,
  currency: string,
  opts: { allowRefresh: boolean; limit?: number },
): Promise<ListResult> {
  const seedResult = (fallbackReason: FallbackReason): ListResult => {
    const cards = seedForCategory(category.seed_terms).map((c) => ({ ...c, fetchedAt: deps.now().toISOString() }));
    return { cards: cards.slice(0, opts.limit), source: cards.length ? "seed" : "none", fallbackReason };
  };
  if (!deps.channel3) return seedResult("no_api_key");

  const key = listKey(currency, category.slug);
  const cached = await readList(deps, key);
  const fresh = cached && deps.now().getTime() - new Date(cached.fetched_at).getTime() < LIST_TTL_MS;

  let list: CachedList | null = fresh ? cached.value : null;
  let refreshFailure: FallbackReason | null = null;
  if (!list && opts.allowRefresh) {
    const refreshed = await refreshList(deps, category, currency);
    if (refreshed === "budget") refreshFailure = "budget_exhausted";
    else if (refreshed === null) refreshFailure = "api_error";
    else list = refreshed;
  }
  if (!list && cached) list = cached.value;
  if (!list) {
    if (refreshFailure) return seedResult(refreshFailure);
    return { cards: [], source: "none", fallbackReason: null }; // cold and not allowed to spend
  }

  const ids = opts.limit ? list.ids.slice(0, opts.limit) : list.ids;
  const cards = await hydrateCards(deps, ids.map((id) => ({ source: "channel3" as const, id })), currency);
  return { cards, source: cards.length ? "channel3" : "none", fallbackReason: null };
}

/** Top-level tile images: whatever the cached lists already hold. Costs nothing. */
export async function categoryImages(deps: Deps, categories: CategoryRow[], currency: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const c of categories) if (c.image_url) out[c.slug] = c.image_url;
  if (categories.length === 0) return out;
  const { data } = await deps.db
    .from("discovery_cache")
    .select("key,value")
    .in("key", categories.map((c) => listKey(currency, c.slug)));
  for (const row of (data ?? []) as { key: string; value: CachedList }[]) {
    const slug = row.key.split(":").pop()!;
    if (row.value.imageUrl && !out[slug]) out[slug] = row.value.imageUrl;
  }
  return out;
}

/** Called by the monitor: at most one stale category per run, and only under 60% of the monthly budget. */
export async function warmOneCategory(deps: Deps, currency = "USD"): Promise<string | null> {
  if (!deps.channel3) return null;
  const { data: counter } = await deps.db
    .from("usage_counters")
    .select("count")
    .eq("key", channel3BudgetKey(deps.now()))
    .maybeSingle();
  const used = (counter as { count: number } | null)?.count ?? 0;
  if (used * 100 >= deps.channel3Budget * 60) return null;

  const tops = topLevel(await loadCategories(deps));
  if (tops.length === 0) return null;
  const { data } = await deps.db
    .from("discovery_cache")
    .select("key,fetched_at")
    .in("key", tops.map((c) => listKey(currency, c.slug)));
  const age = new Map(((data ?? []) as { key: string; fetched_at: string }[]).map((r) => [r.key, new Date(r.fetched_at).getTime()]));
  const stale = tops
    .map((c) => ({ c, at: age.get(listKey(currency, c.slug)) ?? 0 }))
    .filter((x) => deps.now().getTime() - x.at >= LIST_TTL_MS)
    .sort((a, b) => a.at - b.at)[0];
  if (!stale) return null;
  const r = await refreshList(deps, stale.c, currency);
  return r && r !== "budget" ? stale.c.slug : null;
}

export type Picks = { cards: ShopCard[]; basedOn: string[]; source: ListResult["source"] };

/** "Picked for you": products from the person's chosen categories only. Empty when they chose none. */
export async function pickedForYou(
  deps: Deps,
  profile: { interests: string[]; favourite_brands: string[]; shopping_preferences?: string[]; currency: string },
  all: CategoryRow[],
  limit = 12,
): Promise<Picks> {
  const chosen = topLevel(all).filter((c) => profile.interests.includes(c.slug)).slice(0, 4);
  if (chosen.length === 0) return { cards: [], basedOn: [], source: "none" };
  const results = await Promise.all(
    // Refresh only the first two cold categories on a page view. The monitor warms the rest.
    chosen.map((c, i) => categoryProducts(deps, c, profile.currency, { allowRefresh: i < 2, limit: 8 })),
  );
  const prefs = profile.shopping_preferences ?? [];
  const contributing = chosen.filter((_, i) => results[i]!.cards.length > 0);
  const mixed = interleave(results.map((r) => r.cards));
  const unique = [...new Map(mixed.map((c) => [`${c.source}:${c.id}`, c])).values()];
  return {
    cards: applyCardFilters(boostBrands(unique, profile.favourite_brands), {
      inStockOnly: prefs.includes("in_stock_only"),
      sort: prefs.includes("lowest_price") ? "price_asc" : "relevance",
    }).slice(0, limit),
    basedOn: contributing.map((c) => c.name),
    source: results.some((r) => r.source === "channel3") ? "channel3" : contributing.length ? "seed" : "none",
  };
}

export async function trendingDrops(deps: Deps, limit = 12): Promise<TrendingDrop[]> {
  const since = new Date(deps.now().getTime() - 7 * 86400 * 1000).toISOString();
  const { data, error } = await deps.db.rpc("trending_price_drops", {
    p_since: since,
    p_limit: limit,
    p_include_simulated: deps.demoMode,
  });
  if (error || !Array.isArray(data)) return [];
  return (data as {
    domain: string; price_cents: number; previous_cents: number; currency: string; source: string; observed_at: string;
    product_source: "channel3" | "seed"; external_id: string; title: string; brand: string | null; image_url: string | null;
  }[]).flatMap((r) => {
    const percent = dropPercent(r.previous_cents, r.price_cents);
    if (percent === null) return [];
    return [{
      ref: { source: r.product_source, id: r.external_id },
      title: r.title,
      brand: r.brand,
      imageUrl: r.image_url,
      domain: r.domain,
      priceCents: r.price_cents,
      previousCents: r.previous_cents,
      percent,
      currency: r.currency,
      observedAt: r.observed_at,
      simulated: r.source === "demo_simulation",
    }];
  });
}

/** Shown only with real signal: at least 2 people tracking or saving the same product. */
export async function popularProducts(deps: Deps, currency: string, limit = 8): Promise<ShopCard[]> {
  const { data, error } = await deps.db.rpc("popular_products", { p_min_users: 2, p_limit: limit });
  if (error || !Array.isArray(data) || data.length === 0) return [];
  return hydrateCards(deps, data as ProductRef[], currency);
}

export async function upsertProduct(deps: Deps, card: ProductCard): Promise<ProductRow> {
  const { data, error } = await deps.db
    .from("products")
    .upsert(
      {
        source: card.source,
        external_id: card.id,
        title: card.title.slice(0, 300),
        brand: card.brand,
        image_url: card.imageUrl,
        fetched_at: deps.now().toISOString(),
      },
      { onConflict: "source,external_id" },
    )
    .select()
    .single();
  if (error || !data) throw new Error("product_upsert_failed");
  return data as ProductRow;
}

async function resolveProduct(deps: Deps, ref: ProductRef, currency: string): Promise<ProductRow> {
  let card: ProductCard | null;
  try {
    card = await fetchProductCard(deps, ref.source, ref.id, currency);
  } catch {
    throw new ApiError(502, "source_unavailable", "We couldn't reach the product source. Please try again.");
  }
  if (!card) throw notFound("That product");
  return upsertProduct(deps, card);
}

export async function saveProduct(deps: Deps, userId: string, ref: ProductRef, currency: string): Promise<void> {
  const product = await resolveProduct(deps, ref, currency);
  const { error } = await deps.db
    .from("saved_products")
    .upsert({ user_id: userId, product_id: product.id }, { onConflict: "user_id,product_id" });
  if (error) throw new Error("save_failed");
  await logActivity(deps.db, { user_id: userId, agent: "discovery", action: "product_saved", status: "ok" });
}

export async function unsaveProduct(deps: Deps, userId: string, ref: ProductRef): Promise<void> {
  const { data } = await deps.db
    .from("products")
    .select("id")
    .eq("source", ref.source)
    .eq("external_id", ref.id)
    .maybeSingle();
  if (!data) return;
  await deps.db.from("saved_products").delete().eq("user_id", userId).eq("product_id", (data as { id: string }).id);
}

export async function recordView(deps: Deps, userId: string, card: ProductCard): Promise<ProductRow> {
  const product = await upsertProduct(deps, card);
  await deps.db
    .from("recently_viewed")
    .upsert({ user_id: userId, product_id: product.id, viewed_at: deps.now().toISOString() }, { onConflict: "user_id,product_id" });
  return product;
}
