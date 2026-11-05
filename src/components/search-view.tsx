"use client";

import { useState, type FormEvent } from "react";
import { FallbackBanner, ProductResults, ResultsSkeleton } from "@/components/product-results";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api/client";
import type { SearchResult } from "@/lib/catalogue";
import { parseMoneyInput } from "@/lib/format";

export function SearchView({ currency }: { currency: string }) {
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return setError("Type what you're looking for.");
    const qs = new URLSearchParams({ q: q.trim() });
    if (brand.trim()) qs.set("brand", brand.trim());
    for (const [key, raw] of [["min", min], ["max", max]] as const) {
      if (!raw.trim()) continue;
      const cents = parseMoneyInput(raw);
      if (cents === null) return setError("Prices must be numbers, like 90 or 89.99.");
      qs.set(key, String(cents));
    }
    setBusy(true);
    setError(null);
    try {
      setResults(await api<SearchResult>(`/api/search?${qs}`));
    } catch (err) {
      setResults(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <form onSubmit={submit} className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="s-q">Product</Label>
          <Input id="s-q" className="h-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Noise cancelling headphones" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="s-brand">Brand</Label>
          <Input id="s-brand" className="h-10" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Any" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:col-span-2">
          <div className="grid gap-1.5">
            <Label htmlFor="s-min">Min ({currency})</Label>
            <Input id="s-min" inputMode="decimal" className="tnum h-10" value={min} onChange={(e) => setMin(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="s-max">Max ({currency})</Label>
            <Input id="s-max" inputMode="decimal" className="tnum h-10" value={max} onChange={(e) => setMax(e.target.value)} />
          </div>
        </div>
        <Button type="submit" size="lg" disabled={busy}>{busy ? "Searching..." : "Search"}</Button>
      </form>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {busy && <ResultsSkeleton />}
      {!busy && !results && !error && (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">Search for a product to compare its current offers, then set your rules.</p>
      )}
      {!busy && results && (
        <section aria-label="Results" className="grid gap-3">
          <FallbackBanner reason={results.fallbackReason} />
          {results.products.length === 0 ? (
            <p className="rounded-2xl border p-6 text-center text-sm text-muted-foreground">Nothing matched those filters. Try removing the brand or widening the price range.</p>
          ) : (
            <ProductResults products={results.products} currency={currency} fetchedAt={results.fetchedAt} />
          )}
        </section>
      )}
    </div>
  );
}
