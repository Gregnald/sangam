import { useState } from "react";
import { CorridorGantt } from "./CorridorGantt";
import { fmtDate, mondayOf } from "../lib/dates";
import type { ModificationRequest } from "../types/api";

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
        Originally requested: {new Date(m.originalWindowStart).toLocaleString()}
        {m.originalWindowEnd ? ` – ${new Date(m.originalWindowEnd).toLocaleTimeString()}` : ""} → Proposed instead:{" "}
        {new Date(m.proposedWindowStart).toLocaleString()}
        {m.proposedWindowEnd ? ` – ${new Date(m.proposedWindowEnd).toLocaleTimeString()}` : ""}
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

  if (items.length === 0) {
    return <p className="text-xs text-ops-muted p-4 border border-ops-border">Nothing here right now.</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((m) => {
        const canExpand = Boolean(m.proposedCorridorId && m.proposedWindowStart);
        const isOpen = expanded === m.requestId;
        const weekStart = m.proposedWindowStart ? mondayOf(new Date(m.proposedWindowStart)) : null;
        const weekEnd = weekStart ? new Date(weekStart.getTime() + 6 * 86400000) : null;
        return (
        <div key={m.requestId} className="border border-ops-border p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-ops-text">{TYPE_LABEL[m.requestType]}</span>
            <span className="text-[10px] text-ops-muted">{new Date(m.createdAt).toLocaleString()}</span>
          </div>
          <p className="text-xs text-ops-muted mb-2">{m.description}</p>
          <div className="text-[11px] text-ops-muted mb-2">
            {m.requestingDepartment} · {m.proposedCorridorId}
            {m.proposedWindowStart && <> · {new Date(m.proposedWindowStart).toLocaleString()}</>}
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
