import { SandboxBadge, SandboxBanner } from "@/components/badges";
import type { ProductRow, PurchaseRow } from "@/lib/db/types";
import { dateTime } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Purchases - PriceDrop" };

export default async function PurchasesPage() {
  const { supabase } = await getViewer();
  const { data, error } = await supabase.from("purchases").select("*").order("purchased_at", { ascending: false }).limit(100);
  const purchases = (data ?? []) as PurchaseRow[];
  const ids = [...new Set(purchases.map((p) => p.product_id))];
  const { data: productData } = ids.length ? await supabase.from("products").select("*").in("id", ids) : { data: [] };
  const products = new Map(((productData ?? []) as ProductRow[]).map((p) => [p.id, p]));

  return (
    <div className="grid gap-5">
      <h1 className="text-3xl font-semibold">Purchases</h1>
      <SandboxBanner />
      {error ? (
        <p role="alert" className="text-sm text-destructive">We couldn&apos;t load your purchases. Please refresh.</p>
      ) : purchases.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No purchases yet. A purchase appears here only after PayPal confirms the capture.
        </p>
      ) : (
        <ul className="grid gap-3">
          {purchases.map((p) => (
            <li key={p.id} className="grid gap-2 rounded-2xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium break-words">{products.get(p.product_id)?.title ?? "Product"}</p>
                  <p className="text-sm break-all text-muted-foreground">{p.retailer_domain} · {dateTime(p.purchased_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tnum text-lg font-semibold">{formatCents(p.amount_cents, p.currency)}</span>
                  <SandboxBadge />
                </div>
              </div>
              {p.refunded_at && <p className="text-sm text-caution">PayPal reports this sandbox capture was refunded.</p>}
              <dl className="grid gap-1 text-xs sm:grid-cols-2">
                <div><dt className="text-muted-foreground">PayPal order ID</dt><dd className="font-mono break-all">{p.paypal_order_id}</dd></div>
                <div><dt className="text-muted-foreground">PayPal capture ID</dt><dd className="font-mono break-all">{p.paypal_capture_id}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
