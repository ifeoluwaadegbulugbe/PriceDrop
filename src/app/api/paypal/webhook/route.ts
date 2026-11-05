import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { route } from "@/lib/api/http";
import { handleWebhookEvent } from "@/lib/checkout/service";
import { getEnv, isSupabaseConfigured } from "@/lib/env";
import { getDeps } from "@/lib/serverDeps";

export const POST = route(async (req) => {
  const webhookId = getEnv().PAYPAL_WEBHOOK_ID;
  if (!webhookId || !isSupabaseConfigured()) throw new ApiError(503, "webhook_not_configured", "Webhooks aren't configured.");
  const deps = getDeps();
  if (!deps.paypal) throw new ApiError(503, "webhook_not_configured", "Webhooks aren't configured.");

  let event: Record<string, unknown>;
  try {
    event = (await req.json()) as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_json", "Invalid body.");
  }

  // Signature first. Nothing in an unverified body is read.
  const valid = await deps.paypal
    .verifyWebhookSignature({ headers: req.headers, event, webhookId })
    .catch(() => false);
  if (!valid) throw new ApiError(401, "invalid_signature", "Invalid signature.");

  return NextResponse.json({ result: await handleWebhookEvent(deps, event) });
});
