import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { parseJson, requireUser, route } from "@/lib/api/http";
import { getDeps } from "@/lib/serverDeps";
import { enforceRateLimit } from "@/lib/usage";

const body = z.strictObject({ action: z.enum(["dismiss", "enable_updates"]) });

export const POST = route(async (req) => {
  const user = await requireUser();
  const { action } = await parseJson(req, body);
  const deps = getDeps();
  await enforceRateLimit(deps.db, user.id, "checklist", 20, 60, deps.now());
  if (action === "enable_updates") {
    await deps.db.from("profiles").update({ notify_in_app: true }).eq("id", user.id);
    await logActivity(deps.db, { user_id: user.id, agent: "monitoring", action: "updates_enabled", status: "ok" });
  } else {
    await logActivity(deps.db, { user_id: user.id, agent: "discovery", action: "checklist_dismissed", status: "ok" });
  }
  return NextResponse.json({ ok: true });
});
