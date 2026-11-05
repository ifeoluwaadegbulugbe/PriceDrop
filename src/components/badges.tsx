import { cn } from "cn";
import type { ObservationSource, TrackedStatus } from "@/lib/db/types";
import { formatCents } from "@/lib/money";

const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function DemoCatalogueBadge({ className }: { className?: string }) {
  return <span className={cn(base, "bg-secondary text-secondary-foreground", className)}>Demo catalogue</span>;
}
export function SimulationBadge({ className }: { className?: string }) {
  return <span className={cn(base, "bg-sim-soft text-sim", className)}>Demo simulation</span>;
}
export function SandboxBadge({ className }: { className?: string }) {
  return <span className={cn(base, "bg-caution-soft text-caution", className)}>Sandbox</span>;
}
export function LiveBadge({ className }: { className?: string }) {
  return <span className={cn(base, "bg-accent text-accent-foreground", className)}>Live from Channel3</span>;
}

export function SourceBadge({ source }: { source: ObservationSource }) {
  if (source === "demo_simulation") return <SimulationBadge />;
  if (source === "seed") return <DemoCatalogueBadge />;
  return <LiveBadge />;
}

/** Green only when at or below target. */
export function DeltaBadge({ priceCents, targetCents, currency }: { priceCents: number; targetCents: number; currency: string }) {
  const diff = targetCents - priceCents;
  if (diff >= 0) {
    return (
      <span className={cn(base, "tnum bg-deal-soft text-deal")}>
        {diff === 0 ? "At target" : `${formatCents(diff, currency)} below target`}
      </span>
    );
  }
  return <span className={cn(base, "tnum bg-secondary text-secondary-foreground")}>{formatCents(-diff, currency)} above target</span>;
}

const STATUS: Record<TrackedStatus, string> = {
  active: "Watching",
  paused: "Paused",
  deal_found: "Deal found",
  purchased: "Purchased (sandbox)",
  removed: "Removed",
};

export function TrackedStatusBadge({ status }: { status: TrackedStatus }) {
  return (
    <span className={cn(base, status === "deal_found" ? "bg-deal-soft text-deal" : "bg-secondary text-secondary-foreground")}>
      {STATUS[status]}
    </span>
  );
}

export function SandboxBanner({ className }: { className?: string }) {
  return (
    <p role="note" className={cn("rounded-lg bg-caution-soft px-3 py-2 text-sm text-caution", className)}>
      <strong className="font-semibold">Sandbox</strong> - no real money moves and no retailer ships an item.
    </p>
  );
}
