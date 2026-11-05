"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const EXAMPLES = ["Wireless headphones", "A laptop under $500", "Affordable skincare"];

export function SearchBar({ initial = "", examples = true, onSearch }: { initial?: string; examples?: boolean; onSearch?: (q: string) => void }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);

  function go(q: string) {
    const clean = q.trim();
    if (!clean) return;
    if (onSearch) onSearch(clean);
    else router.push(`/search?q=${encodeURIComponent(clean)}`);
  }

  return (
    <div className="grid gap-2.5">
      <form role="search" onSubmit={(e: FormEvent) => { e.preventDefault(); go(value); }} className="relative">
        <label htmlFor="search-input" className="sr-only">Search for anything</label>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
        <input
          id="search-input"
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={500}
          placeholder="What are you shopping for?"
          className="h-13 w-full rounded-full border border-input bg-card pr-24 pl-12 text-base shadow-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/30"
        />
        <button type="submit" className="absolute top-1.5 right-1.5 h-10 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Search
        </button>
      </form>
      {examples && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => { setValue(ex); go(ex); }}
              className="min-h-8 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
