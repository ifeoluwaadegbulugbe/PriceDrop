import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-label="Loading" className="grid gap-4">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-28 rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-36 rounded-2xl" />
      </div>
    </div>
  );
}
