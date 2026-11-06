import Link from "next/link";
import { AskBar } from "@/components/ask-bar";
import { DemoCatalogueBadge } from "@/components/badges";
import { ProductTile } from "@/components/product-tile";
import { SaveButton } from "@/components/product-grid";
import { compareSummary } from "@/lib/assistant/deal";
import { lowestOffer } from "@/lib/discovery/filters";
import { hydrateCards, type ProductRef } from "@/lib/discovery/service";
import { shopHref, timeAgo } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { getDeps } from "@/lib/serverDeps";
import { shopperState } from "@/lib/shopper";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Compare your options - PriceDrop" };

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ items?: string }> }) {
  const { items } = await searchParams;
  const { supabase, profile } = await getViewer();
  const keys = (items ?? "").split(",").map((k) => decodeURIComponent(k)).filter(Boolean).slice(0, 4);
  const refs: ProductRef[] = keys.flatMap((k) => {
    const i = k.indexOf(":");
    const source = k.slice(0, i);
    return source === "channel3" || source === "seed" ? [{ source, id: k.slice(i + 1) }] : [];
  });
  const [cards, state] = await Promise.all([hydrateCards(getDeps(), refs, profile?.currency ?? "USD"), shopperState(supabase)]);

  if (cards.length < 2) {
    return (
      <div className="mx-auto grid max-w-md justify-items-center gap-2 py-14 text-center">
        <h1 className="text-2xl font-semibold">Compare your options</h1>
        <p className="text-sm text-muted-foreground">Pick at least two products by tapping Compare on them, or ask PriceDrop to find some for you.</p>
        <Link href="/assistant" className="mt-1 text-sm font-medium text-primary hover:underline">Ask PriceDrop</Link>
      </div>
    );
  }

  const summary = compareSummary(cards);
  const rows: { label: string; render: (c: (typeof cards)[number]) => React.ReactNode }[] = [
    { label: "Today's price", render: (c) => { const l = lowestOffer(c); return l ? <span className="tnum text-lg font-semibold">{formatCents(l.priceCents, l.currency)}</span> : "No current price"; } },
    { label: "Retailer", render: (c) => { const l = lowestOffer(c); return l ? <span className="break-all">{l.domain}{c.offers.length > 1 ? ` +${c.offers.length - 1} more` : ""}</span> : "Not available"; } },
    { label: "In stock", render: (c) => { const l = lowestOffer(c); return !l || l.inStock === null ? "Not stated" : l.inStock ? "Yes" : "No"; } },
    { label: "Shipping", render: (c) => { const l = lowestOffer(c); return !l || l.shippingCents === null ? "Not stated" : l.shippingCents === 0 ? "Free" : formatCents(l.shippingCents, l.currency); } },
    { label: "Brand", render: (c) => c.brand ?? "Not stated" },
    { label: "Shopper rating", render: (c) => (c.rating && c.rating.count > 0 ? `${c.rating.value.toFixed(1)} of 5 (${c.rating.count.toLocaleString("en-US")})` : "Not available") },
    { label: "Good to know", render: (c) => (c.features?.length ? <ul className="grid list-disc gap-1 pl-4 text-xs">{c.features.slice(0, 4).map((f) => <li key={f}>{f}</li>)}</ul> : "Not available") },
    { label: "Checked", render: (c) => timeAgo(c.fetchedAt) },
  ];

  return (
    <div className="grid gap-5">
      <h1 className="text-3xl font-semibold">Compare your options</h1>

      <section aria-label="What PriceDrop found" className="grid gap-1.5 rounded-2xl bg-accent/60 p-4">
        <h2 className="text-sm font-semibold">What PriceDrop found</h2>
        <ul className="grid gap-1 text-sm">{summary.map((s) => <li key={s} className="break-words">{s}</li>)}</ul>
      </section>

      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[34rem] table-fixed border-separate border-spacing-x-2 text-sm">
          <thead>
            <tr>
              <th scope="col" className="w-24 sm:w-32"><span className="sr-only">Detail</span></th>
              {cards.map((c) => (
                <th key={`${c.source}:${c.id}`} scope="col" className="pb-2 text-left align-top font-normal">
                  <div className="relative max-w-44">
                    <Link href={shopHref(c.source, c.id)} tabIndex={-1} aria-hidden><ProductTile title={c.title} imageUrl={c.imageUrl} className="w-full" /></Link>
                    <SaveButton source={c.source} id={c.id} initiallySaved={state.savedKeys.includes(`${c.source}:${c.id}`)} className="absolute top-1.5 right-1.5" />
                  </div>
                  <Link href={shopHref(c.source, c.id)} className="mt-2 line-clamp-3 font-medium break-words hover:underline">{c.title}</Link>
                  {c.source === "seed" && <DemoCatalogueBadge className="mt-1" />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="border-t py-2.5 pr-2 text-left align-top text-xs font-medium text-muted-foreground">{r.label}</th>
                {cards.map((c) => <td key={`${c.source}:${c.id}`} className="border-t py-2.5 align-top">{r.render(c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AskBar placeholder="Ask about these options" suggestions={["Which is better value?", "Is the first one a good deal?"]} context={{ items: keys.join(",") }} />
    </div>
  );
}
