import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";

/** Consumes one unit. True when within limit. A counter failure denies: limits fail closed. */
export async function bumpCounter(db: SupabaseClient, key: string, limit: number): Promise<boolean> {
  const { data, error } = await db.rpc("bump_counter", { p_key: key, p_limit: limit });
  if (error) return false;
  return data === true;
}

/** Fixed-window per-user limit. Best effort, stored in Postgres so it survives serverless cold starts. */
export async function enforceRateLimit(
  db: SupabaseClient,
  userId: string,
  name: string,
  limit: number,
  windowSeconds: number,
  now: Date,
) {
  const bucket = Math.floor(now.getTime() / 1000 / windowSeconds);
  const ok = await bumpCounter(db, `rl:${name}:${userId}:${bucket}`, limit);
  if (!ok) throw new ApiError(429, "rate_limited", "Too many requests. Please wait a moment and try again.");
}

export function channel3BudgetKey(now: Date): string {
  return `budget:channel3:${now.toISOString().slice(0, 7)}`;
}
