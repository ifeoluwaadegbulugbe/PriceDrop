import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { extractIntent } from "@/lib/ai/intent";
import { parseJson, requireUser, route } from "@/lib/api/http";
import { intentBody } from "@/lib/api/schemas";
import { formatCents } from "@/lib/money";
import { getDeps } from "@/lib/serverDeps";
import { enforceRateLimit } from "@/lib/usage";

export const POST = route(async (req) => {
  const user = await requireUser();
  const { prompt } = await parseJson(req, intentBody);
  const deps = getDeps();
  await enforceRateLimit(deps.db, user.id, "intent", 20, 60, deps.now());

  const { data: profile } = await deps.db.from("profiles").select("currency").eq("id", user.id).single();
  const catalogueCurrency = (profile as { currency: string } | null)?.currency ?? "USD";
  const result = await extractIntent(prompt, catalogueCurrency, deps.callLlm);

  // There's no currency conversion, so a budget in another currency can't limit these results.
  let searchMaxCents = result.intent.maxPriceCents;
  let budgetNote: string | null = null;
  if (searchMaxCents !== undefined && result.intent.currency !== catalogueCurrency) {
    budgetNote = `Prices here are in ${catalogueCurrency}, so your ${formatCents(searchMaxCents, result.intent.currency)} budget wasn't applied.`;
    searchMaxCents = undefined;
  }

  await logActivity(deps.db, {
    user_id: user.id,
    agent: "intent",
    action: "interpreted_request",
    output_summary: { mode: result.mode, has_budget: searchMaxCents !== undefined },
    status: "ok",
  });
  return NextResponse.json({ ...result, searchMaxCents: searchMaxCents ?? null, budgetNote });
});
