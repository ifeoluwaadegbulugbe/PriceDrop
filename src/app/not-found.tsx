import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-3 px-4 text-center">
      <h1 className="text-3xl font-semibold">We can&apos;t find that</h1>
      <p className="text-sm text-muted-foreground">It may have been removed, or it may belong to another account.</p>
      <div><Link href="/dashboard" className={buttonVariants({ size: "lg" })}>Go to dashboard</Link></div>
    </main>
  );
}
