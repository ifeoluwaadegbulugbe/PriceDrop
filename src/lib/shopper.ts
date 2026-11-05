import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const productKey = (source: string, id: string) => `${source}:${id}`;

/** What this signed-in person has saved and tracked, keyed by product. Read through RLS. */
export async function shopperState(supabase: SupabaseClient): Promise<{ savedKeys: string[]; trackedByKey: Record<string, string> }> {
  const [saved, tracked] = await Promise.all([
    supabase.from("saved_products").select("product_id"),
    supabase.from("tracked_products").select("id,product_id,status").neq("status", "removed"),
  ]);
  const savedRows = (saved.data ?? []) as { product_id: string }[];
  const trackedRows = (tracked.data ?? []) as { id: string; product_id: string }[];
  const ids = [...new Set([...savedRows.map((r) => r.product_id), ...trackedRows.map((r) => r.product_id)])];
  if (ids.length === 0) return { savedKeys: [], trackedByKey: {} };
  const { data } = await supabase.from("products").select("id,source,external_id").in("id", ids);
  const keys = new Map(((data ?? []) as { id: string; source: string; external_id: string }[]).map((p) => [p.id, productKey(p.source, p.external_id)]));
  return {
    savedKeys: savedRows.flatMap((r) => keys.get(r.product_id) ?? []),
    trackedByKey: Object.fromEntries(trackedRows.flatMap((r) => {
      const k = keys.get(r.product_id);
      return k ? [[k, r.id]] : [];
    })),
  };
}
