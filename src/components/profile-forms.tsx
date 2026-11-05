"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const CURRENCIES = ["USD", "GBP", "EUR", "CAD", "AUD"];

function CurrencySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      id="currency"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm"
    >
      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

export function OnboardingForm({ userId, currency: initial }: { userId: string; currency: string }) {
  const router = useRouter();
  const [currency, setCurrency] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(save: boolean) {
    setBusy(true);
    setError(null);
    const patch = save ? { onboarded: true, currency } : { onboarded: true };
    const { error: err } = await createBrowserSupabase().from("profiles").update(patch).eq("id", userId);
    if (err) {
      setError("We couldn't save that. Please try again.");
      setBusy(false);
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="currency">Your currency</Label>
        <CurrencySelect value={currency} onChange={setCurrency} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="lg" className="flex-1" disabled={busy} onClick={() => finish(true)}>Get started</Button>
        <Button size="lg" variant="ghost" disabled={busy} onClick={() => finish(false)}>Skip</Button>
      </div>
    </div>
  );
}

export function SettingsForm({
  userId,
  displayName: initialName,
  currency: initialCurrency,
  notifyInApp: initialNotify,
}: {
  userId: string;
  displayName: string;
  currency: string;
  notifyInApp: boolean;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialName);
  const [currency, setCurrency] = useState(initialCurrency);
  const [notify, setNotify] = useState(initialNotify);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("saving");
    const { error } = await createBrowserSupabase()
      .from("profiles")
      .update({ display_name: displayName.slice(0, 80), currency, notify_in_app: notify })
      .eq("id", userId);
    setState(error ? "error" : "saved");
    if (!error) router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-5 rounded-2xl border bg-card p-5">
      <div className="grid gap-1.5">
        <Label htmlFor="display-name">Display name</Label>
        <Input id="display-name" className="h-11" maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="currency">Currency for new tracked products</Label>
        <CurrencySelect value={currency} onChange={setCurrency} />
        <p className="text-xs text-muted-foreground">Existing tracked products keep the currency their rules were set in.</p>
      </div>
      <Label className="flex items-center justify-between gap-3 font-normal">
        In-app deal notifications
        <Switch checked={notify} onCheckedChange={setNotify} />
      </Label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={state === "saving"}>{state === "saving" ? "Saving..." : "Save"}</Button>
        <span aria-live="polite" className="text-sm text-muted-foreground">
          {state === "saved" && "Saved."}
          {state === "error" && <span className="text-destructive">Couldn&apos;t save. Please try again.</span>}
        </span>
      </div>
    </form>
  );
}
