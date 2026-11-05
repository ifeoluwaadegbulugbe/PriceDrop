import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { constantTimeEqual, route } from "@/lib/api/http";
import { getEnv, isSupabaseConfigured } from "@/lib/env";
import { runMonitor } from "@/lib/monitor/job";
import { getDeps } from "@/lib/serverDeps";

export const maxDuration = 60;

export const GET = route(async (req) => {
  const secret = getEnv().CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  // No secret configured means nothing can authenticate.
  if (!secret || !constantTimeEqual(header, `Bearer ${secret}`)) {
    throw new ApiError(401, "unauthorized", "Unauthorized.");
  }
  if (!isSupabaseConfigured()) throw new ApiError(503, "not_configured", "Database isn't configured.");
  return NextResponse.json(await runMonitor(getDeps()));
});
