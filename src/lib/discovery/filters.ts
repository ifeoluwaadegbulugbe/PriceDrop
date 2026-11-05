import type { ProductCard } from "@/lib/channel3/normalize";

export type SortKey = "relevance" | "price_asc" | "price_desc";
export type CardFilters = { brand?: string; minCents?: number; maxCents?: number; inStockOnly?: boolean; sort?: SortKey };

export function lowestOffer(card: ProductCard) {
  const inStock = card.offers.filter((o) => o.inStock !== false);
  const pool = inStock.length ? inStock : card.offers;
  return [...pool].sort((a, b) => a.priceCents - b.priceCents)[0] ?? null;
}

/** Filter and sort client-visible cards. Pure: used by category pages and tests. */
export function applyCardFilters<T extends ProductCard>(cards: T[], f: CardFilters): T[] {
  const out = cards.filter((c) => {
    if (f.brand && c.brand?.toLowerCase() !== f.brand.toLowerCase()) return false;
    if (f.inStockOnly && !c.offers.some((o) => o.inStock !== false)) return false;
    const low = lowestOffer(c);
    if (!low) return false;
    if (f.minCents !== undefined && low.priceCents < f.minCents) return false;
    if (f.maxCents !== undefined && low.priceCents > f.maxCents) return false;
    return true;
  });
  const price = (c: T) => lowestOffer(c)?.priceCents ?? Number.MAX_SAFE_INTEGER;
  if (f.sort === "price_asc") return [...out].sort((a, b) => price(a) - price(b));
  if (f.sort === "price_desc") return [...out].sort((a, b) => price(b) - price(a));
  return out;
}

export function brandsIn(cards: ProductCard[]): string[] {
  return [...new Set(cards.flatMap((c) => (c.brand ? [c.brand] : [])))].sort((a, b) => a.localeCompare(b));
}

/** Whole percent, rounded down so a drop is never overstated. Null unless it's a real reduction. */
export function dropPercent(previousCents: number, currentCents: number): number | null {
  if (!Number.isSafeInteger(previousCents) || !Number.isSafeInteger(currentCents)) return null;
  if (previousCents <= 0 || currentCents < 0 || currentCents >= previousCents) return null;
  return Math.floor(((previousCents - currentCents) * 100) / previousCents);
}

/** Favourite brands first, otherwise keeps order. */
export function boostBrands<T extends ProductCard>(cards: T[], favourites: string[]): T[] {
  if (favourites.length === 0) return cards;
  const fav = new Set(favourites.map((b) => b.trim().toLowerCase()));
  const isFav = (c: T) => (c.brand ? fav.has(c.brand.toLowerCase()) : false);
  return [...cards.filter(isFav), ...cards.filter((c) => !isFav(c))];
}

/** Takes in turn from each list, so one category doesn't crowd out the others. */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}
