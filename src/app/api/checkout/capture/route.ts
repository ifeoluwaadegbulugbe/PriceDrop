import { NextResponse } from "next/server";
import { parseJson, requireUser, route } from "@/lib/api/http";
import { orderBody } from "@/lib/api/schemas";
import { captureCheckout } from "@/lib/checkout/service";
import { getDeps } from "@/lib/serverDeps";
import { enforceRateLimit } from "@/lib/usage";

export const POST = route(async (req) => {
  const user = await requireUser();
  const { orderId } = await parseJson(req, orderBody);
  const deps = getDeps();
  await enforceRateLimit(deps.db, user.id, "capture", 30, 60, deps.now());
  const r = await captureCheckout(deps, user.id, orderId);
  return NextResponse.json({
    outcome: r.outcome,
    message: r.message,
    status: r.order.status,
    purchaseId: r.purchase?.id ?? null,
  });
});
