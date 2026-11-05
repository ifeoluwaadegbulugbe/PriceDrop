"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto grid max-w-md gap-3 py-16 text-center">
      <h1 className="text-2xl font-semibold">That didn&apos;t load</h1>
      <p className="text-sm text-muted-foreground">Something went wrong on our side. No payment was affected.</p>
      <div><Button size="lg" onClick={reset}>Try again</Button></div>
    </div>
  );
}
