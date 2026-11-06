"use client";

import { cn } from "cn";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ProductGrid } from "@/components/product-grid";
import { ProductTile } from "@/components/product-tile";
import type { ProductCard } from "@/lib/channel3/normalize";
import { timeAgo } from "@/lib/format";
import type { ActivityEvent, IntelligenceRow } from "@/lib/intelligence/rows";
import { formatCents } from "@/lib/money";

type Filter = "all" | "dropped" | "ideal" | "increased" | "recent";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All saved items" },
  { value: "dropped", label: "Price dropped" },
  { value: "ideal", label: "At my ideal price" },
  { value: "increased", label: "Price increased" },
  { value: "recent", label: "Recently saved" },
];

function pass(r: IntelligenceRow, f: Filter) {
  if (f === "dropped") return r.reductionCents !== null;
  if (f === "ideal") return r.status === "target_reached";
  if (f === "increased") return r.increaseCents !== null;
  return true;
}

function ItemCard({ row: r }: { row: IntelligenceRow }) {
  return (
    <Link href={`/products/${r.id}`} className="flex gap-3 rounded-2xl border bg-card p-3 hover:bg-muted/40">
      <ProductTile title={r.title} imageUrl={r.imageUrl} className="size-20" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm leading-snug font-medium break-words">{r.title}</p>
        <p className="tnum mt-1">
          <span className="text-lg font-semibold">{r.currentCents === null ? "No price yet" : formatCents(r.currentCents, r.currency)}</span>{" "}
          <span className="text-xs text-muted-foreground">last checked price</span>
        </p>
        <p className="tnum text-xs text-muted-foreground">My ideal price: {formatCents(r.targetCents, r.currency)}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
          {r.status === "target_reached" && <span className="font-medium text-deal">At your ideal price</span>}
          {r.reductionPercent !== null && <span className="font-medium text-deal">{r.reductionPercent}% lower</span>}
          {r.increaseCents !== null && <span className="text-muted-foreground">Up {formatCents(r.increaseCents, r.currency)}</span>}
          {r.status === "paused" && <span className="text-muted-foreground">Paused</span>}
          {r.status === "purchased" && <span className="text-caution">Bought (sandbox)</span>}
          {r.isSimulated && <span className="text-sim">Demo simulation</span>}
          <span className="text-muted-foreground">{r.observedAt ? `Checked ${timeAgo(r.observedAt)}` : "Not checked yet"}</span>
          {r.stale && <span className="text-caution">May be out of date</span>}
        </p>
      </div>
    </Link>
  );
}

export function SavedView({ rows, savedOnly, updates, currency, savedKeys, trackedByKey }: {
  rows: IntelligenceRow[];
  savedOnly: ProductCard[];
  updates: ActivityEvent[];
  currency: string;
  savedKeys: string[];
  trackedByKey: Record<string, string>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const visible = useMemo(() => {
    const list = rows.filter((r) => pass(r, filter));
    return filter === "recent" ? [...list].sort((a, b) => b.addedAt.localeCompare(a.addedAt)) : list;
  }, [rows, filter]);
  const showHearted = filter === "all" || filter === "recent";

  return (
    <div className="grid gap-7">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="Filter saved items">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cn("inline-flex min-h-10 shrink-0 items-center rounded-full border px-3.5 text-sm whitespace-nowrap", filter === f.value ? "border-primary bg-accent font-medium text-accent-foreground" : "bg-card hover:bg-muted")}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rows.length > 0 && (
        <section aria-label="Items you're watching" className="grid gap-3">
          <h2 className="text-xl font-semibold">Items you&apos;re watching</h2>
          {visible.length === 0 ? (
            <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing here right now.</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">{visible.map((r) => <li key={r.id}><ItemCard row={r} /></li>)}</ul>
          )}
        </section>
      )}

      {showHearted && savedOnly.length > 0 && (
        <section aria-label="Saved for later" className="grid gap-3">
          <div>
            <h2 className="text-xl font-semibold">Saved for later</h2>
            <p className="text-sm text-muted-foreground">Set your ideal price on any of these and I&apos;ll keep an eye on it.</p>
          </div>
          <ProductGrid cards={savedOnly} currency={currency} savedKeys={savedKeys} trackedByKey={trackedByKey} />
        </section>
      )}

      <section aria-label="Price updates" className="grid gap-3">
        <div>
          <h2 className="text-xl font-semibold">Price updates</h2>
          <p className="text-sm text-muted-foreground">Checks are scheduled every 30 minutes but can run hours late, so updates may not be instant.</p>
        </div>
        {updates.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing yet. When a price you&apos;re watching changes, you&apos;ll see it here.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {updates.slice(0, 12).map((u) => (
              <li key={u.id} className="rounded-2xl border bg-card p-3 text-sm">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{u.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(u.at)}</span>
                </p>
                {u.href ? <Link href={u.href} className="line-clamp-1 hover:underline">{u.productTitle}</Link> : <p className="line-clamp-1">{u.productTitle}</p>}
                <p className="text-xs text-muted-foreground">{u.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
