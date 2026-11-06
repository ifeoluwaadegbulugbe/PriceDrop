import type { ProductCard } from "@/lib/channel3/normalize";
import type { Deps } from "@/lib/deps";
import { channel3BudgetKey, bumpCounter } from "@/lib/usage";
import { searchSeed, seedById, seedSimilar } from "./seed";

export type FallbackReason = "no_api_key" | "budget_exhausted" | "api_error";

export type SearchResult = {
  products: ProductCard[];
  source: "channel3" | "seed";
  fallbackReason: FallbackReason | null;
  fetchedAt: string;
};

export type SearchFilters = { brand?: string; minCents?: number; maxCents?: number; currency?: string; categorySlugs?: string[]; seedTerms?: string[]; browseCategory?: boolean };

function lowestPrice(p: ProductCard): number | null {
  const prices = p.offers.map((o) => o.priceCents);
  return prices.length ? Math.min(...prices) : null;
}

function applyFilters(products: ProductCard[], f: SearchFilters): ProductCard[] {
  return products.filter((p) => {
    if (f.brand && p.brand?.toLowerCase() !== f.brand.toLowerCase()) return false;
    const low = lowestPrice(p);
    if (low === null) return true;
    if (f.minCents !== undefined && low < f.minCents) return false;
    if (f.maxCents !== undefined && low > f.maxCents) return false;
    return true;
  });
}

/** Inside a category, the Demo catalogue is limited to that category's items. */
function seedMatches(query: string, filters: SearchFilters): ProductCard[] {
  // Browsing a whole category: every demo item in it, whatever the words of its live search query.
  const results = searchSeed(filters.browseCategory ? "" : query);
  if (!filters.seedTerms) return results;
  const inCategory = new Set(filters.seedTerms.flatMap((t) => searchSeed(t)).map((c) => c.id));
  return results.filter((c) => inCategory.has(c.id));
}

/** Search Channel3 inside the monthly budget. On no key, exhausted budget, or API error, use the demo catalogue. */
export async function searchCatalogue(deps: Deps, query: string, filters: SearchFilters): Promise<SearchResult> {
  const fetchedAt = deps.now().toISOString();
  const seed = (fallbackReason: FallbackReason): SearchResult => ({
    products: applyFilters(seedMatches(query, filters), filters),
    source: "seed",
    fallbackReason,
    fetchedAt,
  });

  if (!deps.channel3) return seed("no_api_key");
  const inBudget = await bumpCounter(deps.db, channel3BudgetKey(deps.now()), deps.channel3Budget);
  if (!inBudget) return seed("budget_exhausted");
  try {
    const products = await deps.channel3.search({
      // Brand is filtered client-side below: Channel3's brand filter needs brand IDs, not names.
      query: filters.brand ? `${filters.brand} ${query}` : query,
      currency: filters.currency,
      minCents: filters.minCents,
      maxCents: filters.maxCents,
      categorySlugs: filters.categorySlugs,
    });
    return { products: applyFilters(products, filters), source: "channel3", fallbackReason: null, fetchedAt };
  } catch {
    return seed("api_error");
  }
}

/**
 * Products like this one. A live product only gets live alternatives: a Demo catalogue item is never offered
 * as a real alternative to a real product. Demo products are compared with others in their demo category.
 */
export async function findAlternatives(deps: Deps, card: ProductCard, currency: string): Promise<{ cards: ProductCard[]; fallbackReason: FallbackReason | null }> {
  if (card.source === "seed") return { cards: seedSimilar(card.id), fallbackReason: deps.channel3 ? null : "no_api_key" };
  if (!deps.channel3) return { cards: [], fallbackReason: null };
  const inBudget = await bumpCounter(deps.db, channel3BudgetKey(deps.now()), deps.channel3Budget);
  if (!inBudget) return { cards: [], fallbackReason: null };
  try {
    const cards = await deps.channel3.similar(card.id, { limit: 12, currency });
    return { cards: cards.filter((c) => c.id !== card.id && c.offers.length > 0), fallbackReason: null };
  } catch {
    return { cards: [], fallbackReason: null };
  }
}

/** Current offers from the source of truth, for a stored product. Throws if the source is unavailable. */
export async function fetchProductCard(
  deps: Deps,
  source: "channel3" | "seed",
  externalId: string,
  currency?: string,
): Promise<ProductCard | null> {
  if (source === "seed") return seedById(externalId);
  if (!deps.channel3) throw new Error("channel3_unavailable");
  return deps.channel3.retrieve(externalId, currency);
}
