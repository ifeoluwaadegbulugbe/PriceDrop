"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type GridApi, type ICellRendererParams, type NewValueParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { timeAgo } from "@/lib/format";
import type { ActivityEvent, IntelligenceRow, RowStatus } from "@/lib/intelligence/rows";
import { STATUS_LABELS } from "@/lib/intelligence/rows";
import { formatCents } from "@/lib/money";
import { retailerHref, type RowActions } from "./price-intelligence-view";

// Community modules only. No Enterprise package is installed.
ModuleRegistry.registerModules([AllCommunityModule]);

/** Colours and type come from PriceDrop's own tokens, so the grid follows the brand and dark mode. */
const theme = themeQuartz.withParams({
  accentColor: "var(--brand)",
  backgroundColor: "var(--card)",
  foregroundColor: "var(--card-foreground)",
  borderColor: "var(--border)",
  headerBackgroundColor: "var(--card)",
  headerTextColor: "var(--muted-foreground)",
  fontFamily: "var(--font-text)",
  fontSize: 14,
  borderRadius: 16,
  wrapperBorderRadius: 16,
  rowBorder: { style: "solid", width: 1, color: "var(--border)" },
  columnBorder: false,
  headerRowBorder: { style: "solid", width: 1, color: "var(--border)" },
  rowHoverColor: "var(--muted)",
  cellHorizontalPadding: 10,
});

const STATUS_CLASS: Record<RowStatus, string> = {
  target_reached: "bg-deal-soft text-deal",
  price_dropped: "bg-brand-soft text-accent-foreground",
  watching: "bg-secondary text-secondary-foreground",
  paused: "bg-secondary text-muted-foreground",
  purchased: "bg-caution-soft text-caution",
  not_checked: "bg-secondary text-muted-foreground",
};

function ProductCell({ data }: ICellRendererParams<IntelligenceRow>) {
  if (!data) return null;
  return (
    <span className="flex h-full items-center gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
        {data.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- catalogue CDN images
          <img src={data.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-contain" />
        ) : (
          <span aria-hidden className="text-xs text-[#6b6b76]">{data.title.slice(0, 1)}</span>
        )}
      </span>
      <span className="flex min-w-0 flex-col justify-center leading-snug">
        <Link href={`/products/${data.id}`} className="line-clamp-2 font-medium whitespace-normal hover:underline">{data.title}</Link>
        {data.domain && <span className="truncate text-xs text-muted-foreground">{data.domain}</span>}
      </span>
    </span>
  );
}

function PriceCell({ data }: ICellRendererParams<IntelligenceRow>) {
  if (!data) return null;
  if (data.currentCents === null) return <span className="text-muted-foreground">No price yet</span>;
  return (
    <span className="tnum flex h-full flex-col items-end justify-center leading-tight">
      <span className="font-semibold">{formatCents(data.currentCents, data.currency)}</span>
      {data.isSimulated && <span className="text-xs text-sim">Demo simulation</span>}
    </span>
  );
}

function PreviousCell({ data }: ICellRendererParams<IntelligenceRow>) {
  if (!data) return null;
  if (data.previousCents === null) return <span className="text-muted-foreground">None yet</span>;
  return (
    <span className="tnum flex h-full flex-col items-end justify-center leading-tight">
      <span>{formatCents(data.previousCents, data.currency)}</span>
      {data.reductionPercent !== null && <span className="text-xs font-medium text-deal">{data.reductionPercent}% lower now</span>}
    </span>
  );
}

function TargetGapCell({ data }: ICellRendererParams<IntelligenceRow>) {
  if (!data || data.toTargetCents === null) return <span className="text-muted-foreground">Unknown</span>;
  if (data.toTargetCents <= 0) return <span className="tnum font-medium text-deal">Reached</span>;
  return <span className="tnum">{formatCents(data.toTargetCents, data.currency)} to go</span>;
}

