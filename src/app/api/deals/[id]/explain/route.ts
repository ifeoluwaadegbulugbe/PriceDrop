import { NextResponse } from "next/server";
import { explainDeal } from "@/lib/ai/explain";
import { notFound } from "@/lib/api/errors";
import { requireUser, route } from "@/lib/api/http";
import { idParam } from "@/lib/api/schemas";
import type { AlertRow, ObservationRow, ProductRow, TrackedRow } from "@/lib/db/types";
import { getDeps } from "@/lib/serverDeps";
import { enforceRateLimit } from "@/lib/usage";

type Ctx = { params: Promise<{ id: string }> };

/** Rebuilds the explanation from the stored evaluation. It explains; it can't change the decision. */
export const POST = route<Ctx>(async (_req, ctx) => {
  const user = await requireUser();
  const id = idParam.parse((await ctx.params).id);
  const deps = getDeps();

  const { data: alertData } = await deps.db.from("deal_alerts").select("*").eq("id", id).maybeSingle();
  const alert = alertData as AlertRow | null;
  if (!alert || alert.user_id !== user.id) throw notFound("That deal");
  await enforceRateLimit(deps.db, user.id, "explain", 10, 60, deps.now());

  const { data: tracked } = await deps.db.from("tracked_products").select("*").eq("id", alert.tracked_product_id).single();
  const t = tracked as TrackedRow;
  const { data: product } = await deps.db.from("products").select("*").eq("id", t.product_id).single();
  const { data: obs } = await deps.db.from("price_observations").select("*").eq("id", alert.observation_id).single();
  const observation = obs as ObservationRow;

  const result = await explainDeal(
    {
      title: (product as ProductRow).title,
      domain: alert.domain,
      priceCents: alert.price_cents,
      shippingCents: observation.shipping_cents,
      targetPriceCents: t.target_price_cents,
      maxTotalCents: t.max_total_cents,
      previousPriceCents: alert.previous_price_cents,
      currency: observation.currency,
      evaluation: alert.evaluation,
    },
    deps.callLlm,
  );
  await deps.db
    .from("deal_alerts")
    .update({ explanation: result.explanation, explanation_source: result.source })
    .eq("id", id);
  return NextResponse.json(result);
});
