import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { parseJson, requireUser, route } from "@/lib/api/http";
import { askBody } from "@/lib/api/schemas";
import { loadIntelligence } from "@/lib/intelligence/load";
import { answerFrom, interpretQuestion, runQuery } from "@/lib/intelligence/query";
import { getDeps } from "@/lib/serverDeps";
import { createServerSupabase } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/usage";

/** Read-only. It answers from the person's own records through RLS, and has no way to buy or change anything. */
export const POST = route(async (req) => {
  const user = await requireUser();
  const { question } = await parseJson(req, askBody);
  const deps = getDeps();
  await enforceRateLimit(deps.db, user.id, "ask", 20, 60, deps.now());

  const { query, mode } = await interpretQuestion(question, deps.callLlm);
  const supabase = await createServerSupabase();
  const { rows } = await loadIntelligence(supabase, deps.now());

  const rowCurrency = rows[0]?.currency ?? "USD";
  let below = query.belowCents;
  let note: string | null = null;
  if (below !== null && query.belowCurrency && query.belowCurrency !== rowCurrency) {
    below = null;
    note = `Your prices are in ${rowCurrency}, so that amount wasn't applied.`;
  }

  const results = runQuery(rows, query, below);
  await logActivity(deps.db, {
    user_id: user.id,
    agent: "intent",
    action: "asked_about_prices",
    output_summary: { mode, results: results.length },
    status: "ok",
  });
  return NextResponse.json({
    answer: answerFrom(query, results, rows.length, note),
    ids: results.map((r) => r.id),
    sort: query.sort,
    status: query.status,
    mode,
  });
});
