import type { ProductCard } from "@/lib/channel3/normalize";
import seedData from "../../../data/seed-products.json";

type SeedProduct = {
  id: string;
  title: string;
  brand: string;
  category: string;
  offers: {
    domain: string;
    priceCents: number;
    shippingCents: number | null;
    inStock: boolean | null;
    variantLabel: string | null;
  }[];
};

const SEED = seedData.products as SeedProduct[];

function toCard(p: SeedProduct): ProductCard {
  return {
    id: p.id,
    source: "seed",
    title: p.title,
    brand: p.brand,
    imageUrl: null,
    offers: p.offers.map((o) => ({ ...o, currency: "USD", url: null })),
  };
}

export function seedById(id: string): ProductCard | null {
  const p = SEED.find((s) => s.id === id);
  return p ? toCard(p) : null;
}

export function seedCategory(id: string): string | null {
  return SEED.find((s) => s.id === id)?.category ?? null;
}

const STOP = new Set(["a", "an", "the", "for", "with", "and", "of", "new", "pair"]);

export function searchSeed(query: string): ProductCard[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
  if (words.length === 0) return SEED.map(toCard);
  const scored = SEED.map((p) => {
    const hay = `${p.title} ${p.brand} ${p.category}`.toLowerCase();
    const hits = words.filter((w) => hay.includes(w.replace(/s$/, ""))).length;
    return { p, hits };
  }).filter((s) => s.hits > 0);
  scored.sort((a, b) => b.hits - a.hits);
  return scored.map((s) => toCard(s.p));
}
