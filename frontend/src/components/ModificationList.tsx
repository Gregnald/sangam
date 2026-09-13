import { useMemo, useState } from "react";
import { CorridorGantt } from "./CorridorGantt";
import { fmtDate, mondayOf, IST_TZ } from "../lib/dates";
import type { ModificationRequest, ModificationType } from "../types/api";

const TYPE_LABEL: Record<string, string> = { reschedule: "Reschedule offer", preemption: "Priority bump request" };

function DiffLine({ m }: { m: ModificationRequest }) {
  if (m.requestType === "preemption") {
    return (
      <p className="text-[11px] text-amber-300 mb-2">
        New request wants this window — currently held by {m.affectedDepartment}'s block. Approving returns that block to the backlog and schedules this one in its place.
      </p>
    );
  }
  if (m.originalWindowStart && m.proposedWindowStart) {
    return (
      <p className="text-[11px] text-amber-300 mb-2">
        Originally requested: {new Date(m.originalWindowStart).toLocaleString(undefined, { timeZone: IST_TZ })}
        {m.originalWindowEnd ? ` – ${new Date(m.originalWindowEnd).toLocaleTimeString([], { timeZone: IST_TZ, hour: "2-digit", minute: "2-digit" })}` : ""} → Proposed instead:{" "}
        {new Date(m.proposedWindowStart).toLocaleString(undefined, { timeZone: IST_TZ })}
        {m.proposedWindowEnd ? ` – ${new Date(m.proposedWindowEnd).toLocaleTimeString([], { timeZone: IST_TZ, hour: "2-digit", minute: "2-digit" })}` : ""}
      </p>
    );
  }
  return null;
}

