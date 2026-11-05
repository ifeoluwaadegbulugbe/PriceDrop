import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertRow, ObservationRow, ProductRow, PurchaseRow, TrackedRow } from "@/lib/db/types";
import { buildActivity, buildRows } from "./rows";

/**
 * Takes the signed-in person's own client, never the service role, so RLS limits this to their records.
 * Reads the same tables as the rest of the app: there's no separate grid data.
 */
export async function loadIntelligence(supabase: SupabaseClient, now: Date) {
  const [trackedRes, alertsRes, purchasesRes] = await Promise.all([
    supabase.from("tracked_products").select("*").neq("status", "removed").order("created_at", { ascending: false }).limit(200),
    supabase.from("deal_alerts").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("purchases").select("*").order("purchased_at", { ascending: false }).limit(50),
  ]);
  if (trackedRes.error) throw new Error("intelligence_load_failed");
  const tracked = (trackedRes.data ?? []) as TrackedRow[];
  const alerts = (alertsRes.data ?? []) as AlertRow[];
  const purchases = (purchasesRes.data ?? []) as PurchaseRow[];

  const productIds = [...new Set([...tracked.map((t) => t.product_id), ...purchases.map((p) => p.product_id)])];
  const { data: productData } = productIds.length ? await supabase.from("products").select("*").in("id", productIds) : { data: [] };
  const products = new Map(((productData ?? []) as ProductRow[]).map((p) => [p.id, p]));

  const { data: obsData } = tracked.length
    ? await supabase
        .from("price_observations")
        .select("*")
        .in("tracked_product_id", tracked.map((t) => t.id))
        .order("observed_at", { ascending: false })
        .limit(2000)
    : { data: [] };

  const rows = buildRows(tracked, products, (obsData ?? []) as ObservationRow[], now);
  return { rows, activity: buildActivity(rows, alerts, purchases, products) };
}
