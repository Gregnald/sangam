import { useEffect, useState } from "react";
import { CorridorPicker } from "./CorridorPicker";
import { LearnedCompatibility } from "./LearnedCompatibility";
import { WorkTypeMatrix } from "./WorkTypeMatrix";
import { api, qs } from "../lib/api";
import { todayIso, IST_TZ } from "../lib/dates";
import type { CompatibilityOverrideEntry, CorridorBlockWindow, CorridorSchedule } from "../types/api";

interface WorkTypeStats {
  total: number;
  joint: number;
  separate: number;
  overrides: number;
}

function StatCard({ label, value, sub, color }: { label: string; value: number; sub: string; color?: string }) {
  return (
    <div className="flex-1 border border-ops-border bg-ops-panel px-4 py-3 min-w-[140px]">
      <p className="text-[10px] uppercase tracking-widest text-ops-muted mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${color ?? "text-ops-text"}`}>{value}</p>
      <p className="text-[11px] text-ops-muted mt-0.5">{sub}</p>
    </div>
  );
}

const LEGEND_ITEMS = [
  {
    swatch: "bg-emerald-500/70 border border-emerald-600",
    label: "May share a possession",
    desc: "Can be planned in the same block (subject to other constraints)",
  },
  {
    swatch: "bg-red-500/60 border border-red-600",
    label: "Separate blocks",
    desc: "Cannot be planned together in the same block",
  },
  {
    swatch: "bg-ops-inset border border-ops-border",
    label: "Same department (always)",
    desc: "Handled within the same department — not applicable",
  },
  {
    swatch: "bg-ops-inset border border-ops-accent",
    label: "Edited by a controller",
    desc: "Manually overridden rule",
  },
];

const DEPT_META: Record<string, { color: string; label: string; desc: string }> = {
  ENGG: { color: "#2563eb", label: "Engineering", desc: "Track, rail, weld, ballast, geometry" },
  SIGNAL: { color: "#9333ea", label: "Signal & Telecommunication", desc: "Signals, interlocking, cables, track circuits" },
  TRD: { color: "#ea580c", label: "Traction & Power Supply", desc: "OHE, feeders, insulators, transformers" },
};

