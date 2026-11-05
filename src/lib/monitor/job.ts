import { reconcileOrders } from "@/lib/checkout/service";
import type { TrackedRow } from "@/lib/db/types";
import type { Deps } from "@/lib/deps";
import { warmOneCategory } from "@/lib/discovery/service";
import { checkTracked } from "./check";

export const MONITOR_BATCH = 50;
const CONCURRENCY = 4;

export type MonitorSummary = {
  checked: number;
  ok: number;
  failed: number;
  observationsWritten: number;
  alertsCreated: number;
  alertsExpired: number;
  ordersReconciled: number;
};

/** Oldest-checked first, bounded, concurrency 4. One bad item never aborts the batch. */
export async function runMonitor(deps: Deps): Promise<MonitorSummary> {
  const summary: MonitorSummary = { checked: 0, ok: 0, failed: 0, observationsWritten: 0, alertsCreated: 0, alertsExpired: 0, ordersReconciled: 0 };

  const { data } = await deps.db
    .from("tracked_products")
    .select("*")
    .in("status", ["active", "deal_found"])
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(MONITOR_BATCH);
  const queue = [...((data ?? []) as TrackedRow[])];

  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      summary.checked++;
      try {
        const r = await checkTracked(deps, t, { trigger: "monitor" });
        if (r.status === "ok" || r.status === "no_offers") summary.ok++;
        else summary.failed++;
        summary.observationsWritten += r.observationsWritten;
        summary.alertsCreated += r.alertsCreated;
        summary.alertsExpired += r.alertsExpired;
      } catch {
        summary.failed++;
        await deps.db
          .from("tracked_products")
          .update({ last_checked_at: deps.now().toISOString(), last_check_status: "error" })
          .eq("id", t.id)
          .then(() => undefined, () => undefined);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  summary.ordersReconciled = await reconcileOrders(deps).catch(() => 0);
  await warmOneCategory(deps).catch(() => null);
  await deps.db.rpc("prune_counters").then(() => undefined, () => undefined);
  return summary;
}
