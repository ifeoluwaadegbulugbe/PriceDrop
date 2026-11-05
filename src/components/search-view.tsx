"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FallbackBanner, GridSkeleton, ProductGrid } from "@/components/product-grid";
import { SearchBar } from "@/components/search-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Intent } from "@/lib/ai/fallback";
import { api, errorMessage } from "@/lib/api/client";
import type { SearchResult } from "@/lib/catalogue";
import { centsToInput, parseMoneyInput } from "@/lib/format";
import { formatCents } from "@/lib/money";

type IntentResponse = { intent: Intent; mode: "llm" | "basic"; searchMaxCents: number | null; budgetNote: string | null };

export function SearchView({
  initialQuery,
  currency,
  savedKeys,
  trackedByKey,
}: {
  initialQuery: string;
  currency: string;
  savedKeys: string[];
  trackedByKey: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(Boolean(initialQuery));
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [mode, setMode] = useState<"llm" | "basic" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [product, setProduct] = useState("");
  const [brand, setBrand] = useState("");
  const [max, setMax] = useState("");
  const [appliedMax, setAppliedMax] = useState<number | undefined>(undefined);

  const search = useCallback(async (p: string, b: string, maxCents: number | undefined) => {
    setBusy(true);
    setError(null);
    setAppliedMax(maxCents);
    const qs = new URLSearchParams({ q: p });
    if (b) qs.set("brand", b);
    if (maxCents !== undefined) qs.set("max", String(maxCents));
    try {
      setResults(await api<SearchResult>(`/api/search?${qs}`));
    } catch (e) {
      setResults(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const interpret = useCallback(async (text: string) => {
    setBusy(true);
    setError(null);
    setResults(null);
    setNote(null);
    try {
      const r = await api<IntentResponse>("/api/assistant/intent", { method: "POST", body: { prompt: text } });
      const p = r.intent.product === "unspecified" ? text : r.intent.product;
      const b = r.intent.brand ?? "";
      const cents = r.searchMaxCents ?? undefined;
      setMode(r.mode);
      setNote(r.budgetNote);
      setProduct(p);
      setBrand(b);
      setMax(centsToInput(cents));
      await search(p, b, cents);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }, [search]);

  useEffect(() => {
    if (!initialQuery) return;
    const t = setTimeout(() => void interpret(initialQuery), 0);
    return () => clearTimeout(t);
  }, [initialQuery, interpret]);

  function refine(e: React.FormEvent) {
    e.preventDefault();
    if (!product.trim()) return setError("Type what you're looking for.");
    const cents = max.trim() ? parseMoneyInput(max) : undefined;
    if (cents === null) return setError("Enter your maximum price as a number, like 90.");
    setNote(null);
    void search(product.trim(), brand.trim(), cents);
  }

  return (
    <div className="grid gap-5">
      <SearchBar key={initialQuery} initial={initialQuery} examples={!initialQuery} onSearch={(q) => router.push(`/search?q=${encodeURIComponent(q)}`)} />

      {!initialQuery && !results && (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Search by product, brand or category, or just describe what you want.
        </p>
      )}

      {(product || results) && (
        <form onSubmit={refine} className="grid grid-cols-2 items-end gap-3 rounded-2xl border bg-card p-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
          <div className="col-span-2 grid gap-1 sm:col-span-1">
            <Label htmlFor="r-product" className="text-xs">Looking for</Label>
            <Input id="r-product" className="h-10" value={product} onChange={(e) => setProduct(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="r-brand" className="text-xs">Brand</Label>
            <Input id="r-brand" className="h-10" placeholder="Any" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="r-max" className="text-xs">Max price ({currency})</Label>
            <Input id="r-max" inputMode="decimal" className="tnum h-10" placeholder="Any" value={max} onChange={(e) => setMax(e.target.value)} />
          </div>
          <Button type="submit" size="lg" variant="secondary" className="col-span-2 h-10 sm:col-span-1" disabled={busy}>Update</Button>
        </form>
      )}

      {note && <p role="status" className="text-sm text-muted-foreground">{note}</p>}
      {mode === "basic" && results && <p className="text-xs text-muted-foreground">Basic mode: understood without AI.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {busy && <GridSkeleton />}

      {!busy && results && (
        <section aria-label="Results" className="grid gap-3">
          <FallbackBanner reason={results.fallbackReason} />
          {results.products.length === 0 ? (
            <p className="rounded-2xl border p-6 text-center text-sm text-muted-foreground">
              Nothing matched{appliedMax !== undefined ? ` under ${formatCents(appliedMax, currency)}` : ""}. Try fewer words, or remove the brand or price.
            </p>
          ) : (
            <ProductGrid
              cards={results.products}
              currency={currency}
              savedKeys={savedKeys}
              trackedByKey={trackedByKey}
              suggestedTargetCents={appliedMax}
            />
          )}
        </section>
      )}
    </div>
  );
}