export function BlockCompatibilityEditor({ zone }: { zone: string | null }) {
  const [corridorId, setCorridorId] = useState<string | null>(null);
  const [date, setDate] = useState<string>(todayIso());
  const [windows, setWindows] = useState<CorridorBlockWindow[]>([]);
  const [windowId, setWindowId] = useState<string | null>(null);
  const [entries, setEntries] = useState<CompatibilityOverrideEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [learnedKey, setLearnedKey] = useState(0);
  const [stats, setStats] = useState<WorkTypeStats | null>(null);
  const [deptTypes, setDeptTypes] = useState<Record<string, string[]>>({});

  useEffect(() => {
    api.get<{ workTypes: { type: string; department: string }[]; cells: { type_a: string; type_b: string; compatible: boolean; updated_by: string | null }[] }>("/api/v1/compatibility/work-types").then((d) => {
      const crossDept = d.cells.filter((c) => {
        const dA = d.workTypes.find((t) => t.type === c.type_a)?.department;
        const dB = d.workTypes.find((t) => t.type === c.type_b)?.department;
        return dA && dB && dA !== dB;
      });
      setStats({
        total: crossDept.length,
        joint: crossDept.filter((c) => c.compatible).length,
        separate: crossDept.filter((c) => !c.compatible).length,
        overrides: crossDept.filter((c) => c.updated_by && c.updated_by !== "seed").length,
      });
      const grouped: Record<string, string[]> = {};
      for (const wt of d.workTypes) {
        if (!grouped[wt.department]) grouped[wt.department] = [];
        grouped[wt.department].push(wt.type.replace(/_/g, " "));
      }
      setDeptTypes(grouped);
    });
  }, [learnedKey]);

  useEffect(() => {
    setWindowId(null);
    setWindows([]);
    if (!corridorId || !date) return;
    api.get<CorridorSchedule>(`/api/v1/corridors/${corridorId}/schedule${qs({ start: date, end: date })}`).then((d) => setWindows(d.windows));
  }, [corridorId, date]);

  useEffect(() => {
    setEntries([]);
    if (!windowId) return;
    api.get<CompatibilityOverrideEntry[]>(`/api/v1/compatibility/overrides${qs({ windowId })}`).then(setEntries);
  }, [windowId]);

  async function refresh() {
    if (!windowId) return;
    setEntries(await api.get<CompatibilityOverrideEntry[]>(`/api/v1/compatibility/overrides${qs({ windowId })}`));
  }

  async function toggle(entry: CompatibilityOverrideEntry) {
    if (!windowId) return;
    const key = `${entry.deptA}-${entry.deptB}`;
    setBusy(key);
    try {
      await api.post("/api/v1/compatibility/overrides", { windowId, deptA: entry.deptA, deptB: entry.deptB, compatible: !entry.compatible });
      await refresh();
      setLearnedKey((k) => k + 1);
    } finally {
      setBusy(null);
    }
  }

  async function resetToDefault(entry: CompatibilityOverrideEntry) {
    if (!windowId) return;
    const key = `${entry.deptA}-${entry.deptB}`;
    setBusy(key);
    try {
      await api.del("/api/v1/compatibility/overrides", { windowId, deptA: entry.deptA, deptB: entry.deptB });
      await refresh();
      setLearnedKey((k) => k + 1);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── stats row ── */}
      {stats && (
        <div className="flex gap-3 flex-wrap">
          <StatCard label="Work-type pairs" value={stats.total} sub="across 3 departments" />
          <StatCard label="Joint allowed" value={stats.joint} sub="pairs may share a possession" color="text-emerald-400" />
          <StatCard label="Separate only" value={stats.separate} sub="require dedicated blocks" color="text-red-400" />
          <StatCard label="Controller overrides" value={stats.overrides} sub="manually edited rules" color="text-ops-accent" />
        </div>
      )}

      {/* ── matrix + sidebar ── */}
      <div className="flex gap-4 items-start flex-wrap lg:flex-nowrap">
        {/* left: matrix */}
        <div className="flex-1 min-w-0">
          <WorkTypeMatrix />
        </div>

        {/* right: legend + dept types */}
        <div className="flex flex-col gap-3 w-64 shrink-0">
          {/* Legend */}
          <div className="border border-ops-border bg-ops-panel">
            <div className="px-3 py-2 border-b border-ops-border">
              <p className="text-xs font-semibold text-ops-text">Legend</p>
              <p className="text-[11px] text-ops-muted">Matrix cell colour reference</p>
            </div>
            <div className="p-3 space-y-3">
              {LEGEND_ITEMS.map((item) => (
                <div key={item.label} className="flex items-start gap-2.5">
                  <span className={`w-4 h-4 shrink-0 mt-0.5 ${item.swatch}`} />
                  <div>
                    <p className="text-[11px] font-medium text-ops-text leading-tight">{item.label}</p>
                    <p className="text-[10px] text-ops-muted leading-snug mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Department work types */}
          <div className="border border-ops-border bg-ops-panel">
            <div className="px-3 py-2 border-b border-ops-border">
              <p className="text-xs font-semibold text-ops-text">Department work types</p>
              <p className="text-[11px] text-ops-muted">Colour coding for quick reference</p>
            </div>
            <div className="p-3 space-y-3">
              {Object.entries(DEPT_META).map(([dept, meta]) => (
                <div key={dept} className="flex items-start gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style={{ backgroundColor: meta.color }} />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-ops-text leading-tight">{meta.label}</p>
                    <p className="text-[10px] text-ops-muted leading-snug mt-0.5">{meta.desc}</p>
                    {deptTypes[dept] && (
                      <p className="text-[10px] text-ops-muted/70 mt-1 leading-snug">
                        {deptTypes[dept].slice(0, 4).join(", ")}{deptTypes[dept].length > 4 ? ` +${deptTypes[dept].length - 4} more` : ""}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <LearnedCompatibility refreshKey={learnedKey} />

      {/* ── block overrides ── */}
      <h3 className="text-xs font-semibold text-ops-text pt-1">Block overrides</h3>
      <div className="flex items-center gap-3">
        <CorridorPicker zone={zone} value={corridorId} onChange={setCorridorId} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="text-xs bg-ops-inset border border-ops-border text-ops-text px-2 py-1" />
      </div>
      {corridorId && (
        <select value={windowId ?? ""} onChange={(e) => setWindowId(e.target.value || null)} className="text-xs bg-ops-inset border border-ops-border text-ops-text px-2 py-1 w-full max-w-lg">
          <option value="">{windows.length === 0 ? "No block windows on this day" : "Select a block…"}</option>
          {windows.map((w) => (
            <option key={w.windowId} value={w.windowId}>
              {new Date(w.windowStart).toLocaleTimeString([], { timeZone: IST_TZ, hour: "2-digit", minute: "2-digit" })} – {new Date(w.windowEnd).toLocaleTimeString([], { timeZone: IST_TZ, hour: "2-digit", minute: "2-digit" })} (max {w.maxConcurrentDepts} depts)
            </option>
          ))}
        </select>
      )}
      {windowId && (
        <table className="border border-ops-border text-xs w-full max-w-lg">
          <thead>
            <tr className="bg-ops-inset text-ops-muted uppercase text-[10px]">
              <th className="p-2 text-left">Pair</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ops-border">
            {entries.map((e) => {
              const key = `${e.deptA}-${e.deptB}`;
              return (
                <tr key={key}>
                  <td className="p-2 text-ops-text">
                    {e.deptA} ↔ {e.deptB}
                  </td>
                  <td className="p-2">
                    <button onClick={() => toggle(e)} disabled={busy === key} className={`px-2 py-1 text-[11px] text-white ${e.compatible ? "bg-emerald-600" : "bg-red-900"}`}>
                      {e.compatible ? "Compatible" : "Incompatible"}
                    </button>
                    {e.isOverride && <span className="ml-2 text-[10px] text-amber-400">block-specific override</span>}
                  </td>
                  <td className="p-2">
                    {e.isOverride && (
                      <button onClick={() => resetToDefault(e)} disabled={busy === key} className="text-[10px] text-ops-muted underline">
                        Reset to default
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