export function ModificationList({
  items,
  mode,
  onDeptRespond,
  onControllerDecide,
}: {
  items: ModificationRequest[];
  mode: "dept" | "controller";
  onDeptRespond?: (requestId: string, accept: boolean) => Promise<void>;
  onControllerDecide?: (requestId: string, approve: boolean, reason?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"" | ModificationType>("");
  const [status, setStatus] = useState("");
  const [dept, setDept] = useState("");

  const depts = useMemo(() => [...new Set(items.map((m) => m.requestingDepartment))].sort(), [items]);
  const statuses = useMemo(() => [...new Set(items.map((m) => m.status))].sort(), [items]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((m) => {
      if (type && m.requestType !== type) return false;
      if (status && m.status !== status) return false;
      if (dept && m.requestingDepartment !== dept) return false;
      if (q) {
        const hay = [m.proposedCorridorId, m.requestingDepartment, m.affectedDepartment, m.defectType?.replace(/_/g, " "), m.description, m.defectId, m.requestId, m.decidedBy, m.decisionReason]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, query, type, status, dept]);

  if (items.length === 0) {
    return <p className="text-xs text-ops-muted p-4 border border-ops-border">Nothing here right now.</p>;
  }
  const anyFilter = query || type || status || dept;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search corridor, type, description, id…" className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1 w-72" />
        <select value={type} onChange={(e) => setType(e.target.value as "" | ModificationType)} className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
          <option value="">All types</option>
          <option value="reschedule">Reschedule offers</option>
          <option value="preemption">Priority bumps</option>
        </select>
        {statuses.length > 1 && (
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        )}
        {depts.length > 1 && (
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
            <option value="">All departments</option>
            {depts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
        {anyFilter && (
          <button
            onClick={() => {
              setQuery("");
              setType("");
              setStatus("");
              setDept("");
            }}
            className="text-ops-accent underline"
          >
            clear
          </button>
        )}
        <span className="text-ops-muted ml-auto">
          {filtered.length} of {items.length}
        </span>
      </div>
      {filtered.length === 0 && <p className="text-xs text-ops-muted p-4 border border-ops-border">Nothing matches these filters.</p>}
      {filtered.map((m) => {
        const canExpand = Boolean(m.proposedCorridorId && m.proposedWindowStart);
        const isOpen = expanded === m.requestId;
        const weekStart = m.proposedWindowStart ? mondayOf(new Date(m.proposedWindowStart)) : null;
        const weekEnd = weekStart ? new Date(weekStart.getTime() + 6 * 86400000) : null;
        return (
        <div key={m.requestId} className="border border-ops-border p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-ops-text">{TYPE_LABEL[m.requestType]}</span>
            <span className="text-[10px] text-ops-muted">{new Date(m.createdAt).toLocaleString(undefined, { timeZone: IST_TZ })}</span>
          </div>
          <p className="text-xs text-ops-muted mb-2">{m.description}</p>
          <div className="text-[11px] text-ops-muted mb-2">
            {m.requestingDepartment} · {m.proposedCorridorId}
            {m.proposedWindowStart && <> · {new Date(m.proposedWindowStart).toLocaleString(undefined, { timeZone: IST_TZ })}</>}
            {canExpand && (
              <button onClick={() => setExpanded(isOpen ? null : m.requestId)} className="ml-2 text-ops-accent underline">
                {isOpen ? "hide schedule" : "view schedule"}
              </button>
            )}
          </div>
          {isOpen && canExpand && (
            <div className="mb-2">
              <DiffLine m={m} />
              <CorridorGantt
                corridorId={m.proposedCorridorId!}
                rangeStart={fmtDate(weekStart!)}
                rangeEnd={fmtDate(weekEnd!)}
                highlightWindowStart={m.proposedWindowStart}
                highlightWindowEnd={m.proposedWindowEnd}
                highlightLabel={
                  m.requestType === "preemption"
                    ? `Slot to be freed for ${m.requestingDepartment} (currently ${m.affectedDepartment ?? "another dept"}'s block)`
                    : `Offered alternate slot for ${m.requestingDepartment} ${(m.defectType ?? "").replace(/_/g, " ")}`
                }
              />
            </div>
          )}

          {mode === "dept" && m.status === "pending_dept" && onDeptRespond && (
            <div className="flex gap-2">
              <button
                disabled={busy === m.requestId}
                onClick={async () => {
                  setBusy(m.requestId);
                  await onDeptRespond(m.requestId, true);
                  setBusy(null);
                }}
                className="px-3 py-1 bg-emerald-600 text-white text-xs"
              >
                Accept
              </button>
              <button
                disabled={busy === m.requestId}
                onClick={async () => {
                  setBusy(m.requestId);
                  await onDeptRespond(m.requestId, false);
                  setBusy(null);
                }}
                className="px-3 py-1 border border-ops-border text-ops-muted text-xs"
              >
                Reject
              </button>
            </div>
          )}

          {mode === "controller" && m.status === "pending_controller" && onControllerDecide && (
            <div className="flex items-center gap-2">
              <input
                placeholder="reason (optional)"
                value={reasonById[m.requestId] ?? ""}
                onChange={(e) => setReasonById((s) => ({ ...s, [m.requestId]: e.target.value }))}
                className="flex-1 px-2 py-1 bg-ops-inset border border-ops-border text-ops-text text-xs"
              />
              <button
                disabled={busy === m.requestId}
                onClick={async () => {
                  setBusy(m.requestId);
                  await onControllerDecide(m.requestId, true, reasonById[m.requestId]);
                  setBusy(null);
                }}
                className="px-3 py-1 bg-emerald-600 text-white text-xs"
              >
                Approve
              </button>
              <button
                disabled={busy === m.requestId}
                onClick={async () => {
                  setBusy(m.requestId);
                  await onControllerDecide(m.requestId, false, reasonById[m.requestId]);
                  setBusy(null);
                }}
                className="px-3 py-1 border border-ops-border text-ops-muted text-xs"
              >
                Reject
              </button>
            </div>
          )}

          {(m.status === "approved" || m.status === "rejected" || m.status === "lapsed") && (
            <span className={`text-[11px] font-semibold ${m.status === "approved" ? "text-emerald-400" : m.status === "lapsed" ? "text-amber-400" : "text-red-400"}`}>
              {m.status === "approved" ? "Approved" : m.status === "lapsed" ? "Lapsed" : "Rejected"}
              {m.status === "lapsed" ? "" : ` by ${m.decidedBy}`}
              {m.decisionReason ? ` — ${m.decisionReason}` : ""}
            </span>
          )}
          {m.status === "pending_dept" && mode === "controller" && (
            <span className="text-[11px] text-amber-400">Waiting on {m.requestingDepartment} to respond</span>
          )}
        </div>
        );
      })}
    </div>
  );
}
