import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { parseJson, requireUser, route } from "@/lib/api/http";
import { chat, chatBody } from "@/lib/assistant/engine";
import { hydrateCards, loadCategories, type ProductRef } from "@/lib/discovery/service";
import { loadIntelligence } from "@/lib/intelligence/load";
import { getDeps } from "@/lib/serverDeps";
import { shopperState } from "@/lib/shopper";
import { createServerSupabase } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/usage";

/** The assistant answers. It can't save, track, order or pay: those stay behind the person's own clicks. */
export const POST = route(async (req) => {
  const user = await requireUser();
  const input = await parseJson(req, chatBody);
  const deps = getDeps();
  await enforceRateLimit(deps.db, user.id, "chat", 20, 60, deps.now());

  const supabase = await createServerSupabase();
  const { data: profile } = await supabase.from("profiles").select("currency,favourite_brands").eq("id", user.id).single();
  const p = profile as { currency: string; favourite_brands: string[] | null } | null;
  const currency = p?.currency ?? "USD";

  const reply = await chat(deps, {
    currency,
    categories: await loadCategories(deps),
    favouriteBrands: p?.favourite_brands ?? [],
    loadSaved: async () => {
      const { rows } = await loadIntelligence(supabase, deps.now());
      const { data: saved } = await supabase.from("saved_products").select("product_id");
      const ids = ((saved ?? []) as { product_id: string }[]).map((s) => s.product_id);
      const { data: products } = ids.length ? await supabase.from("products").select("source,external_id").in("id", ids) : { data: [] };
      const watched = new Set(rows.map((r) => `${r.source}:${r.externalId}`));
      const refs: ProductRef[] = ((products ?? []) as { source: "channel3" | "seed"; external_id: string }[])
        .filter((x) => !watched.has(`${x.source}:${x.external_id}`))
        .map((x) => ({ source: x.source, id: x.external_id }));
      return { rows, savedOnly: await hydrateCards(deps, refs, currency) };
    },
  }, input);

  await logActivity(deps.db, {
    user_id: user.id,
    agent: "intent",
    action: "assistant_search",
    output_summary: { kind: reply.kind, mode: reply.mode, results: reply.cards.length },
    status: "ok",
  });
  // Fresh hearts and watches, because the conversation may have outlived the page it started on.
  return NextResponse.json({ ...reply, ...(await shopperState(supabase)) });
});
