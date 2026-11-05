import { NextResponse } from "next/server";
import { parseJson, requireUser, route } from "@/lib/api/http";
import { prepareBody } from "@/lib/api/schemas";
import { prepareCheckout } from "@/lib/checkout/service";
import { getDeps } from "@/lib/serverDeps";
import { enforceRateLimit } from "@/lib/usage";

export const POST = route(async (req) => {
  const user = await requireUser();
  const { alertId } = await parseJson(req, prepareBody);
  const deps = getDeps();
  await enforceRateLimit(deps.db, user.id, "prepare", 10, 60, deps.now());
  const { order, reused } = await prepareCheckout(deps, user.id, alertId);
  return NextResponse.json({ orderId: order.id, status: order.status, reused });
});
