import { cn } from "cn";
import { Footprints, Headphones, Laptop, Package, Smartphone } from "lucide-react";

function TileIcon({ title }: { title: string }) {
  const t = title.toLowerCase();
  const props = { "aria-hidden": true, className: "size-2/5 text-muted-foreground", strokeWidth: 1.25 };
  if (/headphone|earbud|airpod/.test(t)) return <Headphones {...props} />;
  if (/laptop|macbook|notebook/.test(t)) return <Laptop {...props} />;
  if (/phone|pixel|galaxy/.test(t)) return <Smartphone {...props} />;
  if (/shoe|sneaker|running/.test(t)) return <Footprints {...props} />;
  return <Package {...props} />;
}

/** Real product photo when the source has one. Demo catalogue items get an icon tile, never a fake photo. */
export function ProductTile({ title, imageUrl, className }: { title: string; imageUrl: string | null; className?: string }) {
  return (
    <div className={cn("relative flex aspect-square shrink-0 items-center justify-center overflow-hidden rounded-xl", imageUrl ? "bg-white" : "bg-secondary", className)}>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- retailer CDNs are unbounded, so next/image can't allowlist them
        <img src={imageUrl} alt={title} referrerPolicy="no-referrer" loading="lazy" className="size-full object-contain p-2 mix-blend-multiply" />
      ) : (
        <TileIcon title={title} />
      )}
    </div>
  );
}
