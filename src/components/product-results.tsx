"use client";

import { useState } from "react";
import { DemoCatalogueBadge } from "@/components/badges";
import { ProductTile } from "@/components/product-tile";
import { TrackingSheet, type SheetTarget } from "@/components/tracking-sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { FallbackReason } from "@/lib/catalogue";
import type { ProductCard } from "@/lib/channel3/normalize";
import { formatCents } from "@/lib/money";

const REASONS: Record<FallbackReason, string> = {
  no_api_key: "Live product search isn't connected on this deployment.",
  budget_exhausted: "This month's live search budget is used up.",
  api_error: "Live product search isn't responding right now.",
};

export function FallbackBanner({ reason }: { reason: FallbackReason | null }) {
  if (!reason) return null;
  return (
    <p role="status" className="rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">
      {REASONS[reason]} You&apos;re seeing the <strong className="font-semibold">Demo catalogue</strong>: invented prices and retailers, not live retailer data.
    </p>
  );
}

export function ResultsSkeleton() {
  return (
    <div aria-hidden className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
    </div>
  );
}

export function ProductResults({
  products,
  currency,
  fetchedAt,
  suggestedTargetCents,
}: {
  products: ProductCard[];
  currency: string;
  fetchedAt: string;
  suggestedTargetCents?: number;
}) {
  const [target, setTarget] = useState<SheetTarget | null>(null);
  const fetched = new Date(fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const lowest = (p: ProductCard) => Math.min(...p.offers.map((o) => o.priceCents), Number.MAX_SAFE_INTEGER);
  // Within budget first, keeping relevance order. Over-budget items stay: tracking one until it drops is valid.
  const ordered =
    suggestedTargetCents === undefined
      ? products
      : [
          ...products.filter((p) => lowest(p) <= suggestedTargetCents),
          ...products.filter((p) => lowest(p) > suggestedTargetCents),
        ];

  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map((p) => {
          const sorted = [...p.offers].sort((a, b) => a.priceCents - b.priceCents);
          const low = sorted[0];
          return (
            <li key={`${p.source}-${p.id}`} className="flex gap-3 rounded-2xl border bg-card p-3">
              <ProductTile title={p.title} imageUrl={p.imageUrl} className="size-24" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-xs text-muted-foreground">{p.brand ?? "Unknown brand"}</p>
                <p className="line-clamp-2 text-sm leading-snug font-medium break-words">{p.title}</p>
                {low ? (
                  <p className="tnum text-sm">
                    <span className="font-semibold">{formatCents(low.priceCents, low.currency)}</span>{" "}
                    <span className="text-muted-foreground">
                      at {low.domain}{sorted.length > 1 ? ` +${sorted.length - 1} more` : ""}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No current offers</p>
                )}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                  {p.source === "seed" ? <DemoCatalogueBadge /> : <span className="text-xs text-muted-foreground">Fetched {fetched}</span>}
                  <Button
                    size="sm"
                    disabled={!low}
                    onClick={() =>
                      setTarget({
                        mode: "create",
                        source: p.source,
                        externalId: p.id,
                        title: p.title,
                        domains: [...new Set(p.offers.map((o) => o.domain))],
                        variants: [...new Set(p.offers.flatMap((o) => (o.variantLabel ? [o.variantLabel] : [])))],
                        suggestedTargetCents,
                      })
                    }
                  >
                    Track
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <TrackingSheet target={target} currency={currency} onClose={() => setTarget(null)} />
    </>
  );
}
