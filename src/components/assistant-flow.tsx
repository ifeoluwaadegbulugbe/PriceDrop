"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AssistantBox } from "@/components/assistant-box";
import { FallbackBanner, ProductResults, ResultsSkeleton } from "@/components/product-results";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { Intent } from "@/lib/ai/fallback";
import { api, errorMessage } from "@/lib/api/client";
import type { SearchResult } from "@/lib/catalogue";
import { centsToInput, parseMoneyInput } from "@/lib/format";

type IntentResponse = { intent: Intent; mode: "llm" | "basic" };

export function AssistantFlow({ initialPrompt, currency }: { initialPrompt: string; currency: string }) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [state, setState] = useState<"idle" | "interpreting" | "ready" | "error">(initialPrompt ? "interpreting" : "idle");
  const [mode, setMode] = useState<"llm" | "basic" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState("");
  const [brand, setBrand] = useState("");
  const [budget, setBudget] = useState("");
  const [question, setQuestion] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [budgetCents, setBudgetCents] = useState<number | undefined>(undefined);

  const search = useCallback(async (p: string, b: string, cents: number | undefined) => {
    setSearching(true);
    setSearchError(null);
    setResults(null);
    setBudgetCents(cents);
    const qs = new URLSearchParams({ q: p });
    if (b) qs.set("brand", b);
    try {
      setResults(await api<SearchResult>(`/api/search?${qs}`));
    } catch (e) {
      setSearchError(errorMessage(e));
    } finally {
      setSearching(false);
    }
  }, []);

  const interpret = useCallback(async (text: string) => {
    setPrompt(text);
    setState("interpreting");
    setResults(null);
    setError(null);
    try {
      const r = await api<IntentResponse>("/api/assistant/intent", { method: "POST", body: { prompt: text } });
      setMode(r.mode);
      setProduct(r.intent.product === "unspecified" ? "" : r.intent.product);
      setBrand(r.intent.brand ?? "");
      setBudget(centsToInput(r.intent.maxPriceCents));
      setQuestion(r.intent.needsClarification ?? null);
      setState("ready");
      if (!r.intent.needsClarification) await search(r.intent.product, r.intent.brand ?? "", r.intent.maxPriceCents);
    } catch (e) {
      setError(errorMessage(e));
      setState("error");
    }
  }, [search]);

  useEffect(() => {
    if (!initialPrompt) return;
    const t = setTimeout(() => void interpret(initialPrompt), 0);
    return () => clearTimeout(t);
  }, [initialPrompt, interpret]);

  function submitCard(e: FormEvent) {
    e.preventDefault();
    if (!product.trim()) return setQuestion("What product are you looking for?");
    const cents = parseMoneyInput(budget);
    if (budget.trim() && cents === null) return setQuestion("Enter your budget as a number, like 90.");
    setQuestion(cents === null ? "What's the most you'd pay?" : null);
    if (cents === null) return;
    void search(product.trim(), brand.trim(), cents);
  }

  return (
    <div className="grid gap-6">
      <AssistantBox key={prompt} initial={prompt} onSubmit={(p) => void interpret(p)} />

      {state === "idle" && (
        <p className="text-sm text-muted-foreground">Say what you want and what you&apos;d pay. You can edit what we understood before anything is tracked.</p>
      )}
      {state === "interpreting" && <Skeleton aria-label="Reading your request" className="h-44 rounded-2xl" />}
      {state === "error" && (
        <div role="alert" className="rounded-2xl border p-4 text-sm">
          <p>{error}</p>
          <Button variant="outline" className="mt-3" onClick={() => void interpret(prompt)}>Try again</Button>
        </div>
      )}

      {state === "ready" && (
        <form onSubmit={submitCard} className="grid gap-4 rounded-2xl border bg-card p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Here&apos;s what we understood</h2>
            {mode === "basic" && <span className="text-xs text-muted-foreground">Basic mode</span>}
          </div>
          {question && <p role="status" className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground">{question}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="intent-product">Product</Label>
              <Input id="intent-product" className="h-10" value={product} onChange={(e) => setProduct(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="intent-brand">Brand (optional)</Label>
              <Input id="intent-brand" className="h-10" value={brand} onChange={(e) => setBrand(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="intent-budget">Most you&apos;d pay ({currency})</Label>
              <Input id="intent-budget" inputMode="decimal" className="tnum h-10" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
          </div>
          <div><Button type="submit" size="lg" disabled={searching}>{searching ? "Searching..." : "Find products"}</Button></div>
        </form>
      )}

      {searching && <ResultsSkeleton />}
      {searchError && <p role="alert" className="text-sm text-destructive">{searchError}</p>}
      {results && (
        <section aria-label="Results" className="grid gap-3">
          <FallbackBanner reason={results.fallbackReason} />
          {results.products.length === 0 ? (
            <p className="rounded-2xl border p-6 text-center text-sm text-muted-foreground">No products matched. Try fewer or broader words, or remove the brand.</p>
          ) : (
            <ProductResults products={results.products} currency={currency} fetchedAt={results.fetchedAt} suggestedTargetCents={budgetCents} />
          )}
        </section>
      )}
    </div>
  );
}
