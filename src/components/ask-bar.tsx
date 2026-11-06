"use client";

import { Send, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { assistantHref, type AskContext } from "@/lib/format";

/** The way into the assistant from anywhere. Carries what the person is looking at. */
export function AskBar({ placeholder = "What are you looking for?", suggestions = [], context, large }: {
  placeholder?: string;
  suggestions?: string[];
  context?: AskContext;
  large?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const go = (q: string) => {
    const clean = q.trim();
    if (clean) router.push(assistantHref(clean, context));
  };

  return (
    <div className="grid gap-2.5">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); go(value); }} className="relative">
        <label className="sr-only" htmlFor={`ask-${context?.product ?? context?.category ?? "home"}`}>{placeholder}</label>
        <Sparkles aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-primary" />
        <input
          id={`ask-${context?.product ?? context?.category ?? "home"}`}
          value={value}
          maxLength={500}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className={`w-full rounded-full border border-input bg-card pr-14 pl-12 text-base shadow-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/30 ${large ? "h-14" : "h-12"}`}
        />
        <button type="submit" aria-label="Send" className={`absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 ${large ? "size-11" : "size-9"}`}>
          <Send aria-hidden className="size-4" />
        </button>
      </form>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => go(s)} className="min-h-9 rounded-full border bg-card px-3 py-1 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
