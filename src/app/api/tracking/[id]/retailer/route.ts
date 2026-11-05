import { NextResponse } from "next/server";
import { fetchProductCard } from "@/lib/catalogue";
import { ApiError, notFound } from "@/lib/api/errors";
import { requireUser, route } from "@/lib/api/http";
import { idParam } from "@/lib/api/schemas";
import type { ProductRow } from "@/lib/db/types";
import { normalizeDomain } from "@/lib/evaluation/evaluate";
import { getDeps } from "@/lib/serverDeps";
import { loadOwnedTracked } from "@/lib/tracking/service";

type Ctx = { params: Promise<{ id: string }> };

/** Offer links are short-lived, so they're fetched fresh on click rather than stored. */
export const GET = route<Ctx>(async (req, ctx) => {
  const user = await requireUser();
  const id = idParam.parse((await ctx.params).id);
  const domain = new URL(req.url).searchParams.get("domain");
  if (!domain) throw new ApiError(400, "invalid_request", "That request wasn't valid.");
  const deps = getDeps();
  const tracked = await loadOwnedTracked(deps, user.id, id);
  const { data } = await deps.db.from("products").select("*").eq("id", tracked.product_id).single();
  const product = data as ProductRow;
  const card = await fetchProductCard(deps, product.source, product.external_id, tracked.currency).catch(() => null);
  const url = card?.offers.find((o) => o.domain === normalizeDomain(domain))?.url;
  if (!url) throw notFound("That retailer link");
  return NextResponse.redirect(url, 302);
});
