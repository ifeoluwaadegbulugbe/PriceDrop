import { NextResponse } from "next/server";
import { parseJson, requireUser, route } from "@/lib/api/http";
import { orderBody } from "@/lib/api/schemas";
import { cancelCheckout } from "@/lib/checkout/service";
import { getDeps } from "@/lib/serverDeps";

export const POST = route(async (req) => {
  const user = await requireUser();
  const { orderId } = await parseJson(req, orderBody);
  const order = await cancelCheckout(getDeps(), user.id, orderId);
  return NextResponse.json({ status: order.status });
});
