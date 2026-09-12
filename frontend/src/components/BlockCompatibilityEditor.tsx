import { useEffect, useState } from "react";
import { CorridorPicker } from "./CorridorPicker";
import { LearnedCompatibility } from "./LearnedCompatibility";
import { WorkTypeMatrix } from "./WorkTypeMatrix";
import { api, qs } from "../lib/api";
import { todayIso } from "../lib/dates";
import type { CompatibilityOverrideEntry, CorridorBlockWindow, CorridorSchedule } from "../types/api";

export function BlockCompatibilityEditor({ zone }: { zone: string | null }) {
  const [corridorId, setCorridorId] = useState<string | null>(null);
  const [date, setDate] = useState<string>(todayIso());
  const [windows, setWindows] = useState<CorridorBlockWindow[]>([]);
  const [windowId, setWindowId] = useState<string | null>(null);
  const [entries, setEntries] = useState<CompatibilityOverrideEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [learnedKey, setLearnedKey] = useState(0);

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
    <div className="space-y-3">
      <WorkTypeMatrix />
      <LearnedCompatibility refreshKey={learnedKey} />
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
              {new Date(w.windowStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – {new Date(w.windowEnd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (max {w.maxConcurrentDepts} depts)
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
