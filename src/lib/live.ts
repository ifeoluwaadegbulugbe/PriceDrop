import "server-only";
import type { ProductRow, TrackedRow } from "@/lib/db/types";
import type { Deps } from "@/lib/deps";
import { evaluateDeal, type Evaluation } from "@/lib/evaluation/evaluate";
import { currentOffers, latestObservation, rulesOf, type CurrentOffer } from "@/lib/monitor/check";

export type LiveSnapshot =
  | { ok: true; offers: CurrentOffer[]; best: CurrentOffer | null; evaluation: Evaluation | null; fetchedAt: string }
  | { ok: false; fetchedAt: string };

/** Fresh offers for display. A stored price is never shown as current: on failure the caller labels it as an observation. */
export async function liveSnapshot(deps: Deps, tracked: TrackedRow, product: ProductRow): Promise<LiveSnapshot> {
  const fetchedAt = deps.now().toISOString();
  try {
    const offers = await Promise.race([
      currentOffers(deps, tracked, product),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000)),
    ]);
    const rules = rulesOf(tracked);
    const scored = offers
      .map((o) => ({ o, e: evaluateDeal(o, rules, null) }))
      .sort((a, b) => {
        const rank = (d: string) => (d === "qualifies" ? 0 : d === "insufficient_info" ? 1 : 2);
        return rank(a.e.decision) - rank(b.e.decision) || a.o.priceCents - b.o.priceCents;
      });
    const best = scored[0]?.o ?? null;
    let evaluation: Evaluation | null = null;
    if (best) {
      const last = await latestObservation(deps, tracked.id, best.domain);
      evaluation = evaluateDeal(best, rules, last ? { priceCents: last.price_cents, currency: last.currency } : null);
    }
    return { ok: true, offers, best, evaluation, fetchedAt };
  } catch {
    return { ok: false, fetchedAt };
  }
}
