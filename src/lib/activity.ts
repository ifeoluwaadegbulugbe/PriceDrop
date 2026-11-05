import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityRow } from "@/lib/db/types";

/** Summaries only. Never secrets or raw PayPal payloads. Logging never breaks the caller. */
export async function logActivity(
  db: SupabaseClient,
  row: Pick<ActivityRow, "user_id" | "agent" | "action" | "status"> & {
    tracked_product_id?: string | null;
    input_summary?: Record<string, unknown>;
    output_summary?: Record<string, unknown>;
  },
) {
  await db.from("agent_activity").insert(row).then(() => undefined, () => undefined);
}

export async function notify(
  db: SupabaseClient,
  row: { user_id: string; kind: "deal_found" | "tracking_status" | "payment_status"; title: string; body: string; link?: string },
) {
  await db.from("notifications").insert(row).then(() => undefined, () => undefined);
}
