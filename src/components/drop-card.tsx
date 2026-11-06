import { TrendingDown } from "lucide-react";
import Link from "next/link";
import { SimulationBadge } from "@/components/badges";
import { ProductTile } from "@/components/product-tile";
import type { TrendingDrop } from "@/lib/discovery/service";
import { shopHref, timeAgo } from "@/lib/format";
import { formatCents } from "@/lib/money";

/** A price we recorded falling at one retailer. A lower price without that record never appears here. */
export function DropCard({ drop: d }: { drop: TrendingDrop }) {
  return (
    <Link href={shopHref(d.ref.source, d.ref.id)} className="flex h-full flex-col overflow-hidden rounded-2xl border bg-card hover:border-primary/50">
      <div className="relative">
        <ProductTile title={d.title} imageUrl={d.imageUrl} className="w-full rounded-none" />
        <span className="tnum absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-deal px-2 py-0.5 text-xs font-semibold text-background">
          <TrendingDown aria-hidden className="size-3.5" />
          {d.percent}% lower
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm leading-snug font-medium break-words">{d.title}</p>
        <p className="tnum">
          <span className="font-display text-lg font-semibold">{formatCents(d.priceCents, d.currency)}</span>{" "}
          <s className="text-xs text-muted-foreground">{formatCents(d.previousCents, d.currency)}</s>
        </p>
        <p className="truncate text-xs text-muted-foreground">{d.domain}</p>
        <p className="text-xs text-muted-foreground">Checked {timeAgo(d.observedAt)}</p>
        {d.simulated && <SimulationBadge className="self-start" />}
      </div>
    </Link>
  );
}
