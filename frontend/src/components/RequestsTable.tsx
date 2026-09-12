import { IST_TZ } from "../lib/dates";
import { useMemo, useState } from "react";
import type { DefectRequest } from "../types/api";
import { DISPLAY_COLOR, DISPLAY_LABEL, DISPLAY_ORDER, displayStatus, isRescheduled, shortId, type DisplayStatus } from "../lib/requestStatus";

const SEV_COLOR: Record<string, string> = { A: "text-red-400", B: "text-amber-400", C: "text-emerald-400" };

function fmtBlock(r: DefectRequest): string {
  if (!r.allocatedStart || !r.allocatedEnd) return "—";
  const s = new Date(r.allocatedStart);
  const e = new Date(r.allocatedEnd);
  return `${s.toLocaleDateString(undefined, { timeZone: IST_TZ, month: "short", day: "numeric" })} ${s.toLocaleTimeString([], { timeZone: IST_TZ, hour: "2-digit", minute: "2-digit" })}–${e.toLocaleTimeString([], { timeZone: IST_TZ, hour: "2-digit", minute: "2-digit" })}`;
}

export function RequestsTable({
  requests,
  showDepartment,
  showZone,
  onSelect,
}: {
  requests: DefectRequest[];
  showDepartment?: boolean;
  showZone?: boolean;
  onSelect?: (r: DefectRequest) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<DisplayStatus | "">("");
  const [severity, setSeverity] = useState("");
  const [dept, setDept] = useState("");
  const [zone, setZone] = useState("");

  const zones = useMemo(() => [...new Set(requests.map((r) => r.zone).filter((z): z is string => !!z))].sort(), [requests]);
  const depts = useMemo(() => [...new Set(requests.map((r) => r.department))].sort(), [requests]);
  const counts = useMemo(() => {
    const c: Partial<Record<DisplayStatus, number>> = {};
    for (const r of requests) {
      const s = displayStatus(r);
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [requests]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter((r) => {
      if (status && displayStatus(r) !== status) return false;
      if (severity && r.severityCode !== severity) return false;
      if (dept && r.department !== dept) return false;
      if (zone && r.zone !== zone) return false;
      if (q) {
        const hay = [r.corridorId, r.assetId, r.defectType.replace(/_/g, " "), r.defectId, r.requestedBy, r.planPeriodLabel, r.zone].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [requests, query, status, severity, dept, zone]);

  const colCount = 11 + (showDepartment ? 1 : 0) + (showZone ? 1 : 0);
  const anyFilter = query || status || severity || dept || zone;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search corridor, asset, defect type, id, plan…"
          className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1 w-72"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as DisplayStatus | "")} className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
          <option value="">All statuses ({requests.length})</option>
          {DISPLAY_ORDER.filter((s) => counts[s]).map((s) => (
            <option key={s} value={s}>
              {DISPLAY_LABEL[s]} ({counts[s]})
            </option>
          ))}
        </select>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
          <option value="">Any severity</option>
          <option value="A">A — safety-critical</option>
          <option value="B">B — major</option>
          <option value="C">C — routine</option>
        </select>
        {showDepartment && (
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
            <option value="">All departments</option>
            {depts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
        {showZone && (
          <select value={zone} onChange={(e) => setZone(e.target.value)} className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
            <option value="">All zones</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        )}
        {anyFilter && (
          <button
            onClick={() => {
              setQuery("");
              setStatus("");
              setSeverity("");
              setDept("");
              setZone("");
            }}
            className="text-ops-accent underline"
          >
            clear
          </button>
        )}
        <span className="text-ops-muted ml-auto">
          {filtered.length} of {requests.length}
        </span>
      </div>

      <div className="border border-ops-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-ops-inset text-ops-muted uppercase text-[10px]">
            <tr>
              <th className="text-left p-2">ID</th>
              <th className="text-left p-2">Corridor</th>
              {showZone && <th className="text-left p-2">Zone</th>}
              {showDepartment && <th className="text-left p-2">Dept</th>}
              <th className="text-left p-2">Defect</th>
              <th className="text-left p-2">Sev</th>
              <th className="text-left p-2">Score</th>
              <th className="text-left p-2">Due</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Block</th>
              <th className="text-left p-2">Plan</th>
              <th className="text-left p-2">Deferred</th>
              <th className="text-left p-2">Last event</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ops-border">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={colCount} className="p-4 text-center text-ops-muted">
                  {requests.length === 0 ? "No requests." : "Nothing matches these filters."}
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const ds = displayStatus(r);
              return (
                <tr key={r.defectId} onClick={() => onSelect?.(r)} className={onSelect ? "cursor-pointer hover:bg-ops-hover" : ""}>
                  <td className="p-2 text-ops-muted mono" title={r.defectId}>{shortId(r.defectId)}</td>
                  <td className="p-2 text-ops-text mono">{r.corridorId}</td>
                  {showZone && <td className="p-2 text-ops-muted mono">{r.zone ?? "—"}</td>}
                  {showDepartment && <td className="p-2 text-ops-text">{r.department}</td>}
                  <td className="p-2 text-ops-text">{r.defectType.replace(/_/g, " ")}</td>
                  <td className={`p-2 font-semibold ${SEV_COLOR[r.severityCode]}`}>{r.severityCode}</td>
                  <td className="p-2 text-ops-text mono">{r.priorityScore?.toFixed(1) ?? "—"}</td>
                  <td className={`p-2 mono ${r.isOverdue ? "text-red-400" : "text-ops-muted"}`}>{r.dueDate}</td>
                  <td className={`p-2 ${DISPLAY_COLOR[ds]}`}>
                    {DISPLAY_LABEL[ds]}
                    {isRescheduled(r) && (
                      <span className="ml-2 text-[10px] font-semibold uppercase text-blue-400 border border-blue-400/40 px-1 py-px" title={r.lastEventDetails ?? undefined}>
                        Rescheduled
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-ops-muted mono whitespace-nowrap">{fmtBlock(r)}</td>
                  <td className="p-2 text-ops-muted mono">{r.planPeriodLabel ?? "—"}</td>
                  <td className="p-2 text-ops-muted">{r.deferCount > 0 ? r.deferCount : ""}</td>
                  <td className="p-2 text-ops-muted whitespace-nowrap" title={r.lastEventDetails ?? undefined}>
                    {r.lastEventAt ? `${(r.lastEventType ?? "").replace(/_/g, " ")} · ${new Date(r.lastEventAt).toLocaleDateString(undefined, { timeZone: IST_TZ, month: "short", day: "numeric" })}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
