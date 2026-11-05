"use client";

import { cn } from "cn";
import { Heart } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DemoCatalogueBadge } from "@/components/badges";
import { ProductTile } from "@/components/product-tile";
import { TrackingSheet, type SheetTarget } from "@/components/tracking-sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api/client";
import type { FallbackReason } from "@/lib/catalogue";
import type { ProductCard } from "@/lib/channel3/normalize";
import { lowestOffer } from "@/lib/discovery/filters";
import { shopHref } from "@/lib/format";
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

export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-hidden className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => <Skeleton key={i} className="aspect-3/4 rounded-2xl" />)}
    </div>
  );
}

export function SaveButton({ source, id, initiallySaved, className }: { source: string; id: string; initiallySaved: boolean; className?: string }) {
  const [saved, setSaved] = useState(initiallySaved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !saved;
    setSaved(next);
    setBusy(true);
    setError(null);
    try {
      await api("/api/saved", { method: next ? "POST" : "DELETE", body: { source, externalId: id } });
    } catch (err) {
      setSaved(!next);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={saved}
      aria-label={saved ? "Remove from watchlist" : "Save to watchlist"}
      title={error ?? (saved ? "Saved to your watchlist" : "Save to watchlist")}
      className={cn("flex size-10 items-center justify-center rounded-full bg-white/90 text-[#1b1b24] shadow-sm backdrop-blur transition-colors hover:bg-white", className)}
    >
      <Heart className={cn("size-5", saved && "fill-brand text-brand")} aria-hidden />
    </button>
  );
}

export function ProductGrid({
  cards,
  currency,
  savedKeys,
  trackedByKey,
  suggestedTargetCents,
  rail,
}: {
  cards: ProductCard[];
  currency: string;
  savedKeys: string[];
  trackedByKey: Record<string, string>;
  suggestedTargetCents?: number;
  /** A sideways-scrolling row on phones, for homepage sections. */
  rail?: boolean;
}) {
  const [target, setTarget] = useState<SheetTarget | null>(null);
  const saved = new Set(savedKeys);

  return (
    <>
      <ul
        className={cn(
          rail
            ? "-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 lg:grid-cols-4"
            : "grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4",
        )}
      >
        {cards.map((p) => {
          const low = lowestOffer(p);
          const key = `${p.source}:${p.id}`;
          const trackedId = trackedByKey[key];
          const others = p.offers.length - 1;
          return (
            <li key={key} className={cn("flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card", rail && "w-44 shrink-0 snap-start md:w-auto")}>
              <div className="relative">
                <Link href={shopHref(p.source, p.id)} aria-label={p.title} tabIndex={-1}>
                  <ProductTile title={p.title} imageUrl={p.imageUrl} className="w-full rounded-none bg-white" />
                </Link>
                <SaveButton source={p.source} id={p.id} initiallySaved={saved.has(key)} className="absolute top-2 right-2" />
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <Link href={shopHref(p.source, p.id)} className="line-clamp-2 min-h-10 text-sm leading-snug font-medium break-words hover:underline">
                  {p.title}
                </Link>
                {low ? (
                  <div>
                    <p className="tnum font-display text-lg leading-tight font-semibold">{formatCents(low.priceCents, low.currency)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {low.domain}{others > 0 ? ` +${others} more` : ""}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No current offers</p>
                )}
                {p.source === "seed" && <DemoCatalogueBadge className="mt-1 self-start" />}
                <div className="mt-auto pt-2">
                  {trackedId ? (
                    <Link href={`/products/${trackedId}`} className={buttonVariants({ variant: "secondary", size: "sm", className: "w-full" })}>Tracking</Link>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={!low}
                      onClick={() =>
                        setTarget({
                          mode: "create",
                          source: p.source,
                          externalId: p.id,
                          title: p.title,
                          domains: [...new Set(p.offers.map((o) => o.domain))],
                          variants: [...new Set(p.offers.flatMap((o) => (o.variantLabel ? [o.variantLabel] : [])))],
                          suggestedTargetCents: suggestedTargetCents ?? low?.priceCents,
                        })
                      }
                    >
                      Track price
                    </Button>
                  )}
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
