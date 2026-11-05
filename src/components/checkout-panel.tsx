"use client";

import { cn } from "cn";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api/client";
import type { OrderStatus } from "@/lib/db/types";

const LABEL: Record<OrderStatus, string> = {
  creating: "Prepared",
  created: "Prepared",
  payer_action_required: "Awaiting approval",
  approved: "Approved",
  captured: "Captured",
  failed: "Failed",
  expired: "Expired",
  cancelled: "Cancelled",
};

const STEPS = ["Prepared", "Awaiting approval", "Approved", "Captured"];

type CaptureResponse = { outcome: string; message: string; status: OrderStatus; purchaseId: string | null };

function useCountdown(expiresAt: string, active: boolean) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const tick = () => setLeft(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [expiresAt, active]);
  if (left === null) return null;
  const s = Math.floor(left / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function CheckoutPanel({
  orderId,
  status,
  approveUrl,
  expiresAt,
  alertId,
  failureReason,
  paypalParam,
}: {
  orderId: string;
  status: OrderStatus;
  approveUrl: string | null;
  expiresAt: string;
  alertId: string;
  failureReason: string | null;
  paypalParam: "return" | "cancel" | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const handled = useRef(false);

  const live = ["creating", "created", "payer_action_required", "approved"].includes(status);
  const countdown = useCountdown(expiresAt, live);
  const label = LABEL[status];
  const stepIndex = STEPS.indexOf(label);

  const capture = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<CaptureResponse>("/api/checkout/capture", { method: "POST", body: { orderId } });
      setMessage(r.message);
      router.refresh();
      return r;
    } catch (e) {
      setError(errorMessage(e));
      router.refresh();
      return null;
    } finally {
      setBusy(false);
    }
  }, [orderId, router]);

  const cancel = useCallback(async () => {
    setBusy(true);
    try {
      await api("/api/checkout/cancel", { method: "POST", body: { orderId } });
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [orderId, router]);

  // Return from PayPal. Capture is confirmed by the server with PayPal, polled briefly in case approval is lagging.
  useEffect(() => {
    if (!paypalParam) return;
    const timer = setTimeout(() => {
      if (handled.current) return;
      handled.current = true;
      if (!live) return;
      if (paypalParam === "cancel") {
        void cancel();
        return;
      }
      let tries = 0;
      const attempt = async () => {
        const r = await capture();
        tries++;
        if (r?.outcome === "awaiting_approval" && tries < 4) setTimeout(() => void attempt(), 2000);
      };
      void attempt();
    }, 0);
    return () => clearTimeout(timer);
  }, [paypalParam, live, capture, cancel]);

  // Prepared orders may still be in flight from another tab.
  useEffect(() => {
    if (status !== "creating") return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [status, router]);

  return (
    <div className="grid gap-5">
      <div>
        <p className="sr-only" aria-live="polite">Status: {label}</p>
        {stepIndex >= 0 ? (
          <ol className="grid grid-cols-4 gap-1.5" aria-label="Checkout progress">
            {STEPS.map((s, i) => (
              <li key={s} aria-current={i === stepIndex ? "step" : undefined} className="grid gap-1.5">
                <span className={cn("h-1 rounded-full", i <= stepIndex ? "bg-primary" : "bg-secondary")} />
                <span className={cn("text-[11px] leading-tight sm:text-xs", i === stepIndex ? "font-semibold" : "text-muted-foreground")}>{s}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="inline-flex rounded-full bg-secondary px-3 py-1 text-sm font-semibold">{label}</p>
        )}
      </div>

      {live && countdown && (
        <p className="tnum text-sm text-muted-foreground">
          Expires in <span className="font-semibold text-foreground">{countdown}</span>
        </p>
      )}

      {status === "payer_action_required" && approveUrl && (
        <div className="flex flex-wrap items-center gap-2">
          <a href={approveUrl} className={buttonVariants({ size: "lg" })}>Open PayPal</a>
          <Button size="lg" variant="outline" onClick={capture} disabled={busy}>I&apos;ve approved it</Button>
          <Button size="lg" variant="ghost" onClick={cancel} disabled={busy}>Cancel</Button>
        </div>
      )}
      {status === "approved" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg" onClick={capture} disabled={busy}>{busy ? "Confirming with PayPal..." : "Complete sandbox payment"}</Button>
          <Button size="lg" variant="ghost" onClick={cancel} disabled={busy}>Cancel</Button>
        </div>
      )}
      {(status === "creating" || status === "created") && <p className="text-sm text-muted-foreground">Preparing your sandbox order with PayPal...</p>}

      {busy && status !== "approved" && <p role="status" className="text-sm text-muted-foreground">Confirming with PayPal...</p>}
      {message && status !== "captured" && <p role="status" className="text-sm">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {status === "captured" && (
        <div className="grid gap-2">
          <p className="text-sm">PayPal confirmed the sandbox capture. No real money moved and no retailer ships an item.</p>
          <div><Link href="/purchases" className={buttonVariants({ size: "lg" })}>View purchase history</Link></div>
        </div>
      )}
      {status === "failed" && (
        <div className="grid gap-2">
          <p className="text-sm">PayPal didn&apos;t complete this payment{failureReason ? ` (${failureReason.toLowerCase().replace(/_/g, " ")})` : ""}. Nothing is recorded as purchased.</p>
          <div><Link href={`/deals/${alertId}`} className={buttonVariants({ size: "lg", variant: "outline" })}>Back to the deal</Link></div>
        </div>
      )}
      {status === "expired" && (
        <div className="grid gap-2">
          <p className="text-sm">This checkout expired. Nothing was charged.</p>
          <div><Link href={`/deals/${alertId}`} className={buttonVariants({ size: "lg", variant: "outline" })}>Back to the deal</Link></div>
        </div>
      )}
      {status === "cancelled" && (
        <div className="grid gap-2">
          <p className="text-sm">You cancelled this checkout. Nothing was charged.</p>
          <div><Link href={`/deals/${alertId}`} className={buttonVariants({ size: "lg", variant: "outline" })}>Back to the deal</Link></div>
        </div>
      )}
    </div>
  );
}
