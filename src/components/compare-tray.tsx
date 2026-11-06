"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { clearCompare, COMPARE_MAX, useCompare } from "@/lib/compare-store";

export function CompareTray() {
  const items = useCompare();
  const pathname = usePathname();
  if (items.length === 0 || pathname.startsWith("/compare") || pathname.startsWith("/price-intelligence")) return null;
  return (
    <div role="region" aria-label="Compare your options" className={`fixed inset-x-3 z-30 mx-auto flex max-w-md items-center justify-between gap-3 rounded-full border bg-card py-2 pr-2 pl-4 shadow-lg ${pathname.startsWith("/assistant") ? "bottom-36 md:bottom-20" : "bottom-20 md:bottom-5"}`} data-tray=" compare" style={{ maxWidth: "28rem" }}>
      <p className="text-sm font-medium">{items.length} of {COMPARE_MAX} to compare</p>
      <span className="flex items-center gap-1">
        <button type="button" onClick={clearCompare} className="min-h-9 px-3 text-sm text-muted-foreground hover:text-foreground">Clear</button>
        {items.length >= 2 ? (
          <Link href={`/compare?items=${items.map(encodeURIComponent).join(",")}`} className={buttonVariants({ className: "rounded-full" })}>Compare</Link>
        ) : (
          <span className="px-3 text-xs text-muted-foreground">Pick one more</span>
        )}
      </span>
    </div>
  );
}
