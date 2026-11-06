"use client";

import { cn } from "cn";
import { BellRing, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type KeyboardEvent } from "react";
import { SelectableTile, type TileCategory } from "@/components/category-tile";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api/client";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export const SUGGESTED_BRANDS = ["Apple", "Samsung", "Sony", "Nike", "Adidas", "HP", "Dell", "LG", "L'Oréal", "Zara"];

/** Only options that change something: both are applied to recommendations and category pages. */
export const SHOPPING_PREFS = [
  { id: "lowest_price", label: "Show lowest prices first" },
  { id: "in_stock_only", label: "Hide items that are out of stock" },
];

type Draft = { interests: string[]; brands: string[]; prefs: string[]; notify: boolean };
const DRAFT_KEY = "pricedrop:onboarding";

export function BrandPicker({ brands, onChange }: { brands: string[]; onChange: (b: string[]) => void }) {
  const [text, setText] = useState("");
  const toggle = (b: string) => onChange(brands.includes(b) ? brands.filter((x) => x !== b) : [...brands, b]);
  const addTyped = () => {
    const clean = text.trim().slice(0, 40);
    if (clean && !brands.some((b) => b.toLowerCase() === clean.toLowerCase()) && brands.length < 20) onChange([...brands, clean]);
    setText("");
  };
  const custom = brands.filter((b) => !SUGGESTED_BRANDS.includes(b));
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {SUGGESTED_BRANDS.map((b) => (
          <button
            key={b}
            type="button"
            aria-pressed={brands.includes(b)}
            onClick={() => toggle(b)}
            className={cn("min-h-10 rounded-full border px-3.5 text-sm", brands.includes(b) ? "border-brand bg-brand-soft font-medium text-accent-foreground" : "bg-card")}
          >
            {b}
          </button>
        ))}
        {custom.map((b) => (
          <button key={b} type="button" onClick={() => toggle(b)} className="inline-flex min-h-10 items-center gap-1 rounded-full border border-brand bg-brand-soft px-3.5 text-sm font-medium text-accent-foreground">
            {b}
            <X aria-label={`Remove ${b}`} className="size-3.5" />
          </button>
        ))}
      </div>
      <input
        aria-label="Add another brand"
        value={text}
        placeholder="Add another brand"
        onChange={(e) => setText(e.target.value)}
        onBlur={addTyped}
        onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }}
        className="h-11 w-full rounded-lg border border-input bg-card px-3 text-base"
      />
    </div>
  );
}

export function PrefToggles({ prefs, onChange }: { prefs: string[]; onChange: (p: string[]) => void }) {
  return (
    <div className="grid gap-3">
      {SHOPPING_PREFS.map((p) => (
        <Label key={p.id} className="flex min-h-9 items-center justify-between gap-3 font-normal">
          {p.label}
          <Switch checked={prefs.includes(p.id)} onCheckedChange={(on) => onChange(on ? [...prefs, p.id] : prefs.filter((x) => x !== p.id))} />
        </Label>
      ))}
    </div>
  );
}

const STEPS = 4;

const EXAMPLES = ["Find me a good phone under $300", "Compare these two laptops", "Is there a cheaper alternative?"];

