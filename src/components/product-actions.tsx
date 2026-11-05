"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SimulationBadge } from "@/components/badges";
import { TrackingSheet, type SheetTarget } from "@/components/tracking-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api/client";
import type { TrackedStatus } from "@/lib/db/types";
import { parseMoneyInput } from "@/lib/format";

export function ProductActions({
  trackedId,
  status,
  currency,
  sheet,
}: {
  trackedId: string;
  status: TrackedStatus;
  currency: string;
  sheet: Extract<SheetTarget, { mode: "edit" }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function run(name: string, fn: () => Promise<string | void>) {
    setBusy(name);
    setError(null);
    setMessage(null);
    try {
      const msg = await fn();
      if (msg) {
        setMessage(msg);
        setTimeout(() => setMessage(null), 6000);
      }
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (status === "purchased") {
    return <p className="text-sm text-muted-foreground">Monitoring has stopped because this was purchased in the sandbox.</p>;
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          size="lg"
          disabled={busy !== null}
          onClick={() =>
            run("check", async () => {
              const r = await api<{ status: string; observationsWritten: number; alertsCreated: number }>(`/api/tracking/${trackedId}/check`, { method: "POST" });
              if (r.status !== "ok") return "We couldn't get current offers from the source. Nothing was recorded.";
              if (r.alertsCreated) return "Checked. A deal meets your rules.";
              return r.observationsWritten ? "Checked. New price recorded." : "Checked. Nothing changed.";
            })
          }
        >
          {busy === "check" ? "Checking..." : "Check now"}
        </Button>
        <Button size="lg" variant="outline" disabled={busy !== null} onClick={() => setEditing(true)}>Edit rules</Button>
        <Button
          size="lg"
          variant="outline"
          disabled={busy !== null}
          onClick={() =>
            run("pause", async () => {
              await api(`/api/tracking/${trackedId}`, { method: "PATCH", body: { status: status === "paused" ? "active" : "paused" } });
            })
          }
        >
          {status === "paused" ? "Resume" : "Pause"}
        </Button>
        {confirmRemove ? (
          <>
            <Button
              size="lg"
              variant="destructive"
              disabled={busy !== null}
              onClick={async () => {
                setBusy("remove");
                try {
                  await api(`/api/tracking/${trackedId}`, { method: "DELETE" });
                  router.push("/dashboard");
                  router.refresh();
                } catch (e) {
                  setError(errorMessage(e));
                  setBusy(null);
                }
              }}
            >
              Confirm remove
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setConfirmRemove(false)}>Keep</Button>
          </>
        ) : (
          <Button size="lg" variant="ghost" disabled={busy !== null} onClick={() => setConfirmRemove(true)}>Remove</Button>
        )}
      </div>
      <div aria-live="polite">
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <TrackingSheet target={editing ? sheet : null} currency={currency} onClose={() => setEditing(false)} />
    </div>
  );
}

export function SimulatePanel({ trackedId, currency }: { trackedId: string; currency: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseMoneyInput(value);
    if (cents === null) return setError("Enter a price, like 79.99.");
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await api<{ alertsCreated: number }>("/api/demo/simulate-price", { method: "POST", body: { trackedProductId: trackedId, priceCents: cents } });
      setNote(r.alertsCreated ? "Simulated price recorded. It met your rules and created a deal." : "Simulated price recorded. No new deal was created.");
      setValue("");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2 rounded-2xl border border-dashed p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Try a price change</h3>
        <SimulationBadge />
      </div>
      <p className="text-xs text-muted-foreground">Runs the normal pipeline with a made-up retailer price at the lowest-priced in-stock retailer. It lasts about 2 hours and stays labelled as a simulation.</p>
      <div className="flex items-end gap-2">
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="sim-price">Simulated price ({currency})</Label>
          <Input id="sim-price" inputMode="decimal" className="tnum h-10" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <Button type="submit" size="lg" variant="secondary" disabled={busy}>{busy ? "Simulating..." : "Simulate"}</Button>
      </div>
      <div aria-live="polite">
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </form>
  );
}
