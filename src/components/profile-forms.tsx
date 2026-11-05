"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SelectableTile, type TileCategory } from "@/components/category-tile";
import { BrandPicker, PrefToggles } from "@/components/onboarding-flow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      size="lg"
      variant="outline"
      onClick={async () => {
        await createBrowserSupabase().auth.signOut();
        router.replace("/");
        router.refresh();
      }}
    >
      Log out
    </Button>
  );
}

export function SettingsForm({
  userId,
  displayName: initialName,
  notifyInApp: initialNotify,
  interests: initialInterests,
  brands: initialBrands,
  prefs: initialPrefs,
  categories,
  images,
}: {
  userId: string;
  displayName: string;
  notifyInApp: boolean;
  interests: string[];
  brands: string[];
  prefs: string[];
  categories: TileCategory[];
  images: Record<string, string>;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialName);
  const [notify, setNotify] = useState(initialNotify);
  const [interests, setInterests] = useState(initialInterests);
  const [brands, setBrands] = useState(initialBrands);
  const [prefs, setPrefs] = useState(initialPrefs);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("saving");
    const { error } = await createBrowserSupabase()
      .from("profiles")
      .update({
        display_name: displayName.slice(0, 80),
        notify_in_app: notify,
        interests,
        favourite_brands: brands,
        shopping_preferences: prefs,
      })
      .eq("id", userId);
    setState(error ? "error" : "saved");
    if (!error) router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <section aria-label="Your interests" className="grid gap-3">
        <div>
          <h2 className="text-lg font-semibold">What you like to shop for</h2>
          <p className="text-sm text-muted-foreground">Used for Picked for you. Every category stays open to you whatever you choose.</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {categories.map((c) => (
            <SelectableTile
              key={c.slug}
              category={c}
              imageUrl={images[c.slug] ?? null}
              selected={interests.includes(c.slug)}
              onToggle={() => setInterests((cur) => (cur.includes(c.slug) ? cur.filter((s) => s !== c.slug) : [...cur, c.slug]))}
            />
          ))}
        </div>
      </section>

      <section aria-label="Favourite brands" className="grid gap-2">
        <h2 className="text-lg font-semibold">Favourite brands</h2>
        <BrandPicker brands={brands} onChange={setBrands} />
      </section>

      <section aria-label="Preferences" className="grid gap-4 rounded-2xl border bg-card p-5">
        <div className="grid gap-1.5">
          <Label htmlFor="display-name">Display name</Label>
          <Input id="display-name" className="h-11" maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <PrefToggles prefs={prefs} onChange={setPrefs} />
        <Label className="flex min-h-9 items-center justify-between gap-3 font-normal">
          Alerts in PriceDrop
          <Switch checked={notify} onCheckedChange={setNotify} />
        </Label>
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={state === "saving"}>{state === "saving" ? "Saving..." : "Save changes"}</Button>
        <span aria-live="polite" className="text-sm text-muted-foreground">
          {state === "saved" && "Saved."}
          {state === "error" && <span className="text-destructive">Couldn&apos;t save. Please try again.</span>}
        </span>
      </div>
    </form>
  );
}
