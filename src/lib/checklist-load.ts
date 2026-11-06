import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildChecklist, type Checklist } from "./checklist";

/** Reads through the person's own RLS client. Progress lives in existing records, so nothing can drift out of sync. */
export async function loadChecklist(supabase: SupabaseClient, profile: { interests: string[] | null; notify_in_app: boolean }): Promise<Checklist> {
  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0);
  const activity = (actions: string[]) =>
    count(supabase.from("agent_activity").select("id", { count: "exact", head: true }).in("action", actions));
  const [searches, productsOpened, saved, idealPrices, updates, dismissed] = await Promise.all([
    activity(["assistant_search", "interpreted_request"]),
    count(supabase.from("recently_viewed").select("product_id", { count: "exact", head: true })),
    count(supabase.from("saved_products").select("product_id", { count: "exact", head: true })),
    count(supabase.from("tracked_products").select("id", { count: "exact", head: true })),
    activity(["updates_enabled"]),
    activity(["checklist_dismissed"]),
  ]);
  return buildChecklist({ interests: profile.interests?.length ?? 0, searches, productsOpened, saved, idealPrices, updatesConfirmed: updates > 0 && profile.notify_in_app, dismissed: dismissed > 0 });
}
