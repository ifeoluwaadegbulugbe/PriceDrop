"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export function AuthForm({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const signup = mode === "signup";
  // Same-origin paths only, so a crafted link can't bounce someone off-site.
  const dest = next && /^\/(?!\/)/.test(next) ? next : signup ? "/onboarding" : "/dashboard";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createBrowserSupabase();
    try {
      if (signup) {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
        });
        if (err) throw err;
        if (!data.session) {
          setCheckEmail(true);
          return;
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
      router.replace(dest);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (checkEmail) {
    return (
      <div role="status" className="grid gap-2 rounded-2xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Check your email</h2>
        <p className="text-sm text-muted-foreground">We sent a confirmation link to {email}. Open it to finish signing up.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-2xl border bg-card p-6">
      <div className="grid gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" required className="h-11" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={8} className="h-11" value={password} onChange={(e) => setPassword(e.target.value)} />
        {signup && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" disabled={busy}>{busy ? "One moment..." : signup ? "Create account" : "Log in"}</Button>
      <p className="text-center text-sm text-muted-foreground">
        {signup ? "Already have an account? " : "New to PriceDrop? "}
        <Link href={signup ? "/login" : "/signup"} className="font-medium text-primary hover:underline">{signup ? "Log in" : "Create an account"}</Link>
      </p>
    </form>
  );
}
