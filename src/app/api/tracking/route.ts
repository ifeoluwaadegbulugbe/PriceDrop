import { NextResponse } from "next/server";
import { parseJson, requireUser, route } from "@/lib/api/http";
import { createTrackingBody } from "@/lib/api/schemas";
import { getDeps } from "@/lib/serverDeps";
import { createTracking } from "@/lib/tracking/service";
import { enforceRateLimit } from "@/lib/usage";

export const POST = route(async (req) => {
  const user = await requireUser();
  const body = await parseJson(req, createTrackingBody);
  const deps = getDeps();
  await enforceRateLimit(deps.db, user.id, "track", 20, 60, deps.now());
  const { tracked, check } = await createTracking(deps, user.id, body);
  return NextResponse.json({ id: tracked.id, status: tracked.status, check }, { status: 201 });
});
