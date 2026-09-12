/**
 * Live analytics charts (Recharts). Every chart is a pure function of the
 * month analytics payload — hover for exact values, click where it says
 * so to drill in. Colours come from the same tokens as the rest of the UI
 * so the charts follow the theme.
 */
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthAnalytics } from "./types";

import { DEPT_COLOR } from "./palette";
const SEV_COLOR: Record<string, string> = { A: "#f87171", B: "#fbbf24", C: "#34d399" };
const STATUS: { key: string; label: string; color: string }[] = [
  { key: "pending", label: "Requested", color: "#fbbf24" },
  { key: "awaiting_dept_response", label: "Offer pending", color: "#60a5fa" },
  { key: "awaiting_controller", label: "Awaiting controller", color: "#818cf8" },
  { key: "scheduled", label: "Scheduled", color: "#34d399" },
  { key: "completed", label: "Completed", color: "#64748b" },
  { key: "cleared", label: "Cleared", color: "#475569" },
];
const ACCENT = "var(--ops-accent)";
const GOOD = "#34d399";
const WARN = "#fbbf24";
const BAD = "#f87171";
const MUTED = "#64748b";
const AXIS = { stroke: "var(--ops-border)", fontSize: 11 } as const;

type TooltipRow = { name?: string | number; value?: number | string; color?: string; payload?: Record<string, unknown> };