export function OnboardingFlow({
  userId,
  categories,
  images,
  initial,
}: {
  userId: string;
  categories: TileCategory[];
  images: Record<string, string>;
  initial: Draft;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A refresh mid-way keeps selections. Convenience only: the page works without it.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (raw) setDraft((d) => ({ ...d, ...(JSON.parse(raw) as Partial<Draft>) }));
      } catch {
        // Storage may be blocked. Nothing depends on it.
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // As above.
    }
  }, [draft]);

  async function finish(confirmUpdates: boolean) {
    setBusy(true);
    setError(null);
    const { error: err } = await createBrowserSupabase()
      .from("profiles")
      .update({
        interests: draft.interests,
        favourite_brands: draft.brands,
        shopping_preferences: draft.prefs,
        notify_in_app: draft.notify,
        onboarded: true,
      })
      .eq("id", userId);
    if (err) {
      setError("We couldn't save that. Please try again.");
      setBusy(false);
      return;
    }
    // Choosing updates on the last screen counts for the getting-started list. It's fine if this one call fails.
    if (confirmUpdates && draft.notify) await api("/api/checklist", { method: "POST", body: { action: "enable_updates" } }).catch(() => undefined);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // As above.
    }
    router.replace("/dashboard");
    router.refresh();
  }

  const next = () => (step === STEPS - 1 ? void finish(true) : setStep(step + 1));

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-xl flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={step + 1} aria-label="Introduction progress">
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={cn("h-1.5 flex-1 rounded-full", i <= step ? "bg-brand" : "bg-secondary")} />
          ))}
        </div>
        <button type="button" onClick={() => void finish(false)} disabled={busy} className="min-h-10 px-2 text-sm text-muted-foreground hover:text-foreground">
          Skip
        </button>
      </div>

      {step === 0 && (
        <section className="grid flex-1 content-start gap-5">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-brand-soft"><Sparkles aria-hidden className="size-8 text-brand" /></div>
          <div>
            <h1 className="text-4xl leading-tight font-semibold">Meet your personal AI shopping assistant.</h1>
            <p className="mt-3 text-base text-muted-foreground">Find products, compare options and get help knowing when it&apos;s a good time to buy.</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5" aria-hidden>
            {categories.slice(0, 4).map((c) => (
              <SelectableTile key={c.slug} category={c} imageUrl={images[c.slug] ?? null} selected={false} onToggle={() => setStep(1)} />
            ))}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="grid flex-1 content-start gap-4">
          <div>
            <h1 className="text-3xl font-semibold">What do you usually shop for?</h1>
            <p className="mt-2 text-sm text-muted-foreground">We&apos;ll use your interests to help show you products you&apos;ll love.</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {categories.map((c) => (
              <SelectableTile
                key={c.slug}
                category={c}
                imageUrl={images[c.slug] ?? null}
                selected={draft.interests.includes(c.slug)}
                onToggle={() => setDraft((d) => ({ ...d, interests: d.interests.includes(c.slug) ? d.interests.filter((s) => s !== c.slug) : [...d.interests, c.slug] }))}
              />
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="grid flex-1 content-start gap-5">
          <div>
            <h1 className="text-3xl font-semibold">Just tell PriceDrop what you need.</h1>
            <p className="mt-2 text-sm text-muted-foreground">No filters to learn. Ask the way you&apos;d ask a friend who loves shopping.</p>
          </div>
          <ul className="grid gap-2.5">
            {EXAMPLES.map((e) => (
              <li key={e} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground">{e}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 3 && (
        <section className="grid flex-1 content-start gap-5">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-brand-soft"><BellRing aria-hidden className="size-8 text-brand" /></div>
          <div>
            <h1 className="text-3xl font-semibold">Never miss a price change.</h1>
            <p className="mt-2 text-sm text-muted-foreground">Save products and choose how you&apos;d like to hear when their prices change.</p>
          </div>
          <Label className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-4 font-normal">
            <span>
              <span className="block font-medium">Price updates in PriceDrop</span>
              <span className="block text-xs text-muted-foreground">They appear under the bell at the top of the app.</span>
            </span>
            <Switch checked={draft.notify} onCheckedChange={(notify) => setDraft((d) => ({ ...d, notify }))} />
          </Label>
          <p className="text-xs text-muted-foreground">Checks are scheduled every 30 minutes but can run hours late, so updates may not be instant.</p>
        </section>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="sticky bottom-20 pb-2 md:bottom-4">
        <Button size="lg" className="h-12 w-full text-base" disabled={busy} onClick={next}>
          {step === 0 ? "Get started" : step === STEPS - 1 ? (busy ? "Saving..." : "Start shopping") : "Continue"}
        </Button>
      </div>
    </div>
  );
}
