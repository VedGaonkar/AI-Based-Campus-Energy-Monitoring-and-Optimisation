import React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
const number = (n) =>
  Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
export default function ConsumptionChart({ intervals = [], range = 7 }) {
  const end = intervals.length
    ? new Date(intervals.at(-1).endAt).getTime()
    : Date.now();
  const data = intervals
    .filter((i) => new Date(i.startAt).getTime() >= end - range * 86400000)
    .map((i) => ({
      ...i,
      label: new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        month: "short",
        day: "numeric",
        hour: "2-digit",
      }).format(new Date(i.startAt)),
      expected: i.baseline?.expectedKwh,
    }));
  if (!data.length)
    return (
      <div className="empty">
        <h3>No accepted intervals yet</h3>
        <p>Import meter data to draw the consumption profile.</p>
      </div>
    );
  return (
    <div
      className="chart-wrap"
      aria-label="Building consumption and expected interval energy in kWh"
    >
      <ResponsiveContainer width="100%" height={290}>
        <AreaChart
          data={data}
          margin={{ top: 15, right: 10, left: -18, bottom: 0 }}
        >
          <defs>
            <linearGradient id="energyGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeDasharray="3 4"
          />
          <XAxis
            dataKey="label"
            minTickGap={75}
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(v, name) => [`${number(v)} kWh`, name]}
            labelStyle={{ color: "var(--text-primary)" }}
            contentStyle={{ border: "1px solid var(--border)", borderRadius: 2, fontFamily: "var(--mono)", fontSize: 11 }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 20 }} />
          <Area
            type="monotone"
            dataKey="energyKwh"
            name="Recorded interval energy"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#energyGradient)"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="expected"
            name="Expected · estimated"
            stroke="var(--text-primary)"
            strokeDasharray="5 4"
            fill="transparent"
            connectNulls={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <p className="caption">
        Building meter scope · kWh per original interval · gaps remain aggregate
        intervals · synthetic seed data is simulated.
      </p>
    </div>
  );
}
