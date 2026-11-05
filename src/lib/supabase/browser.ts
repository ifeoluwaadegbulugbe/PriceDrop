"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Next inlines NEXT_PUBLIC_ values only when referenced statically, so these names are written out. */
export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!,
  );
}