function Tip({ active, payload, label, unit, labelText }: { active?: boolean; payload?: TooltipRow[]; label?: string | number; unit?: string; labelText?: (l: string | number | undefined, p: TooltipRow[]) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="ops-tooltip">
      <p className="font-semibold mb-1">{labelText ? labelText(label, payload) : label}</p>
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5 text-ops-muted">
          <span className="w-2 h-2 inline-block rounded-sm" style={{ background: p.color as string }} />
          {p.name}: <span className="mono text-ops-text">{typeof p.value === "number" ? (Number.isInteger(p.value) ? p.value : p.value.toFixed(2)) : p.value}</span>
          {unit ? ` ${unit}` : ""}
        </p>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="h-full flex items-center justify-center text-[11px] text-ops-muted">{text}</p>;
}

// ---------------------------------------------------------------- daily

const DAILY_METRICS = [
  { key: "hours", label: "Possession h", color: ACCENT },
  { key: "jobs", label: "Jobs", color: WARN },
  { key: "blockEvents", label: "Block events", color: "#22d3ee" },
  { key: "corridors", label: "Corridors", color: "#a855f7" },
] as const;

export function DailyChart({ d }: { d: MonthAnalytics }) {
  const [metric, setMetric] = useState<(typeof DAILY_METRICS)[number]["key"]>("hours");
  const rows = useMemo(() => {
    const by = new Map(d.daily.map((r) => [r.day, r]));
    const out = [];
    const start = new Date(d.start + "T00:00:00");
    for (let i = 0; i < d.days; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      const r = by.get(key);
      out.push({ day: key, label: String(day.getDate()), hours: r?.hours ?? 0, jobs: r?.jobs ?? 0, blockEvents: r?.blockEvents ?? 0, corridors: r?.corridors ?? 0 });
    }
    return out;
  }, [d]);
  if (!d.summary.blockEvents) return <Empty text="No blocks in this month" />;
  const m = DAILY_METRICS.find((x) => x.key === metric)!;
  const other = metric === "hours" ? DAILY_METRICS[1] : DAILY_METRICS[0];
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-1 pb-1">
        {DAILY_METRICS.map((x) => (
          <button key={x.key} onClick={() => setMetric(x.key)} className={`px-2 py-0.5 text-[10px] rounded ${metric === x.key ? "bg-ops-accent text-white" : "text-ops-muted hover:text-ops-text"}`}>
            {x.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-ops-muted">drag the brush to zoom</span>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={AXIS} interval={2} />
          <YAxis yAxisId="l" tickLine={false} axisLine={false} width={40} />
          <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} width={34} allowDecimals={false} />
          <Tooltip content={<Tip labelText={(l, p) => String((p[0]?.payload as { day?: string })?.day ?? l)} />} cursor={{ fill: "var(--ops-hover)" }} />
          <Legend iconType="circle" iconSize={8} />
          <Bar yAxisId="l" dataKey={m.key} name={m.label} fill={m.color} radius={[3, 3, 0, 0]} maxBarSize={22} />
          <Line yAxisId="r" type="monotone" dataKey={other.key} name={other.label} stroke={other.color} strokeWidth={1.6} dot={{ r: 2 }} activeDot={{ r: 4 }} />
          <Brush dataKey="label" height={16} stroke="var(--ops-border)" fill="var(--ops-inset)" travellerWidth={6} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CumulativeChart({ d }: { d: MonthAnalytics }) {
  const rows = useMemo(() => {
    const by = new Map(d.daily.map((r) => [r.day, r]));
    const out = [];
    let cum = 0;
    let cumJobs = 0;
    const start = new Date(d.start + "T00:00:00");
    for (let i = 0; i < d.days; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      cum += by.get(key)?.hours ?? 0;
      cumJobs += by.get(key)?.jobs ?? 0;
      out.push({ label: String(day.getDate()), day: key, hours: Math.round(cum * 10) / 10, jobs: cumJobs });
    }
    return out;
  }, [d]);
  if (!d.summary.blockEvents) return <Empty text="No blocks in this month" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ops-accent)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--ops-accent)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={AXIS} interval={2} />
        <YAxis yAxisId="l" tickLine={false} axisLine={false} width={40} />
        <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} width={34} allowDecimals={false} />
        <Tooltip content={<Tip labelText={(l, p) => String((p[0]?.payload as { day?: string })?.day ?? l)} />} />
        <Legend iconType="circle" iconSize={8} />
        <Area yAxisId="l" type="monotone" dataKey="hours" name="Possession h (cumulative)" stroke="var(--ops-accent)" fill="url(#cumFill)" strokeWidth={1.8} />
        <Line yAxisId="r" type="monotone" dataKey="jobs" name="Jobs (cumulative)" stroke={WARN} strokeWidth={1.4} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------- departments / bundling

export function DepartmentChart({ d }: { d: MonthAnalytics }) {
  const rows = Object.entries(d.departments)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dept, v]) => ({ dept, ...v }));
  if (!rows.length) return <Empty text="No department activity" />;
  const total = rows.reduce((t, r) => t + r.hours, 0);
  return (
    <div className="h-full grid grid-cols-5">
      <div className="col-span-2 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="hours" nameKey="dept" innerRadius="58%" outerRadius="86%" paddingAngle={2} stroke="var(--ops-panel)" strokeWidth={2}>
              {rows.map((r) => (
                <Cell key={r.dept} fill={DEPT_COLOR[r.dept] ?? MUTED} />
              ))}
            </Pie>
            <Tooltip content={<Tip unit="h" />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-lg font-semibold mono text-ops-text leading-none">{total.toFixed(0)}</p>
          <p className="text-[10px] text-ops-muted">hours</p>
        </div>
      </div>
      <div className="col-span-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="dept" tickLine={false} axisLine={AXIS} />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip content={<Tip />} cursor={{ fill: "var(--ops-hover)" }} />
            <Legend iconType="circle" iconSize={8} />
            <Bar dataKey="jobs" name="Placed" radius={[3, 3, 0, 0]}>
              {rows.map((r) => (
                <Cell key={r.dept} fill={DEPT_COLOR[r.dept] ?? MUTED} />
              ))}
            </Bar>
            <Bar dataKey="open" name="Open" fill={WARN} radius={[3, 3, 0, 0]} />
            <Bar dataKey="overdue" name="Overdue" fill={BAD} radius={[3, 3, 0, 0]} />
            <Bar dataKey="rescheduled" name="Rescheduled" fill="#60a5fa" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function BundlingChart({ d }: { d: MonthAnalytics }) {
  const s = d.summary;
  if (!s.blockEvents) return <Empty text="No blocks" />;
  const kinds = [
    { name: "Single job", value: s.blockEvents - s.jointBlocks, color: MUTED },
    { name: "Shared, same dept", value: s.jointBlocks - s.multiDeptBlocks, color: "#22d3ee" },
    { name: "Joint, multi-dept", value: s.multiDeptBlocks, color: "var(--ops-accent)" },
  ].filter((k) => k.value > 0);
  const hours = [
    { name: "Job-hours (unbundled)", hours: s.jobHours, color: MUTED },
    { name: "Possession (actual)", hours: s.possessionHours, color: "var(--ops-accent)" },
  ];
  return (
    <div className="h-full grid grid-cols-5">
      <div className="col-span-3 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={kinds} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="86%" paddingAngle={2} stroke="var(--ops-panel)" strokeWidth={2}>
              {kinds.map((k) => (
                <Cell key={k.name} fill={k.color} />
              ))}
            </Pie>
            <Tooltip content={<Tip unit="blocks" />} />
            <Legend iconType="circle" iconSize={8} verticalAlign="bottom" />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none -mt-4">
          <p className="text-lg font-semibold mono text-ops-text leading-none">{s.blockEvents}</p>
          <p className="text-[10px] text-ops-muted">block events</p>
        </div>
      </div>
      <div className="col-span-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={hours} margin={{ top: 18, right: 8, left: -16, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={AXIS} tick={{ fontSize: 9 }} interval={0} />
            <YAxis tickLine={false} axisLine={false} />
            <Tooltip content={<Tip unit="h" />} cursor={{ fill: "var(--ops-hover)" }} />
            <Bar dataKey="hours" name="Hours" radius={[3, 3, 0, 0]} label={{ position: "top", fill: "var(--ops-muted)", fontSize: 10, formatter: (v: unknown) => `${Number(v).toFixed(0)} h` }}>
              {hours.map((h) => (
                <Cell key={h.name} fill={h.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- backlog

export function BacklogChart({ d }: { d: MonthAnalytics }) {
  const status = STATUS.filter((s) => d.statusCounts[s.key]).map((s) => ({ ...s, value: d.statusCounts[s.key] }));
  const sev = (["A", "B", "C"] as const).filter((k) => d.severityCounts[k]).map((k) => ({ name: `Sev ${k}`, value: d.severityCounts[k], color: SEV_COLOR[k] }));
  if (!status.length) return <Empty text="No requests in this month" />;
  return (
    <div className="h-full grid grid-cols-5">
      <div className="col-span-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={status} layout="vertical" margin={{ top: 4, right: 36, left: 8, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={104} />
            <Tooltip content={<Tip unit="requests" />} cursor={{ fill: "var(--ops-hover)" }} />
            <Bar dataKey="value" name="Requests" radius={[0, 3, 3, 0]} label={{ position: "right", fill: "var(--ops-muted)", fontSize: 10 }}>
              {status.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="col-span-2 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={sev} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="86%" paddingAngle={2} stroke="var(--ops-panel)" strokeWidth={2}>
              {sev.map((s) => (
                <Cell key={s.name} fill={s.color} />
              ))}
            </Pie>
            <Tooltip content={<Tip unit="requests" />} />
            <Legend iconType="circle" iconSize={8} verticalAlign="bottom" />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none -mt-4">
          <p className="text-lg font-semibold mono text-ops-text leading-none">{d.summary.backlogTotal}</p>
          <p className="text-[10px] text-ops-muted">requests</p>
        </div>
      </div>
    </div>
  );
}

export function LeadTimeChart({ d }: { d: MonthAnalytics }) {
  const rows = useMemo(() => {
    const v = d.latenessDays;
    if (!v.length) return [];
    const lo = Math.min(...v, -1);
    const hi = Math.max(...v, 1);
    const bins: { x: number; onTime: number; late: number }[] = [];
    for (let x = lo; x <= hi; x++) bins.push({ x, onTime: 0, late: 0 });
    for (const n of v) {
      const b = bins[n - lo];
      if (n <= 0) b.onTime++;
      else b.late++;
    }
    return bins;
  }, [d]);
  if (!rows.length) return <Empty text="No placed jobs with a due date" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 12, left: -16, bottom: 0 }} barCategoryGap={1}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="x" tickLine={false} axisLine={AXIS} tickFormatter={(v) => (v > 0 ? `+${v}` : String(v))} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip content={<Tip unit="jobs" labelText={(l) => `${Number(l) > 0 ? `${l} days after` : `${Math.abs(Number(l))} days before`} due`} />} cursor={{ fill: "var(--ops-hover)" }} />
        <Legend iconType="circle" iconSize={8} />
        <ReferenceLine x={0} stroke="var(--ops-text)" strokeDasharray="3 3" />
        <Bar dataKey="onTime" name="On / before due" stackId="a" fill={GOOD} />
        <Bar dataKey="late" name="After due" stackId="a" fill={BAD} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PriorityChart({ d }: { d: MonthAnalytics }) {
  const { rows, mean } = useMemo(() => {
    const v = d.priorityScores;
    const bins = Array.from({ length: 20 }, (_, i) => ({ from: i * 5, label: `${i * 5}`, n: 0 }));
    for (const s of v) bins[Math.min(19, Math.floor(s / 5))].n++;
    return { rows: bins, mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0 };
  }, [d]);
  if (!d.priorityScores.length) return <Empty text="No priority scores" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 14, right: 12, left: -16, bottom: 0 }} barCategoryGap={1}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={AXIS} interval={3} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip content={<Tip unit="requests" labelText={(l) => `score ${l}–${Number(l) + 5}`} />} cursor={{ fill: "var(--ops-hover)" }} />
        <ReferenceLine x="90" stroke={BAD} strokeDasharray="4 3" label={{ value: "safety floor", position: "insideTopLeft", fill: BAD, fontSize: 10 }} />
        <ReferenceLine x={String(Math.floor(mean / 5) * 5)} stroke={WARN} label={{ value: `mean ${mean.toFixed(0)}`, position: "insideTopRight", fill: WARN, fontSize: 10 }} />
        <Bar dataKey="n" name="Requests" radius={[3, 3, 0, 0]}>
          {rows.map((r) => (
            <Cell key={r.from} fill={r.from >= 90 ? BAD : "var(--ops-accent)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------- zones / corridors / work types

export function ZonesChart({ d, onPick }: { d: MonthAnalytics; onPick: (zone: string) => void }) {
  const rows = d.zones.filter((z) => z.blockEvents || z.openRequests).map((z) => ({ ...z, availability: z.blockEvents ? z.availabilityPctAffected : null }));
  if (!rows.length) return <Empty text="No zone activity" />;
  const minAvail = Math.min(...rows.map((r) => r.availability ?? 100));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} barCategoryGap="22%" onClick={(e) => e && e.activeLabel && onPick(String(e.activeLabel))}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="zone" tickLine={false} axisLine={AXIS} />
        <YAxis yAxisId="l" tickLine={false} axisLine={false} width={40} />
        <YAxis yAxisId="r" orientation="right" domain={[Math.floor(minAvail - 0.5), 100]} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v}%`} />
        <Tooltip content={<Tip />} cursor={{ fill: "var(--ops-hover)" }} />
        <Legend iconType="circle" iconSize={8} />
        <Bar yAxisId="l" dataKey="possessionHours" name="Possession h" fill="var(--ops-accent)" radius={[3, 3, 0, 0]} className="cursor-pointer" />
        <Bar yAxisId="l" dataKey="openRequests" name="Open" fill={WARN} radius={[3, 3, 0, 0]} className="cursor-pointer" />
        <Bar yAxisId="l" dataKey="overdueRequests" name="Overdue" fill={BAD} radius={[3, 3, 0, 0]} className="cursor-pointer" />
        <Line yAxisId="r" type="monotone" dataKey="availability" name="Availability (affected) %" stroke={GOOD} strokeWidth={1.6} dot={{ r: 3 }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function TopCorridorsChart({ d }: { d: MonthAnalytics }) {
  const rows = d.corridors.filter((c) => c.blockEvents).slice(0, 12).map((c) => ({ ...c, name: c.corridorId }));
  if (!rows.length) return <Empty text="No corridors under possession" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 24, bottom: 0 }} barCategoryGap="26%">
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} unit=" h" />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={110} tick={{ fontSize: 10 }} />
        <Tooltip
          content={<Tip unit="h" labelText={(l, p) => { const r = p[0]?.payload as { zone?: string; blockEvents?: number; jobs?: number; availabilityPct?: number } | undefined; return `${l} · ${r?.zone} · ${r?.blockEvents} blocks · ${r?.jobs} jobs · ${r?.availabilityPct?.toFixed(2)}% available`; }} />}
          cursor={{ fill: "var(--ops-hover)" }}
        />
        <Legend iconType="circle" iconSize={8} />
        <Bar dataKey="possessionHours" name="Possession" stackId="a" fill="var(--ops-accent)" />
        <Bar dataKey="hoursSaved" name="Saved by bundling" stackId="a" fill={GOOD} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function WorkTypesChart({ d }: { d: MonthAnalytics }) {
  const rows = d.workTypes.map((w) => ({ ...w, name: w.defectType.replace(/_/g, " ") }));
  if (!rows.length) return <Empty text="No work types" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 24, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={130} tick={{ fontSize: 10 }} />
        <Tooltip content={<Tip labelText={(l, p) => `${l} · ${(p[0]?.payload as { department?: string })?.department}`} />} cursor={{ fill: "var(--ops-hover)" }} />
        <Legend iconType="circle" iconSize={8} />
        <Bar dataKey="jobs" name="Placed" radius={[0, 3, 3, 0]}>
          {rows.map((r) => (
            <Cell key={r.defectType} fill={DEPT_COLOR[r.department] ?? MUTED} />
          ))}
        </Bar>
        <Bar dataKey="open" name="Open" fill={WARN} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
