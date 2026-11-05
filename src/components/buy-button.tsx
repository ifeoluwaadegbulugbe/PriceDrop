"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api/client";

/** Sends IDs only. The server checks the live price, then the buyer sees the amount and approves at PayPal. */
export function BuyNowButton({ source, id, domain, label = "Buy now", className, variant = "default" }: {
  source: "channel3" | "seed";
  id: string;
  domain: string;
  label?: string;
  className?: string;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy() {
    setBusy(true);
    setError(null);
    try {
      const { orderId } = await api<{ orderId: string }>("/api/checkout/buy", { method: "POST", body: { source, externalId: id, domain } });
      router.push(`/checkout/${orderId}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <span className="grid gap-1">
      <Button size="lg" variant={variant} className={className} disabled={busy} onClick={buy}>
        {busy ? "Checking the price..." : label}
      </Button>
      {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
    </span>
  );
}
