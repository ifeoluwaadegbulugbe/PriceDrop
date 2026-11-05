"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const EXAMPLES = ["Sony headphones, no more than $90", "Laptop under $600", "Running shoes below $150"];

export function AssistantBox({ initial = "", onSubmit }: { initial?: string; onSubmit?: (prompt: string) => void }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);

  function go(prompt: string) {
    const clean = prompt.trim();
    if (!clean) return;
    if (onSubmit) onSubmit(clean);
    else router.push(`/assistant?q=${encodeURIComponent(clean)}`);
  }

  return (
    <div className="grid gap-3">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); go(value); }} className="flex gap-2">
        <label htmlFor="assistant-input" className="sr-only">What do you want, and what will you pay?</label>
        <Input
          id="assistant-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={500}
          placeholder="What do you want, and what will you pay?"
          className="h-12 flex-1 bg-card text-base"
        />
        <Button type="submit" aria-label="Ask PriceDrop" className="size-12">
          <ArrowRight className="size-5" aria-hidden />
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => { setValue(ex); go(ex); }}
            className="min-h-8 rounded-full border bg-card px-3 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
