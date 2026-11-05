"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api/client";
import type { AlertStatus } from "@/lib/db/types";

export function DealActions({ alertId, status, liveOrderId }: { alertId: string; status: AlertStatus; liveOrderId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function prepare() {
    setBusy("prepare");
    setError(null);
    try {
      // IDs only. The server re-checks the live price and computes the amount.
      const { orderId } = await api<{ orderId: string }>("/api/checkout/prepare", { method: "POST", body: { alertId } });
      router.push(`/checkout/${orderId}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
      router.refresh();
    }
  }

  async function dismiss() {
    setBusy("dismiss");
    setError(null);
    try {
      await api(`/api/deals/${alertId}/dismiss`, { method: "POST" });
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (status === "purchased") {
    return <Link href="/purchases" className={buttonVariants({ size: "lg", variant: "outline" })}>View in purchase history</Link>;
  }
  if (status === "dismissed" || status === "expired") {
    return <p className="text-sm text-muted-foreground">This deal is {status === "expired" ? "no longer active" : "dismissed"}. We&apos;ll tell you if a new one appears.</p>;
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {liveOrderId ? (
          <Link href={`/checkout/${liveOrderId}`} className={buttonVariants({ size: "lg" })}>Continue checkout</Link>
        ) : (
          <Button size="lg" onClick={prepare} disabled={busy !== null}>
            {busy === "prepare" ? "Checking the live price..." : "Prepare PayPal checkout"}
          </Button>
        )}
        {status === "open" && (
          <Button size="lg" variant="ghost" onClick={dismiss} disabled={busy !== null}>Dismiss</Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Nothing is charged until you approve it at PayPal.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
