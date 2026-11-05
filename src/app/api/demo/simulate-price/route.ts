import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { parseJson, requireUser, route } from "@/lib/api/http";
import { simulateBody } from "@/lib/api/schemas";
import { getEnv } from "@/lib/env";
import { getDeps } from "@/lib/serverDeps";
import { simulatePrice } from "@/lib/tracking/service";
import { enforceRateLimit } from "@/lib/usage";

export const POST = route(async (req) => {
  // This endpoint doesn't exist unless DEMO_MODE=true.
  if (!getEnv().DEMO_MODE) throw new ApiError(404, "not_found", "Not found.");
  const user = await requireUser();
  const { trackedProductId, priceCents } = await parseJson(req, simulateBody);
  const deps = getDeps();
  await enforceRateLimit(deps.db, user.id, "simulate", 10, 60, deps.now());
  return NextResponse.json(await simulatePrice(deps, user.id, trackedProductId, priceCents));
});
