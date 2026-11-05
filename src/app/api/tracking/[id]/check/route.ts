import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { requireUser, route } from "@/lib/api/http";
import { idParam } from "@/lib/api/schemas";
import { checkTracked } from "@/lib/monitor/check";
import { getDeps } from "@/lib/serverDeps";
import { loadOwnedTracked } from "@/lib/tracking/service";
import { enforceRateLimit } from "@/lib/usage";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (_req, ctx) => {
  const user = await requireUser();
  const id = idParam.parse((await ctx.params).id);
  const deps = getDeps();
  const tracked = await loadOwnedTracked(deps, user.id, id);
  await enforceRateLimit(deps.db, user.id, "check", 6, 60, deps.now());
  if (tracked.status === "purchased") throw new ApiError(409, "already_purchased", "This product was already purchased.");
  return NextResponse.json(await checkTracked(deps, tracked, { trigger: "user" }));
});
