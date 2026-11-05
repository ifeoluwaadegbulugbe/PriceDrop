import type { ProductCard } from "@/lib/channel3/normalize";
import type { Deps } from "@/lib/deps";
import { channel3BudgetKey, bumpCounter } from "@/lib/usage";
import { searchSeed, seedById } from "./seed";

export type FallbackReason = "no_api_key" | "budget_exhausted" | "api_error";

export type SearchResult = {
  products: ProductCard[];
  source: "channel3" | "seed";
  fallbackReason: FallbackReason | null;
  fetchedAt: string;
};

export type SearchFilters = { brand?: string; minCents?: number; maxCents?: number; currency?: string };

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

/** Search Channel3 inside the monthly budget. On no key, exhausted budget, or API error, use the demo catalogue. */
export async function searchCatalogue(deps: Deps, query: string, filters: SearchFilters): Promise<SearchResult> {
  const fetchedAt = deps.now().toISOString();
  const seed = (fallbackReason: FallbackReason): SearchResult => ({
    products: applyFilters(searchSeed(query), filters),
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
    });
    return { products: applyFilters(products, filters), source: "channel3", fallbackReason: null, fetchedAt };
  } catch {
    return seed("api_error");
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
