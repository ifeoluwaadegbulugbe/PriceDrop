import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { ApiError, notFound } from "@/lib/api/errors";
import { requireUser, route } from "@/lib/api/http";
import { idParam } from "@/lib/api/schemas";
import type { AlertRow } from "@/lib/db/types";
import { getDeps } from "@/lib/serverDeps";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (_req, ctx) => {
  const user = await requireUser();
  const id = idParam.parse((await ctx.params).id);
  const deps = getDeps();
  const { data } = await deps.db.from("deal_alerts").select("*").eq("id", id).maybeSingle();
  const alert = data as AlertRow | null;
  if (!alert || alert.user_id !== user.id) throw notFound("That deal");
  if (alert.status !== "open") throw new ApiError(409, "not_dismissable", "Only an open deal can be dismissed.");

  await deps.db.from("deal_alerts").update({ status: "dismissed" }).eq("id", id).eq("status", "open");
  await deps.db
    .from("tracked_products")
    .update({ status: "active" })
    .eq("id", alert.tracked_product_id)
    .eq("status", "deal_found");
  await logActivity(deps.db, {
    user_id: user.id,
    tracked_product_id: alert.tracked_product_id,
    agent: "evaluation",
    action: "deal_dismissed",
    status: "ok",
  });
  return NextResponse.json({ id, status: "dismissed" });
});
