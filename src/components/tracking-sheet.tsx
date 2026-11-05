"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api/client";
import { centsToInput, parseMoneyInput } from "@/lib/format";

export type SheetTarget =
  | {
      mode: "create";
      source: "channel3" | "seed";
      externalId: string;
      title: string;
      domains: string[];
      variants: string[];
      suggestedTargetCents?: number;
    }
  | {
      mode: "edit";
      trackedId: string;
      title: string;
      domains: string[];
      variants: string[];
      targetCents: number;
      maxCents: number;
      allowedDomains: string[];
      allowedVariants: string[] | null;
      requireInStock: boolean;
    };

export function TrackingSheet({ target, currency, onClose }: { target: SheetTarget | null; currency: string; onClose: () => void }) {
  return (
    <Sheet open={target !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        {target && <TrackingForm key={target.title} target={target} currency={currency} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function TrackingForm({ target, currency, onClose }: { target: SheetTarget; currency: string; onClose: () => void }) {
  const id = useId();
  const router = useRouter();
  const edit = target.mode === "edit";
  const suggested = edit ? target.targetCents : target.suggestedTargetCents;
  const [targetInput, setTargetInput] = useState(centsToInput(suggested));
  const [maxInput, setMaxInput] = useState(centsToInput(edit ? target.maxCents : suggested));
  const [domains, setDomains] = useState<string[]>(edit ? target.allowedDomains : []);
  const [variants, setVariants] = useState<string[]>(edit ? (target.allowedVariants ?? []) : []);
  const [inStock, setInStock] = useState(edit ? target.requireInStock : true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (list: string[], set: (v: string[]) => void, item: string, on: boolean) =>
    set(on ? [...list, item] : list.filter((x) => x !== item));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const targetCents = parseMoneyInput(targetInput);
    const maxCents = parseMoneyInput(maxInput);
    if (targetCents === null) return setError("Enter a target price, like 90 or 89.99.");
    if (maxCents === null) return setError("Enter a maximum total, like 100.");
    if (targetCents > maxCents) return setError("Your target can't be above your maximum total.");
    setBusy(true);
    setError(null);
    const rules = {
      targetPriceCents: targetCents,
      maxTotalCents: maxCents,
      allowedDomains: domains,
      allowedVariants: variants.length ? variants : null,
      requireInStock: inStock,
    };
    try {
      if (target.mode === "create") {
        const { id: trackedId } = await api<{ id: string }>("/api/tracking", {
          method: "POST",
          body: { source: target.source, externalId: target.externalId, ...rules },
        });
        router.push(`/products/${trackedId}`);
      } else {
        await api(`/api/tracking/${target.trackedId}`, { method: "PATCH", body: rules });
        onClose();
        router.refresh();
      }
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col gap-5 p-5">
      <SheetHeader className="p-0 pr-8">
        <SheetTitle className="font-display text-xl">{edit ? "Edit your rules" : "Set your rules"}</SheetTitle>
        <SheetDescription className="break-words">{target.title}</SheetDescription>
      </SheetHeader>

      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-target`}>Target price ({currency})</Label>
          <Input id={`${id}-target`} inputMode="decimal" autoComplete="off" required className="tnum h-11" value={targetInput} onChange={(e) => setTargetInput(e.target.value)} />
          <p className="text-xs text-muted-foreground">We flag a deal when the item price is at or below this.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-max`}>Maximum total ({currency})</Label>
          <Input id={`${id}-max`} inputMode="decimal" autoComplete="off" required className="tnum h-11" value={maxInput} onChange={(e) => setMaxInput(e.target.value)} />
          <p className="text-xs text-muted-foreground">Price plus shipping, when shipping is known. Often it isn&apos;t, and we&apos;ll say so.</p>
        </div>
      </div>

      {target.domains.length > 0 && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Preferred retailers</legend>
          <p className="text-xs text-muted-foreground">Leave all unticked to allow any retailer.</p>
          {target.domains.map((d) => (
            <Label key={d} className="flex min-h-9 items-center gap-2 font-normal break-all">
              <Checkbox checked={domains.includes(d)} onCheckedChange={(c) => toggle(domains, setDomains, d, c === true)} />
              {d}
            </Label>
          ))}
        </fieldset>
      )}

      {target.variants.length > 0 && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Variants</legend>
          {target.variants.map((v) => (
            <Label key={v} className="flex min-h-9 items-center gap-2 font-normal">
              <Checkbox checked={variants.includes(v)} onCheckedChange={(c) => toggle(variants, setVariants, v, c === true)} />
              {v}
            </Label>
          ))}
        </fieldset>
      )}

      <Label className="flex items-center justify-between gap-3 font-normal">
        Only when in stock
        <Switch checked={inStock} onCheckedChange={setInStock} />
      </Label>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <div className="mt-auto flex gap-2 pt-2">
        <Button type="button" variant="outline" size="lg" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button type="submit" size="lg" className="flex-1" disabled={busy}>
          {busy ? "Saving..." : edit ? "Save rules" : "Start tracking"}
        </Button>
      </div>
    </form>
  );
}
