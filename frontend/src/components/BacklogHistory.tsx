import { useEffect, useMemo, useState } from "react";
import { api, qs } from "../lib/api";
import { EVENT_LABEL } from "../lib/requestStatus";
import type { DefectEvent } from "../types/api";

const SEV_COLOR: Record<string, string> = { A: "text-red-400", B: "text-amber-400", C: "text-emerald-400" };
const EVENT_TONE: Record<string, string> = {
  scheduled: "text-emerald-400",
  plan_scheduled: "text-emerald-400",
  completed: "text-emerald-400",
  reschedule_accepted: "text-blue-400",
  reschedule_offered: "text-blue-400",
  preemption_requested: "text-blue-400",
  reschedule_rejected: "text-amber-400",
  modification_rejected: "text-red-400",
  bumped: "text-red-400",
  released: "text-amber-400",
  lapsed: "text-amber-400",
  cleared: "text-ops-muted",
};

export function BacklogHistory({ scope, department }: { scope: "own" | "all"; department?: string }) {
  const [events, setEvents] = useState<DefectEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState("");
  const [dept, setDept] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<DefectEvent[]>(`/api/v1/requests/events${qs({ limit: 2000 })}`)
      .then((e) => !cancelled && setEvents(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const types = useMemo(() => [...new Set(events.map((e) => e.eventType))].sort(), [events]);
  const depts = useMemo(() => [...new Set(events.map((e) => e.department))].sort(), [events]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (type && e.eventType !== type) return false;
      if (dept && e.department !== dept) return false;
      if (q && ![e.corridorId, e.defectType.replace(/_/g, " "), e.details, e.actor, e.zone, e.defectId].filter(Boolean).join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [events, type, dept, query]);

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ops-muted">
        {scope === "all" ? "Every status change of every request, newest first" : `Every status change of ${department ?? "your department"}'s requests, newest first`} — submissions,
        placements, offers and responses, bumps, lapses, completions.
      </p>
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search corridor, type, details, who…" className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1 w-72" />
        <select value={type} onChange={(e) => setType(e.target.value)} className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
          <option value="">All events</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {EVENT_LABEL[t] ?? t}
            </option>
          ))}
        </select>
        {scope === "all" && (
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
            <option value="">All departments</option>
            {depts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
        <span className="text-ops-muted ml-auto">
          {visible.length} of {events.length}
        </span>
      </div>
      <div className="border border-ops-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-ops-inset text-ops-muted uppercase text-[10px]">
            <tr>
              <th className="text-left p-2">When</th>
              <th className="text-left p-2">Event</th>
              {scope === "all" && <th className="text-left p-2">Dept</th>}
              <th className="text-left p-2">Corridor</th>
              <th className="text-left p-2">Defect</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">By</th>
              <th className="text-left p-2">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ops-border">
            {loading && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-ops-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-ops-muted">
                  {events.length === 0 ? "No backlog events recorded yet." : "Nothing matches these filters."}
                </td>
              </tr>
            )}
            {visible.map((e) => (
              <tr key={e.eventId}>
                <td className="p-2 text-ops-muted mono whitespace-nowrap">{new Date(e.occurredAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                <td className={`p-2 font-medium whitespace-nowrap ${EVENT_TONE[e.eventType] ?? "text-ops-text"}`}>{EVENT_LABEL[e.eventType] ?? e.eventType.replace(/_/g, " ")}</td>
                {scope === "all" && <td className="p-2 text-ops-text">{e.department}</td>}
                <td className="p-2 text-ops-text mono">{e.corridorId ?? "—"}</td>
                <td className="p-2 text-ops-text">
                  {e.defectType.replace(/_/g, " ")} <span className={`font-semibold ${SEV_COLOR[e.severityCode]}`}>{e.severityCode}</span>
                </td>
                <td className="p-2 text-ops-muted mono whitespace-nowrap">
                  {e.fromStatus ?? "—"} → {e.toStatus ?? "—"}
                </td>
                <td className="p-2 text-ops-muted">{e.actor ?? "—"}</td>
                <td className="p-2 text-ops-muted">{e.details ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