function StatusCell({ data }: ICellRendererParams<IntelligenceRow>) {
  if (!data) return null;
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_CLASS[data.status]}`}>{STATUS_LABELS[data.status]}</span>;
}

function CheckedCell({ data }: ICellRendererParams<IntelligenceRow>) {
  if (!data) return null;
  if (!data.observedAt) return <span className="text-muted-foreground">Never checked</span>;
  return (
    <span className="flex h-full flex-col justify-center leading-tight">
      <span>{timeAgo(data.observedAt)}</span>
      {(data.lastCheckFailed || data.stale) && <span className="text-xs text-caution">May be out of date</span>}
    </span>
  );
}

function ActionsCell({ data, actions }: ICellRendererParams<IntelligenceRow> & { actions: RowActions }) {
  if (!data) return null;
  const cls = "text-primary hover:underline disabled:opacity-50";
  const busy = actions.busyId === data.id;
  return (
    <span className="flex h-full items-center gap-2.5 text-sm">
      <Link href={`/products/${data.id}`} className={cls}>View</Link>
      {data.domain && data.source === "channel3" && <a href={retailerHref(data)} target="_blank" rel="noopener noreferrer nofollow sponsored" className={cls}>Retailer</a>}
      {data.trackedStatus !== "purchased" && (
        <>
          <button type="button" disabled={busy} className={cls} onClick={() => actions.togglePause(data)}>{data.trackedStatus === "paused" ? "Resume" : "Pause"}</button>
          <button type="button" disabled={busy} className="text-muted-foreground hover:underline disabled:opacity-50" onClick={() => actions.remove(data)}>Remove</button>
        </>
      )}
    </span>
  );
}

export default function PriceGrids({ rows, activity, sortResetKey, search, actions }: {
  rows: IntelligenceRow[];
  activity: ActivityEvent[];
  /** Changes when the shopper picks a sort above the grid, so an earlier column click stops overriding it. */
  sortResetKey: string;
  search: string;
  actions: RowActions;
}) {
  const apiRef = useRef<GridApi<IntelligenceRow> | null>(null);
  const revertingTo = useRef<number | null>(null);
  const actionsRef = useRef(actions);
  useEffect(() => { actionsRef.current = actions; });

  useEffect(() => {
    apiRef.current?.applyColumnState({ defaultState: { sort: null } });
  }, [sortResetKey]);

  async function onTargetEdited(e: NewValueParams<IntelligenceRow>) {
    // Putting the old value back fires this handler again, later. That isn't a save, so it stays silent.
    if (revertingTo.current !== null && Number(e.newValue) === revertingTo.current) {
      revertingTo.current = null;
      return;
    }
    if (e.newValue === e.oldValue) return;
    const revert = () => {
      revertingTo.current = Number(e.oldValue);
      e.node?.setDataValue("target", e.oldValue);
    };
    const ok = await actionsRef.current.saveTarget(e.data, Number(e.newValue));
    if (!ok) revert();
  }

  const columns = useMemo<ColDef<IntelligenceRow>[]>(() => [
    { colId: "product", field: "title", headerName: "Product", flex: 2, minWidth: 240, cellRenderer: ProductCell, getQuickFilterText: (p) => `${p.data.title} ${p.data.brand ?? ""} ${p.data.domain ?? ""}` },
    {
      colId: "current", field: "currentCents", headerName: "Price now", width: 112, type: "rightAligned", cellRenderer: PriceCell,
      comparator: (a, b) => (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER),
    },
    { colId: "previous", field: "previousCents", headerName: "Before", width: 108, type: "rightAligned", cellRenderer: PreviousCell },
    {
      colId: "target", field: "targetCents", headerName: "Target", width: 92, type: "rightAligned",
      editable: (p) => p.data?.trackedStatus !== "purchased",
      headerTooltip: "Click a target to change it",
      cellEditor: "agNumberCellEditor",
      cellEditorParams: { min: 0, precision: 2 },
      valueGetter: (p) => (p.data ? p.data.targetCents / 100 : null),
      valueSetter: (p) => {
        const v = Number(p.newValue);
        if (!Number.isFinite(v)) return false;
        p.data.targetCents = Math.round(v * 100);
        return true;
      },
      valueFormatter: (p) => (p.value == null || !p.data ? "" : formatCents(Math.round((p.value as number) * 100), p.data.currency)),
      cellClass: "font-medium underline decoration-dotted decoration-muted-foreground underline-offset-4 cursor-text",
      onCellValueChanged: onTargetEdited,
    },
    {
      colId: "gap", field: "toTargetCents", headerName: "Left to save", width: 108, cellRenderer: TargetGapCell,
      comparator: (a, b) => (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER),
    },
    { colId: "status", field: "status", headerName: "Status", width: 132, cellRenderer: StatusCell },
    {
      colId: "checked", field: "observedAt", headerName: "Checked", width: 104, cellRenderer: CheckedCell,
      comparator: (a, b) => String(b ?? "").localeCompare(String(a ?? "")),
    },
    { colId: "actions", headerName: "", width: 212, sortable: false, cellRenderer: ActionsCell, cellRendererParams: { get actions() { return actionsRef.current; } } },
  ], []);

  const activityColumns = useMemo<ColDef<ActivityEvent>[]>(() => [
    { field: "label", headerName: "What happened", width: 150, cellClass: "font-medium" },
    {
      field: "productTitle", headerName: "Product", flex: 1, minWidth: 200,
      cellRenderer: (p: ICellRendererParams<ActivityEvent>) => p.data?.href ? <Link href={p.data.href} className="hover:underline">{p.data.productTitle}</Link> : p.data?.productTitle,
    },
    { field: "description", headerName: "Details", flex: 2, minWidth: 320, wrapText: false, tooltipField: "description" },
    { field: "at", headerName: "When", width: 120, sort: "desc", valueFormatter: (p) => timeAgo(p.value as string) },
  ], []);

  return (
    <div className="grid gap-8">
      <section aria-label="Your tracked products">
        <AgGridReact<IntelligenceRow>
          theme={theme}
          rowData={rows}
          columnDefs={columns}
          defaultColDef={{ sortable: true, resizable: true, suppressHeaderMenuButton: true }}
          quickFilterText={search}
          getRowId={(p) => p.data.id}
          rowHeight={68}
          animateRows={false}
          headerHeight={44}
          domLayout="autoHeight"
          singleClickEdit
          stopEditingWhenCellsLoseFocus
          pagination={rows.length > 20}
          paginationPageSize={20}
          paginationPageSizeSelector={[20, 50, 100]}
          tooltipShowDelay={300}
          onGridReady={(e) => { apiRef.current = e.api; }}
          overlayNoRowsTemplate="No products match this view."
        />
      </section>

      <section aria-label="Deal activity" className="grid gap-3">
        <div>
          <h2 className="text-xl font-semibold">Deal activity</h2>
          <p className="text-sm text-muted-foreground">What has happened to the products you track. Payment entries are always sandbox.</p>
        </div>
        {activity.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing yet. Price changes and deals will appear here.</p>
        ) : (
          <AgGridReact<ActivityEvent>
            theme={theme}
            rowData={activity}
            columnDefs={activityColumns}
            defaultColDef={{ sortable: true, resizable: true, suppressHeaderMenuButton: true }}
            getRowId={(p) => p.data.id}
            rowHeight={52}
            animateRows={false}
            headerHeight={44}
            domLayout="autoHeight"
            pagination={activity.length > 10}
            paginationPageSize={10}
            paginationPageSizeSelector={[10, 25, 50]}
          />
        )}
      </section>
    </div>
  );
}
