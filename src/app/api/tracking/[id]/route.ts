import { NextResponse } from "next/server";
import { parseJson, requireUser, route } from "@/lib/api/http";
import { idParam, updateTrackingBody } from "@/lib/api/schemas";
import { checkTracked } from "@/lib/monitor/check";
import { getDeps } from "@/lib/serverDeps";
import { removeTracking, updateTracking } from "@/lib/tracking/service";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, ctx) => {
  const user = await requireUser();
  const id = idParam.parse((await ctx.params).id);
  const body = await parseJson(req, updateTrackingBody);
  const deps = getDeps();
  const tracked = await updateTracking(deps, user.id, id, body);
  // New rules take effect now, not at the next scheduled check.
  if (tracked.status === "active" || tracked.status === "deal_found") {
    await checkTracked(deps, tracked, { trigger: "user" }).catch(() => undefined);
  }
  return NextResponse.json({ id: tracked.id, status: tracked.status });
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const user = await requireUser();
  const id = idParam.parse((await ctx.params).id);
  await removeTracking(getDeps(), user.id, id);
  return NextResponse.json({ id, status: "removed" });
});
