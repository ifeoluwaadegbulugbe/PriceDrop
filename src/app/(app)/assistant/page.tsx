import { AssistantChat } from "@/components/assistant-chat";
import { loadCategories } from "@/lib/discovery/service";
import { getDeps } from "@/lib/serverDeps";
import { shopperState } from "@/lib/shopper";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "PriceDrop AI" };

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ q?: string; product?: string; category?: string; items?: string }> }) {
  const sp = await searchParams;
  const { supabase, profile } = await getViewer();
  const state = await shopperState(supabase);

  let productTitle: string | undefined;
  if (sp.product) {
    const i = sp.product.indexOf(":");
    const { data } = await supabase.from("products").select("title").eq("source", sp.product.slice(0, i)).eq("external_id", sp.product.slice(i + 1)).maybeSingle();
    productTitle = (data as { title: string } | null)?.title;
  }
  const category = sp.category ? (await loadCategories(getDeps())).find((c) => c.slug === sp.category) : undefined;

  return (
    <AssistantChat
      initialPrompt={(sp.q ?? "").slice(0, 500)}
      productKey={sp.product}
      productTitle={productTitle}
      categorySlug={category?.slug}
      categoryName={category?.name}
      itemKeys={(sp.items ?? "").split(",").filter(Boolean).slice(0, 4)}
      currency={profile?.currency ?? "USD"}
      savedKeys={state.savedKeys}
      trackedByKey={state.trackedByKey}
    />
  );
}
