/**
 * "Is it a good deal?" Pure and deterministic. It only states what offers and recorded prices show, and says plainly
 * when there isn't enough to judge. It never calls something a low price without recorded evidence.
 */
import type { ProductCard } from "@/lib/channel3/normalize";
import { lowestOffer } from "@/lib/discovery/filters";
import type { IntelligenceRow } from "@/lib/intelligence/rows";
import { formatCents } from "@/lib/money";

export type DealVerdict = { headline: string; points: string[]; evidence: "ideal" | "drop" | "offers" | "none" };

export function dealVerdict(card: ProductCard, row: IntelligenceRow | null): DealVerdict {
  const low = lowestOffer(card);
  if (!low) {
    return { headline: "I can't see a price for this right now.", points: ["There are no current offers to compare."], evidence: "none" };
  }
  const money = (c: number) => formatCents(c, low.currency);
  const points: string[] = [];
  const inStock = card.offers.filter((o) => o.inStock !== false && o.currency === low.currency);
  const others = inStock.filter((o) => o.domain !== low.domain).sort((a, b) => a.priceCents - b.priceCents);

  points.push(`Today's lowest price I can see is ${money(low.priceCents)} at ${low.domain}.`);
  if (others[0] && others[0].priceCents > low.priceCents) {
    points.push(`That's ${money(others[0].priceCents - low.priceCents)} less than the next retailer, ${others[0].domain}.`);
  }
  if (low.shippingCents === null) points.push("Shipping isn't stated, so the total could be higher.");

  const sameCurrency = row && row.currency === low.currency;
  const atIdeal = sameCurrency && low.priceCents <= row.targetCents;
  const dropped = sameCurrency && row.reductionPercent !== null && row.previousCents !== null;

  if (sameCurrency) {
    points.push(
      atIdeal
        ? `It's at or below your ideal price of ${money(row.targetCents)}.`
        : `It's ${money(low.priceCents - row.targetCents)} above your ideal price of ${money(row.targetCents)}.`,
    );
  }
  if (dropped) points.push(`The last price I recorded before this was ${money(row.previousCents!)}, so it's ${row.reductionPercent}% lower now.`);

  if (atIdeal) return { headline: "Yes, for you: it meets your ideal price.", points, evidence: "ideal" };
  if (dropped) return { headline: "It's cheaper than when I last checked.", points, evidence: "drop" };
  if (others.length > 0) {
    points.push("I don't have enough price history to say whether this is low for this product.");
    return { headline: "It's the best price I can see today, but I can't call it a deal yet.", points, evidence: "offers" };
  }
  points.push("I only see one retailer and don't have enough price history to judge it.");
  return { headline: "I can't tell yet.", points, evidence: "none" };
}

/** A plain summary of a comparison. Only says what the cards show. */
export function compareSummary(cards: ProductCard[]): string[] {
  const priced = cards.flatMap((c) => {
    const low = lowestOffer(c);
    return low ? [{ c, low }] : [];
  });
  if (priced.length < 2) return ["I need at least two products with prices to compare."];
  const out: string[] = [];
  const currencies = new Set(priced.map((p) => p.low.currency));
  if (currencies.size === 1) {
    const sorted = [...priced].sort((a, b) => a.low.priceCents - b.low.priceCents);
    const cheap = sorted[0]!;
    const next = sorted[1]!;
    const gap = next.low.priceCents - cheap.low.priceCents;
    out.push(
      gap > 0
        ? `${cheap.c.title} is the cheapest at ${formatCents(cheap.low.priceCents, cheap.low.currency)}, ${formatCents(gap, cheap.low.currency)} less than ${next.c.title}.`
        : `${cheap.c.title} and ${next.c.title} are the same price at ${formatCents(cheap.low.priceCents, cheap.low.currency)}.`,
    );
  }
  const rated = cards.filter((c) => c.rating && c.rating.count > 0).sort((a, b) => b.rating!.value - a.rating!.value);
  if (rated.length >= 2) out.push(`${rated[0]!.title} has the highest shopper rating, ${rated[0]!.rating!.value.toFixed(1)} from ${rated[0]!.rating!.count.toLocaleString("en-US")} ratings.`);
  const most = [...cards].sort((a, b) => b.offers.length - a.offers.length)[0]!;
  if (most.offers.length > 1 && cards.some((c) => c.offers.length < most.offers.length)) out.push(`${most.title} has the most retailers to choose from (${most.offers.length}).`);
  return out;
}
