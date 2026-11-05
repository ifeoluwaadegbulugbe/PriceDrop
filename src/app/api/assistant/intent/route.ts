import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { extractIntent } from "@/lib/ai/intent";
import { parseJson, requireUser, route } from "@/lib/api/http";
import { intentBody } from "@/lib/api/schemas";
import { getDeps } from "@/lib/serverDeps";
import { enforceRateLimit } from "@/lib/usage";

export const POST = route(async (req) => {
  const user = await requireUser();
  const { prompt } = await parseJson(req, intentBody);
  const deps = getDeps();
  await enforceRateLimit(deps.db, user.id, "intent", 20, 60, deps.now());

  const { data: profile } = await deps.db.from("profiles").select("currency").eq("id", user.id).single();
  const result = await extractIntent(prompt, (profile as { currency: string } | null)?.currency ?? "USD", deps.callLlm);

  await logActivity(deps.db, {
    user_id: user.id,
    agent: "intent",
    action: "interpreted_request",
    output_summary: { mode: result.mode, needs_clarification: Boolean(result.intent.needsClarification) },
    status: "ok",
  });
  return NextResponse.json(result);
});
