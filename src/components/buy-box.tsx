"use client";

import { Heart } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TrackingSheet, type SheetTarget } from "@/components/tracking-sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api/client";

export function BuyBox({
  source, id, title, currency, initiallySaved, trackedId, suggestedTargetCents, domains, variants, hasOffers,
}: {
  source: "channel3" | "seed";
  id: string;
  title: string;
  currency: string;
  initiallySaved: boolean;
  trackedId: string | null;
  suggestedTargetCents?: number;
  domains: string[];
  variants: string[];
  hasOffers: boolean;
}) {
  const [saved, setSaved] = useState(initiallySaved);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<SheetTarget | null>(null);

  async function toggle() {
    const next = !saved;
    setSaved(next);
    setError(null);
    try {
      await api("/api/saved", { method: next ? "POST" : "DELETE", body: { source, externalId: id } });
    } catch (e) {
      setSaved(!next);
      setError(errorMessage(e));
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        {trackedId ? (
          <Link href={`/products/${trackedId}`} className={buttonVariants({ size: "lg", className: "flex-1" })}>View tracking</Link>
        ) : (
          <Button
            size="lg"
            className="flex-1"
            disabled={!hasOffers}
            onClick={() => setTarget({ mode: "create", source, externalId: id, title, domains, variants, suggestedTargetCents })}
          >
            Track price
          </Button>
        )}
        <Button size="lg" variant="outline" aria-pressed={saved} onClick={toggle}>
          <Heart aria-hidden className={saved ? "fill-brand text-brand" : ""} />
          {saved ? "Saved" : "Save"}
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <TrackingSheet target={target} currency={currency} onClose={() => setTarget(null)} />
    </div>
  );
}
