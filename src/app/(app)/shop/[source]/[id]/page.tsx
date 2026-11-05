import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoCatalogueBadge, LiveBadge } from "@/components/badges";
import { BuyBox } from "@/components/buy-box";
import { BuyNowButton } from "@/components/buy-button";
import { ProductTile } from "@/components/product-tile";
import { fetchProductCard } from "@/lib/catalogue";
import type { ProductCard } from "@/lib/channel3/normalize";
import { lowestOffer } from "@/lib/discovery/filters";
import { recordView } from "@/lib/discovery/service";
import { dateTime } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { getDeps } from "@/lib/serverDeps";
import { productKey, shopperState } from "@/lib/shopper";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Product - PriceDrop" };

export default async function ShopProductPage({ params }: { params: Promise<{ source: string; id: string }> }) {
  const { source, id: rawId } = await params;
  if (source !== "channel3" && source !== "seed") notFound();
  const id = decodeURIComponent(rawId);
  const { supabase, user, profile } = await getViewer();
  const deps = getDeps();
  const currency = profile?.currency ?? "USD";

  let card: ProductCard | null = null;
  let failed = false;
  try {
    card = await fetchProductCard(deps, source, id, currency);
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode === 404) notFound();
    failed = true;
  }
  if (failed) {
    return (
      <div role="alert" className="mx-auto grid max-w-md gap-2 py-16 text-center">
        <h1 className="text-2xl font-semibold">We couldn&apos;t load this product</h1>
        <p className="text-sm text-muted-foreground">The catalogue isn&apos;t responding right now. Please try again shortly.</p>
        <Link href="/dashboard" className="text-sm font-medium text-primary hover:underline">Back to shopping</Link>
      </div>
    );
  }
  if (!card) notFound();

  await recordView(deps, user.id, card).catch(() => undefined);
  const state = await shopperState(supabase);
  const key = productKey(source, id);
  const low = lowestOffer(card);
  const offers = [...card.offers].sort((a, b) => a.priceCents - b.priceCents);
  const fetchedAt = deps.now().toISOString();

  return (
    <div className="grid gap-6 md:grid-cols-2 md:gap-10">
      <ProductTile title={card.title} imageUrl={card.imageUrl} className="w-full rounded-2xl border bg-white" />
      <div className="grid content-start gap-4">
        <div>
          {card.brand && <p className="text-sm text-muted-foreground">{card.brand}</p>}
          <h1 className="text-2xl leading-tight font-semibold break-words sm:text-3xl">{card.title}</h1>
        </div>

        {low ? (
          <div>
            <p className="tnum font-display text-4xl font-semibold">{formatCents(low.priceCents, low.currency)}</p>
            <p className="mt-1 text-sm break-all text-muted-foreground">Lowest current offer, at {low.domain}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Fetched {dateTime(fetchedAt)}
              {source === "seed" ? <DemoCatalogueBadge /> : <LiveBadge />}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">No current offers for this product.</p>
        )}

        <BuyBox
          source={source}
          id={id}
          title={card.title}
          currency={currency}
          initiallySaved={state.savedKeys.includes(key)}
          trackedId={state.trackedByKey[key] ?? null}
          suggestedTargetCents={low?.priceCents}
          domains={[...new Set(card.offers.map((o) => o.domain))]}
          variants={[...new Set(card.offers.flatMap((o) => (o.variantLabel ? [o.variantLabel] : [])))]}
          hasOffers={Boolean(low)}
        />

        {low && low.inStock !== false && (
          <div className="grid gap-1">
            <BuyNowButton source={source} id={id} domain={low.domain} label={`Buy now from ${low.domain}`} variant="outline" className="w-full" />
            <p className="text-xs text-muted-foreground">
              Sandbox: no real money moves and no retailer ships an item. You don&apos;t need a deal to buy, and nothing is charged until you approve at PayPal.
            </p>
          </div>
        )}

        {offers.length > 0 && (
          <section aria-label="Where to buy" className="grid gap-2 border-t pt-4">
            <h2 className="text-lg font-semibold">Where to buy</h2>
            <ul className="grid gap-2">
              {offers.map((o) => (
                <li key={o.domain} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="block break-all">{o.domain}</span>
                    <span className="block text-xs text-muted-foreground">
                      {o.inStock === false ? "Out of stock" : o.inStock === true ? "In stock" : "Stock not stated"}
                      {o.shippingCents === null ? " · Shipping not stated" : o.shippingCents === 0 ? " · Free shipping" : ` · ${formatCents(o.shippingCents, o.currency)} shipping`}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="tnum font-medium">{formatCents(o.priceCents, o.currency)}</span>
                    {o.url && <a href={o.url} target="_blank" rel="noopener noreferrer nofollow sponsored" className="text-primary hover:underline">View</a>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {source === "seed"
                ? "Demo catalogue: invented prices and retailers, not live retailer data."
                : "Prices may change at any time. Retailer links may earn PriceDrop a commission."}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
