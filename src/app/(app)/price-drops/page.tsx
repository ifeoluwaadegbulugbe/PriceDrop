import Link from "next/link";
import { DropCard } from "@/components/drop-card";
import { trendingDrops } from "@/lib/discovery/service";
import { getDeps } from "@/lib/serverDeps";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Price drops - PriceDrop" };

export default async function PriceDropsPage() {
  await getViewer();
  const drops = await trendingDrops(getDeps(), 48);
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-3xl font-semibold">Prices have dropped</h1>
        <p className="mt-1 text-muted-foreground">Prices we watched fall at the same retailer in the last 7 days.</p>
      </div>
      {drops.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-2xl border border-dashed p-10 text-center">
          <p className="font-medium">No price drops this week</p>
          <p className="max-w-md text-sm text-muted-foreground">We only show a drop when we recorded the higher price ourselves, so nothing here is a guess. Save a few items and we&apos;ll have more to watch.</p>
          <Link href="/categories" className="mt-1 text-sm font-medium text-primary hover:underline">Explore products</Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {drops.map((d) => <li key={`${d.ref.source}:${d.ref.id}`}><DropCard drop={d} /></li>)}
        </ul>
      )}
    </div>
  );
}
