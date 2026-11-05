import { NextResponse } from "next/server";
import { parseJson, requireUser, route } from "@/lib/api/http";
import { buyBody } from "@/lib/api/schemas";
import { buyNow } from "@/lib/checkout/service";
import { getDeps } from "@/lib/serverDeps";
import { enforceRateLimit } from "@/lib/usage";

/** IDs only. The price and amount are worked out on the server from the live offer. */
export const POST = route(async (req) => {
  const user = await requireUser();
  const { source, externalId, domain } = await parseJson(req, buyBody);
  const deps = getDeps();
  await enforceRateLimit(deps.db, user.id, "prepare", 10, 60, deps.now());
  const { data } = await deps.db.from("profiles").select("currency").eq("id", user.id).single();
  const { order, reused } = await buyNow(deps, user.id, { source, id: externalId, domain }, (data as { currency: string } | null)?.currency ?? "USD");
  return NextResponse.json({ orderId: order.id, status: order.status, reused });
});
