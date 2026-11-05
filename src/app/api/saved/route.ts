import { NextResponse } from "next/server";
import { parseJson, requireUser, route } from "@/lib/api/http";
import { savedBody } from "@/lib/api/schemas";
import { saveProduct, unsaveProduct } from "@/lib/discovery/service";
import { getDeps } from "@/lib/serverDeps";
import { enforceRateLimit } from "@/lib/usage";

export const POST = route(async (req) => {
  const user = await requireUser();
  const { source, externalId } = await parseJson(req, savedBody);
  const deps = getDeps();
  await enforceRateLimit(deps.db, user.id, "save", 60, 60, deps.now());
  const { data } = await deps.db.from("profiles").select("currency").eq("id", user.id).single();
  await saveProduct(deps, user.id, { source, id: externalId }, (data as { currency: string } | null)?.currency ?? "USD");
  return NextResponse.json({ saved: true });
});

export const DELETE = route(async (req) => {
  const user = await requireUser();
  const { source, externalId } = await parseJson(req, savedBody);
  const deps = getDeps();
  await enforceRateLimit(deps.db, user.id, "save", 60, 60, deps.now());
  await unsaveProduct(deps, user.id, { source, id: externalId });
  return NextResponse.json({ saved: false });
});
