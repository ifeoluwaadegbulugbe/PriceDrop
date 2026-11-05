"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ObservationRow } from "@/lib/db/types";
import { formatCents } from "@/lib/money";

const SOURCE_LABEL = { channel3_live: "Live from Channel3", seed: "Demo catalogue", demo_simulation: "Demo simulation" } as const;

type Point = { t: number; [domain: string]: number };

/** Built only from recorded observations. One line per retailer. Simulated points get a distinct marker. */
export function PriceChart({ observations, targetCents, currency }: { observations: ObservationRow[]; targetCents: number; currency: string }) {
  const domains = [...new Set(observations.map((o) => o.domain))];
  const byTime = new Map<number, Point>();
  const meta = new Map<string, ObservationRow>();
  for (const o of observations) {
    const t = new Date(o.observed_at).getTime();
    const point = byTime.get(t) ?? { t };
    point[o.domain] = o.price_cents;
    byTime.set(t, point);
    meta.set(`${o.domain}|${t}`, o);
  }
  const data = [...byTime.values()].sort((a, b) => a.t - b.t);
  const fmtTime = (t: number) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const money = (c: number) => formatCents(c, currency);

  return (
    <figure className="m-0">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} minTickGap={40} />
            <YAxis tickFormatter={money} width={72} stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, color: "var(--popover-foreground)" }}
              labelFormatter={(t) => fmtTime(Number(t))}
              formatter={(value, name, item) => {
                const o = meta.get(`${name}|${(item.payload as Point).t}`);
                return [`${money(Number(value))}${o ? ` (${SOURCE_LABEL[o.source]})` : ""}`, String(name)];
              }}
            />
            <ReferenceLine y={targetCents} stroke="var(--deal)" strokeDasharray="5 4" label={{ value: "Your target", position: "insideTopRight", fill: "var(--deal)", fontSize: 12 }} />
            {domains.map((d, i) => (
              <Line
                key={d}
                dataKey={d}
                name={d}
                type="stepAfter"
                connectNulls
                isAnimationActive={false}
                stroke={i === 0 ? "var(--primary)" : "var(--muted-foreground)"}
                strokeWidth={2}
                dot={(props: { cx?: number; cy?: number; payload?: Point; key?: React.Key | null }) => {
                  const { cx, cy, payload } = props;
                  const k = String(props.key ?? `${d}-${payload?.t}`);
                  if (cx === undefined || cy === undefined || !payload || payload[d] === undefined) return <g key={k} />;
                  const sim = meta.get(`${d}|${payload.t}`)?.source === "demo_simulation";
                  return sim
                    ? <rect key={k} x={cx - 4} y={cy - 4} width={8} height={8} transform={`rotate(45 ${cx} ${cy})`} fill="var(--sim)" />
                    : <circle key={k} cx={cx} cy={cy} r={3} fill={i === 0 ? "var(--primary)" : "var(--muted-foreground)"} />;
                }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {domains.map((d, i) => (
          <span key={d} className="inline-flex items-center gap-1.5 break-all">
            <span aria-hidden className="inline-block h-0.5 w-4" style={{ background: i === 0 ? "var(--primary)" : "var(--muted-foreground)" }} />
            {d}
          </span>
        ))}
        {observations.some((o) => o.source === "demo_simulation") && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2 rotate-45" style={{ background: "var(--sim)" }} />
            Demo simulation
          </span>
        )}
      </figcaption>
    </figure>
  );
}
