import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { requireUser, route } from "@/lib/api/http";
import { searchQuery } from "@/lib/api/schemas";
import { searchCatalogue } from "@/lib/catalogue";
import { getDeps } from "@/lib/serverDeps";
import { enforceRateLimit } from "@/lib/usage";

export const GET = route(async (req) => {
  const user = await requireUser();
  const params = searchQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const deps = getDeps();
  await enforceRateLimit(deps.db, user.id, "search", 20, 60, deps.now());

  const { data: profile } = await deps.db.from("profiles").select("currency").eq("id", user.id).single();
  const result = await searchCatalogue(deps, params.q, {
    brand: params.brand,
    minCents: params.min,
    maxCents: params.max,
    currency: (profile as { currency: string } | null)?.currency,
  });

  await logActivity(deps.db, {
    user_id: user.id,
    agent: "discovery",
    action: "searched",
    output_summary: { source: result.source, results: result.products.length, fallback: result.fallbackReason },
    status: "ok",
  });
  return NextResponse.json(result);
});
