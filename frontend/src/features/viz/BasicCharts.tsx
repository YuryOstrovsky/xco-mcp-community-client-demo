// Generic basic-chart viz blocks (donut / bar / stacked). Each maps a
// viz payload onto a recharts shape with the project's accent colors.
//
// Pure presentational. Extracted from App.tsx.

import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

export function DonutChartViz({ data, animatePie }: { data: any[]; animatePie: boolean }) {
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip cursor={{ fill: "transparent" }} />
          <Pie
            data={data ?? []}
            dataKey="value"
            nameKey="name"
            innerRadius={70}
            outerRadius={110}
            paddingAngle={2}
            isAnimationActive={animatePie}
          >
            {(data ?? []).map((_, idx) => (
              <Cell
                key={idx}
                fill={idx === 0 ? "var(--accent)" : "rgba(137,129,229,0.35)"}
                stroke="var(--subtle-border)"
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarChartViz({ data, xKey, keys }: { data: any[]; xKey?: string; keys?: string[] }) {
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data ?? []} margin={{ left: 8, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xKey ?? "name"} tick={{ fill: "#cfd3ff" }} />
          <YAxis tick={{ fill: "#cfd3ff" }} />
          <Tooltip cursor={{ fill: "transparent" }} />
          <Bar dataKey={(keys?.[0] as string) ?? "value"} fill="var(--accent)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StackedBarViz({ data, xKey, keys }: { data: any[]; xKey?: string; keys?: string[] }) {
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data ?? []} margin={{ left: 8, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xKey ?? "name"} tick={{ fill: "#cfd3ff" }} />
          <YAxis tick={{ fill: "#cfd3ff" }} />
          <Tooltip cursor={{ fill: "transparent" }} />
          {(keys ?? []).map((k, idx) => (
            <Bar
              key={k}
              dataKey={k}
              stackId="a"
              fill={idx === 0 ? "rgba(137,129,229,0.35)" : "var(--accent)"}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
