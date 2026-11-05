import { PriceIntelligenceView } from "@/components/price-intelligence-view";
import { loadIntelligence } from "@/lib/intelligence/load";
import { getDeps } from "@/lib/serverDeps";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Price Intelligence - PriceDrop" };

export default async function PriceIntelligencePage() {
  const { supabase } = await getViewer();
  const { rows, activity } = await loadIntelligence(supabase, getDeps().now());
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-3xl font-semibold">Price Intelligence</h1>
        <p className="mt-1 text-sm text-muted-foreground">Everything you&apos;re tracking in one place, from prices we actually recorded.</p>
      </div>
      <PriceIntelligenceView rows={rows} activity={activity} />
    </div>
  );
}
