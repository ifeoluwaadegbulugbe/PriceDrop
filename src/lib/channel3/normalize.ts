import { normalizeDomain } from "@/lib/evaluation/evaluate";
import { majorToCents } from "@/lib/money";

export type NormalizedOffer = {
  domain: string;
  priceCents: number;
  shippingCents: number | null;
  currency: string;
  inStock: boolean | null;
  url: string | null;
  variantLabel: string | null;
};

export type ProductCard = {
  id: string;
  source: "channel3" | "seed";
  title: string;
  brand: string | null;
  imageUrl: string | null;
  offers: NormalizedOffer[];
};

/**
 * Structural subset of the SDK's Product type (@channel3/sdk 4.8.0: api/types/Product.d.ts, ProductOffer.d.ts,
 * Price.d.ts). Kept structural so a malformed response is handled here, not assumed away.
 */
export type RawProduct = {
  id: string;
  title: string;
  brands?: { name?: string | null }[] | null;
  images?: { url?: string | null; cleaned_url?: string | null; is_main_image?: boolean | null }[] | null;
  offers?:
    | {
        url?: string | null;
        domain?: string | null;
        price?: { price?: number | null; currency?: string | null } | null;
        availability?: string | null;
      }[]
    | null;
  variants?: { selected?: { label?: string | null }[] | null } | null;
};

function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Price.price is typed as a plain number. The docs describe price filters "in dollars and cents" but do not
 * state the unit of response prices; major units is assumed, see docs/UNVERIFIED.md.
 * ProductOffer has no shipping field, so shippingCents is always null for Channel3.
 */
export function normalizeProduct(p: RawProduct): ProductCard {
  const labels = (p.variants?.selected ?? []).map((s) => s.label).filter((l): l is string => !!l);
  const variantLabel = labels.length ? labels.join(" / ") : null;
  const images = p.images ?? [];
  const main = images.find((i) => i.is_main_image) ?? images[0];

  const offers: NormalizedOffer[] = [];
  for (const o of p.offers ?? []) {
    const priceCents = majorToCents(o?.price?.price);
    const currency = o?.price?.currency;
    if (priceCents === null || priceCents === 0 || !o.domain || !currency) continue;
    offers.push({
      domain: normalizeDomain(o.domain),
      priceCents,
      shippingCents: null,
      currency: currency.toUpperCase(),
      inStock: o.availability === "InStock" ? true : o.availability === "OutOfStock" ? false : null,
      url: safeHttpUrl(o.url),
      variantLabel,
    });
  }

  return {
    id: p.id,
    source: "channel3",
    title: p.title,
    brand: p.brands?.[0]?.name ?? null,
    imageUrl: safeHttpUrl(main?.cleaned_url) ?? safeHttpUrl(main?.url),
    offers,
  };
}
