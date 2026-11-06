"use client";

import { cn } from "cn";
import { Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { ProductTile } from "@/components/product-tile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api/client";
import { parseMoneyInput, timeAgo, centsToInput } from "@/lib/format";
import { matchesStatus, sortRows, type SortKey, type StatusFilter } from "@/lib/intelligence/query";
import { STATUS_LABELS, type ActivityEvent, type IntelligenceRow, type RowStatus } from "@/lib/intelligence/rows";
import { formatCents } from "@/lib/money";

const PriceGrids = dynamic(() => import("./price-grid"), {
  ssr: false,
  loading: () => <Skeleton className="h-96 rounded-2xl" />,
});

// Below this the grid would need sideways scrolling, so phones and small tablets get cards.
const QUERY = "(min-width: 1100px)";
function useIsDesktop() {
  return useSyncExternalStore(
    (notify) => {
      const m = window.matchMedia(QUERY);
      m.addEventListener("change", notify);
      return () => m.removeEventListener("change", notify);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

export const retailerHref = (r: IntelligenceRow) => `/api/tracking/${r.id}/retailer?domain=${encodeURIComponent(r.domain ?? "")}`;

export type RowActions = {
  busyId: string | null;
  saveTarget: (row: IntelligenceRow, dollars: number) => Promise<boolean>;
  togglePause: (row: IntelligenceRow) => void;
  remove: (row: IntelligenceRow) => void;
};

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All items" },
  { value: "price_dropped", label: "Price dropped" },
  { value: "target_reached", label: "At my ideal price" },
  { value: "watching", label: "Still watching" },
  { value: "paused", label: "Paused" },
];
const SORT_LABELS: { value: SortKey; label: string }[] = [
  { value: "recently_added", label: "Recently added" },
  { value: "lowest_price", label: "Lowest price" },
  { value: "highest_price", label: "Highest price" },
  { value: "biggest_drop", label: "Biggest price drop" },
  { value: "closest_to_target", label: "Closest to ideal price" },
  { value: "recently_checked", label: "Recently checked" },
];
const EXAMPLES = ["Which of my items has dropped the most?", "Are any at my ideal price?", "Which are closest to my ideal price?"];

const STATUS_CLASS: Record<RowStatus, string> = {
  target_reached: "bg-deal-soft text-deal",
  price_dropped: "bg-brand-soft text-accent-foreground",
  watching: "bg-secondary text-secondary-foreground",
  paused: "bg-secondary text-muted-foreground",
  purchased: "bg-caution-soft text-caution",
  not_checked: "bg-secondary text-muted-foreground",
};

function MobileCard({ row, actions }: { row: IntelligenceRow; actions: RowActions }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(centsToInput(row.targetCents));
  const busy = actions.busyId === row.id;
  const bought = row.trackedStatus === "purchased";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseMoneyInput(value);
    if (cents === null) return;
    if (await actions.saveTarget(row, cents / 100)) setEditing(false);
  }

  return (
    <li className="grid gap-3 rounded-2xl border bg-card p-3">
      <Link href={`/products/${row.id}`} className="flex gap-3">
        <ProductTile title={row.title} imageUrl={row.imageUrl} className="size-16" />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm leading-snug font-medium break-words">{row.title}</span>
          <span className={cn("mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[row.status])}>{STATUS_LABELS[row.status]}</span>
        </span>
      </Link>
      <dl className="tnum grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Latest price</dt>
          <dd className="font-semibold">{row.currentCents === null ? "No price yet" : formatCents(row.currentCents, row.currency)}</dd>
          {row.reductionPercent !== null && <dd className="text-xs font-medium text-deal">{row.reductionPercent}% lower</dd>}
          {row.isSimulated && <dd className="text-xs text-sim">Demo simulation</dd>}
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">My ideal price</dt>
          <dd className="font-semibold">{formatCents(row.targetCents, row.currency)}</dd>
          <dd className="text-xs text-muted-foreground">
            {row.toTargetCents === null ? "" : row.toTargetCents <= 0 ? "At or below your ideal price" : `${formatCents(row.toTargetCents, row.currency)} to go`}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        {row.observedAt ? `Checked ${timeAgo(row.observedAt)}${row.domain ? ` at ${row.domain}` : ""}` : "Never checked yet"}
        {(row.stale || row.lastCheckFailed) && row.observedAt ? ". May be out of date." : ""}
      </p>
      {editing && (
        <form onSubmit={submit} className="flex gap-2">
          <label htmlFor={`target-${row.id}`} className="sr-only">New ideal price</label>
          <input id={`target-${row.id}`} inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value)} className="tnum h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-base" />
          <Button type="submit" disabled={busy} className="h-10">{busy ? "Saving..." : "Save"}</Button>
          <Button type="button" variant="ghost" className="h-10" onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {!bought && !editing && <button type="button" className="min-h-9 font-medium text-primary" onClick={() => setEditing(true)}>Change my ideal price</button>}
        {row.domain && row.source === "channel3" && <a href={retailerHref(row)} target="_blank" rel="noopener noreferrer nofollow sponsored" className="inline-flex min-h-9 items-center text-primary">Retailer</a>}
        {!bought && <button type="button" disabled={busy} className="min-h-9 text-primary" onClick={() => actions.togglePause(row)}>{row.trackedStatus === "paused" ? "Resume" : "Pause"}</button>}
        {!bought && <button type="button" disabled={busy} className="min-h-9 text-muted-foreground" onClick={() => actions.remove(row)}>Remove</button>}
      </div>
    </li>
  );
}

export function PriceIntelligenceView({ rows, activity }: { rows: IntelligenceRow[]; activity: ActivityEvent[] }) {
  const desktop = useIsDesktop();
  const router = useRouter();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("recently_added");
  const [retailer, setRetailer] = useState("");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; kind: "saving" | "ok" | "error" } | null>(null);

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; ids: string[]; basic: boolean } | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const retailers = useMemo(() => [...new Set(rows.flatMap((r) => (r.domain ? [r.domain] : [])))].sort(), [rows]);

  // One pipeline for the grid and the phone cards, so they can never disagree.
  const visible = useMemo(() => {
    const ids = answer ? new Set(answer.ids) : null;
    const filtered = rows.filter((r) => {
      if (ids) return ids.has(r.id);
      if (!matchesStatus(r, status)) return false;
      if (retailer && r.domain !== retailer) return false;
      return true;
    });
    const sorted = sortRows(filtered, sort);
    return answer ? answer.ids.flatMap((id) => sorted.find((r) => r.id === id) ?? []) : sorted;
  }, [rows, status, retailer, sort, answer]);

  const searchedOnPhone = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return visible;
    return visible.filter((r) => `${r.title} ${r.brand ?? ""} ${r.domain ?? ""}`.toLowerCase().includes(s));
  }, [visible, search]);

  const actions: RowActions = {
    busyId,
    async saveTarget(row, dollars) {
      if (!Number.isFinite(dollars) || dollars <= 0) {
        setMessage({ text: "Enter an ideal price above zero.", kind: "error" });
        return false;
      }
      const cents = Math.round(dollars * 100);
      if (cents > row.maxCents) {
        setMessage({ text: `That's above your ${formatCents(row.maxCents, row.currency)} limit. Open the item to raise the most you'd pay first.`, kind: "error" });
        return false;
      }
      setBusyId(row.id);
      setMessage({ text: "Saving your ideal price...", kind: "saving" });
      try {
        await api(`/api/tracking/${row.id}`, { method: "PATCH", body: { targetPriceCents: cents } });
        setMessage({ text: `Saved. Your ideal price for ${row.title} is now ${formatCents(cents, row.currency)}.`, kind: "ok" });
        router.refresh();
        return true;
      } catch (e) {
        setMessage({ text: `${errorMessage(e)} Your previous ideal price is unchanged.`, kind: "error" });
        return false;
      } finally {
        setBusyId(null);
      }
    },
    async togglePause(row) {
      const paused = row.trackedStatus === "paused";
      setBusyId(row.id);
      try {
        await api(`/api/tracking/${row.id}`, { method: "PATCH", body: { status: paused ? "active" : "paused" } });
        setMessage({ text: paused ? `Resumed watching ${row.title}.` : `Paused ${row.title}.`, kind: "ok" });
        router.refresh();
      } catch (e) {
        setMessage({ text: errorMessage(e), kind: "error" });
      } finally {
        setBusyId(null);
      }
    },
    async remove(row) {
      if (!window.confirm(`Stop watching ${row.title}? The record of its price changes won't appear here any more.`)) return;
      setBusyId(row.id);
      try {
        await api(`/api/tracking/${row.id}`, { method: "DELETE" });
        setMessage({ text: `Stopped watching ${row.title}.`, kind: "ok" });
        router.refresh();
      } catch (e) {
        setMessage({ text: errorMessage(e), kind: "error" });
      } finally {
        setBusyId(null);
      }
    },
  };

  async function ask(q: string) {
    const clean = q.trim();
    if (!clean) return;
    setQuestion(clean);
    setAsking(true);
    setAskError(null);
    try {
      const r = await api<{ answer: string; ids: string[]; sort: SortKey; status: StatusFilter; mode: "llm" | "basic" }>("/api/intelligence/ask", { method: "POST", body: { question: clean } });
      setAnswer({ text: r.answer, ids: r.ids, basic: r.mode === "basic" });
      setSort(r.sort);
      setStatus("all");
      setRetailer("");
    } catch (e) {
      setAskError(errorMessage(e));
    } finally {
      setAsking(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="grid justify-items-center gap-2 rounded-2xl border border-dashed p-10 text-center">
        <p className="font-medium">No items being watched yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">Find something you like and set your ideal price. Your items and their prices will appear here.</p>
        <Link href="/dashboard" className="mt-1 text-sm font-medium text-primary hover:underline">Start shopping</Link>
      </div>
    );
  }

  const chip = (on: boolean) => cn("inline-flex min-h-10 shrink-0 items-center rounded-full border px-3.5 text-sm whitespace-nowrap", on ? "border-primary bg-accent font-medium text-accent-foreground" : "bg-card hover:bg-muted");

  return (
    <div className="grid gap-4">
      <section aria-label="Ask about your prices" className="grid gap-2 rounded-2xl bg-brand-soft p-4">
        <form onSubmit={(e) => { e.preventDefault(); void ask(question); }} className="flex gap-2">
          <label htmlFor="ask-input" className="sr-only">Ask about your prices</label>
          <span className="relative min-w-0 flex-1">
            <Sparkles aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-brand" />
            <input
              id="ask-input"
              value={question}
              maxLength={300}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about your prices"
              className="h-11 w-full rounded-full border border-input bg-card pr-3 pl-9 text-base"
            />
          </span>
          <Button type="submit" size="lg" className="rounded-full" disabled={asking}>{asking ? "Checking..." : "Ask"}</Button>
        </form>
        {!answer && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => void ask(ex)} className="min-h-8 rounded-full bg-card px-3 py-1 text-left text-xs text-muted-foreground hover:text-foreground">{ex}</button>
            ))}
          </div>
        )}
        {askError && <p role="alert" className="text-sm text-destructive">{askError}</p>}
        {answer && (
          <div aria-live="polite" className="grid gap-1 text-sm">
            <p>{answer.text}</p>
            <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
              From your own price records.{answer.basic ? " Basic mode: understood without AI." : ""}
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => { setAnswer(null); setQuestion(""); }}>Show all items</button>
            </p>
          </div>
        )}
      </section>

      <div className="grid gap-3">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" aria-pressed={!answer && status === f.value} onClick={() => { setAnswer(null); setStatus(f.value); }} className={chip(!answer && status === f.value)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-[2fr_1fr_1fr]">
          <input
            type="search"
            aria-label="Search by product or retailer"
            placeholder="Search by product or retailer"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="col-span-2 h-10 rounded-lg border border-input bg-card px-3 text-base md:col-span-1 md:text-sm"
          />
          <select aria-label="Filter by retailer" value={retailer} onChange={(e) => { setAnswer(null); setRetailer(e.target.value); }} className="h-10 min-w-0 rounded-lg border border-input bg-card px-2 text-sm">
            <option value="">All retailers</option>
            {retailers.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-10 min-w-0 rounded-lg border border-input bg-card px-2 text-sm">
            {SORT_LABELS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div aria-live="polite" className="min-h-5">
        {message && (
          <p role={message.kind === "error" ? "alert" : "status"} className={cn("text-sm", message.kind === "error" ? "text-destructive" : message.kind === "ok" ? "text-deal" : "text-muted-foreground")}>
            {message.text}
          </p>
        )}
      </div>

      {desktop ? (
        <PriceGrids rows={visible} activity={activity} sortResetKey={sort} search={search} actions={actions} />
      ) : (
        <div className="grid gap-8">
          {searchedOnPhone.length === 0 ? (
            <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">No items match this view.</p>
          ) : (
            <ul className="grid gap-3">
              {searchedOnPhone.slice(0, 40).map((r) => <MobileCard key={`${r.id}:${r.targetCents}`} row={r} actions={actions} />)}
            </ul>
          )}
          <section aria-label="Price updates" className="grid gap-3">
            <h2 className="text-xl font-semibold">Price updates</h2>
            {activity.length === 0 ? (
              <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing yet. Price changes will appear here.</p>
            ) : (
              <ul className="grid gap-2">
                {activity.slice(0, 15).map((a) => (
                  <li key={a.id} className="rounded-2xl border bg-card p-3 text-sm">
                    <p className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{a.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.at)}</span>
                    </p>
                    {a.href ? <Link href={a.href} className="line-clamp-1 hover:underline">{a.productTitle}</Link> : <p className="line-clamp-1">{a.productTitle}</p>}
                    <p className="text-xs text-muted-foreground">{a.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
