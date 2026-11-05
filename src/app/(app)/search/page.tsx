import { SearchView } from "@/components/search-view";
import { shopperState } from "@/lib/shopper";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Search - PriceDrop" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { supabase, profile } = await getViewer();
  const state = await shopperState(supabase);
  return (
    <div className="grid gap-4">
      <h1 className="sr-only">Search</h1>
      <SearchView
        initialQuery={(q ?? "").slice(0, 500)}
        currency={profile?.currency ?? "USD"}
        savedKeys={state.savedKeys}
        trackedByKey={state.trackedByKey}
      />
    </div>
  );
}
