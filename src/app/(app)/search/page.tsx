import { SearchView } from "@/components/search-view";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Search - PriceDrop" };

export default async function SearchPage() {
  const { profile } = await getViewer();
  return (
    <div className="grid gap-5">
      <h1 className="text-3xl font-semibold">Search</h1>
      <SearchView currency={profile?.currency ?? "USD"} />
    </div>
  );
}
