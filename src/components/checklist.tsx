"use client";

import { Check, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonVariants, Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api/client";
import type { Checklist } from "@/lib/checklist";

export function GettingStarted({ checklist }: { checklist: Checklist }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (hidden) return null;

  const post = async (action: "dismiss" | "enable_updates") => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/checklist", { method: "POST", body: { action } });
      if (action === "dismiss") setHidden(true);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const percent = Math.round((checklist.completed * 100) / checklist.total);
  const remaining = checklist.tasks.filter((t) => !t.done);

  return (
    <section aria-label="Get started with PriceDrop" className="grid gap-3 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{checklist.allDone ? "You're all set. Let's find you something great." : "Get started with PriceDrop"}</h2>
          {!checklist.allDone && <p className="text-sm text-muted-foreground">A few quick steps to make the most of your shopping assistant.</p>}
        </div>
        <button type="button" aria-label="Dismiss this list" disabled={busy} onClick={() => post("dismiss")} className="-mt-1 -mr-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <div>
        <p className="tnum mb-1.5 text-xs font-medium text-muted-foreground">{checklist.completed} of {checklist.total} completed</p>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={checklist.total} aria-valuenow={checklist.completed} aria-label="Getting started progress" className="h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      </div>
      {checklist.allDone ? (
        <div className="flex items-center gap-2 text-sm text-deal"><Check aria-hidden className="size-4" /> Every step is done.</div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {remaining.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 p-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t.title}</span>
                <span className="block text-xs text-muted-foreground">{t.description}</span>
              </span>
              {t.href ? (
                <Link href={t.href} className={buttonVariants({ size: "sm", variant: "outline", className: "shrink-0" })}>{t.cta}</Link>
              ) : (
                <Button size="sm" variant="outline" className="shrink-0" disabled={busy} onClick={() => post("enable_updates")}>{t.cta}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
