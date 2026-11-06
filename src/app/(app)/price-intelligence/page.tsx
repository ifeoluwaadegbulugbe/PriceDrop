import Link from "next/link";
import { PriceIntelligenceView } from "@/components/price-intelligence-view";
import { loadIntelligence } from "@/lib/intelligence/load";
import { getDeps } from "@/lib/serverDeps";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Price details - PriceDrop" };

export default async function PriceIntelligencePage() {
  const { supabase } = await getViewer();
  const { rows, activity } = await loadIntelligence(supabase, getDeps().now());
  return (
    <div className="grid gap-5">
      <nav aria-label="Breadcrumb"><Link href="/saved" className="text-sm text-muted-foreground hover:underline">Saved items</Link></nav>
      <div>
        <h1 className="text-3xl font-semibold">Price details</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sort, filter and manage the items you&apos;re watching, using prices we actually recorded.</p>
      </div>
      <PriceIntelligenceView rows={rows} activity={activity} />
    </div>
  );
}
