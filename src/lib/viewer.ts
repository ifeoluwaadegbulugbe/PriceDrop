import "server-only";
import { redirect } from "next/navigation";
import type { ProfileRow } from "@/lib/db/types";
import { createServerSupabase } from "@/lib/supabase/server";

/** Pages read through this client, so RLS applies to everything they show. */
export async function getViewer() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  return { supabase, user: data.user, profile: profile as ProfileRow | null };
}
