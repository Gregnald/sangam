import { IST_TZ } from "../lib/dates";
import { useEffect, useMemo, useState } from "react";
import type { DefectRequest, ModificationRequest } from "../types/api";
import { DISPLAY_COLOR, DISPLAY_LABEL, DISPLAY_ORDER, blockDay, displayStatus, isRescheduled, shortId, waitingFor, type DisplayStatus } from "../lib/requestStatus";
import { CorridorGantt } from "./CorridorGantt";
import { ApiError, api } from "../lib/api";
import { useAppStore } from "../store/appStore";
import { useAuthStore } from "../store/authStore";

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
}: {
  requests: DefectRequest[];
  showDepartment?: boolean;
  showZone?: boolean;
}) {
  // Click a row to open that corridor's day on the Gantt with this request
  // outlined — its block if it has one, else the time it asked for.
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const role = useAuthStore((s) => s.role);
  const focusRequestId = useAppStore((s) => s.focusRequestId);
  const focusRequest = useAppStore((s) => s.focusRequest);
  const modifications = useAppStore((s) => s.modifications);

  // Opened from a notification: drop any filter hiding it, expand it, scroll to it.
  useEffect(() => {
    if (!focusRequestId || !requests.some((r) => r.defectId === focusRequestId)) return;
    setQuery("");
    setStatus("");
    setSeverity("");
    setDept("");
    setZone("");
    setOpenId(focusRequestId);
    const id = window.setTimeout(() => {
      document.getElementById(`request-${focusRequestId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      focusRequest(null);
    }, 150);
    return () => window.clearTimeout(id);
  }, [focusRequestId, requests, focusRequest]);

  async function placeOverTimetable(r: DefectRequest) {
    setBusyId(r.defectId);
    try {
      await api.post(`/api/v1/requests/${r.defectId}/traffic-suspended`, { trafficSuspended: true });
      await useAppStore.getState().fetchRequests();
      useAppStore.getState().bumpPlanRevision();
    } finally {
      setBusyId(null);
    }
  }
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
              const open = openId === r.defectId;
              const hasBlock = Boolean(r.allocatedStart && r.allocatedEnd);
              return [
                <tr key={r.defectId} id={`request-${r.defectId}`} onClick={() => setOpenId(open ? null : r.defectId)} className={`cursor-pointer hover:bg-ops-hover ${open ? "bg-ops-raise" : ""}`}>
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
                    {r.trafficSuspended && (
                      <span className="ml-2 text-[10px] font-semibold uppercase text-red-400 border border-red-400/40 px-1 py-px" title="Trains overlapping this block are cancelled / postponed">
                        Cancels trains
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-ops-muted mono whitespace-nowrap">{fmtBlock(r)}</td>
                  <td className="p-2 text-ops-muted mono">{r.planPeriodLabel ?? "—"}</td>
                  <td className="p-2 text-ops-muted">{r.deferCount > 0 ? r.deferCount : ""}</td>
                  <td className="p-2 text-ops-muted whitespace-nowrap" title={r.lastEventDetails ?? undefined}>
                    {r.lastEventAt ? `${(r.lastEventType ?? "").replace(/_/g, " ")} · ${new Date(r.lastEventAt).toLocaleDateString(undefined, { timeZone: IST_TZ, month: "short", day: "numeric" })}` : "—"}
                  </td>
                </tr>,
                open ? (
                  <tr key={`${r.defectId}-gantt`}>
                    <td colSpan={colCount} className="p-0">
                      <div className="p-3 bg-ops-inset border-t border-b border-ops-border space-y-2">
                        {(() => {
                          const w = waitingFor(r);
                          return w ? (
                            <div className={`flex items-center gap-3 flex-wrap text-xs ${w.impossible ? "text-red-400" : "text-amber-400"}`}>
                              <span>
                                <span className="font-semibold uppercase text-[10px] tracking-wide mr-1">Waiting for:</span>
                                {w.text}
                              </span>
                              {w.impossible && role === "CONTROLLER" && (
                                <button
                                  disabled={busyId === r.defectId}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    placeOverTimetable(r);
                                  }}
                                  className="px-2 py-1 border border-red-400/60 text-red-400 text-[11px] disabled:opacity-50"
                                  title="Declare the fault unsafe for trains: the block is placed at the earliest time over the timetable and the trains it overlaps are cancelled / postponed"
                                >
                                  {busyId === r.defectId ? "Placing…" : "Place over the timetable (cancel trains)"}
                                </button>
                              )}
                            </div>
                          ) : null;
                        })()}
                        {role === "CONTROLLER" && <ControllerActions r={r} pending={modifications.find((m) => m.defectId === r.defectId && (m.status === "pending_controller" || m.status === "pending_dept")) ?? null} />}
                        {r.lastEventDetails && <p className="text-xs text-ops-muted">{r.lastEventDetails}</p>}
                        {r.corridorId ? (
                          <CorridorGantt
                            corridorId={r.corridorId}
                            rangeStart={blockDay(r)}
                            rangeEnd={blockDay(r)}
                            highlightWindowStart={hasBlock ? null : r.requestedWindowStart}
                            highlightWindowEnd={hasBlock ? null : r.requestedWindowEnd}
                            highlightDefectId={hasBlock ? r.defectId : null}
                            highlightLabel={hasBlock ? "This job" : r.requestedWindowStart ? "Window asked for" : null}
                            highlightKind={hasBlock ? "own" : "proposed"}
                          />
                        ) : (
                          <p className="text-xs text-ops-muted">No corridor on this request.</p>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * What the controller can do to a request right here, without going to
 * Approvals: decide a bump / accepted reschedule that is waiting on them,
 * withdraw an offer and look for another slot, force the request into the
 * schedule (bumping a lower-priority block if needed), or cancel it. Every
 * action confirms first and takes an optional reason.
 */
function ControllerActions({ r, pending }: { r: DefectRequest; pending: ModificationRequest | null }) {
  const decideModification = useAppStore((s) => s.decideModification);
  const [mode, setMode] = useState<null | "approve" | "reject" | "alternate" | "bump" | "cancel">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const waiting = r.workflowStatus === "pending" || r.workflowStatus === "awaiting_dept_response" || r.workflowStatus === "awaiting_controller";
  if (!waiting) return null;

  async function run(kind: NonNullable<typeof mode>) {
    setBusy(true);
    setError(null);
    try {
      const why = reason.trim() || undefined;
      if (kind === "approve" || kind === "reject") {
        await decideModification(pending!.requestId, kind === "approve", why);
        setMsg(kind === "approve" ? "Approved — the plan has been changed." : "Rejected — the request is back in the backlog.");
      } else {
        const path = kind === "alternate" ? "find-alternate" : kind === "bump" ? "force-bump" : "clear";
        const res = await api.post<{ ok: boolean; message?: string }>(`/api/v1/requests/${r.defectId}/${path}`, { reason: why ?? null });
        setMsg(kind === "cancel" ? "Request cancelled." : `Done — ${res.message ?? "re-placed"}.`);
      }
      useAppStore.getState().bumpPlanRevision();
      await useAppStore.getState().refreshAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (msg) return <p className="text-xs text-emerald-400">{msg}</p>;

  const isBump = pending?.requestType === "preemption";
  const onController = pending?.status === "pending_controller";
  const onDept = pending?.status === "pending_dept";
  const texts: Record<NonNullable<typeof mode>, string> = {
    approve: isBump
      ? `Approve the bump? The ${pending?.affectedDepartment} block at ${pending?.proposedWindowStart ? new Date(pending.proposedWindowStart).toLocaleString(undefined, { timeZone: IST_TZ, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""} goes back to the backlog and this request takes its slot. Both departments are told.`
      : `Approve the reschedule? The plan is changed to the alternate the department accepted${pending?.proposedWindowStart ? ` (${new Date(pending.proposedWindowStart).toLocaleString(undefined, { timeZone: IST_TZ, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })})` : ""}.`,
    reject: `Reject this ${isBump ? "bump" : "reschedule"}? The request goes back to the backlog with one more deferral and the department is told.`,
    alternate: `Look for a different slot? ${r.requestedWindowStart ? "The time it asked for is dropped, " : ""}any open offer or bump is withdrawn, and it is placed into the earliest slot that fits up to its due date — or offered a new alternate / raised as a bump.`,
    bump: `Force it into the schedule? The priority margin is waived: a free on-time slot is used if one exists; otherwise the lowest-priority scheduled block on ${r.corridorId} is displaced back to the backlog (that department is told) and this request takes its place. The models learn from the decision.`,
    cancel: `Cancel this ${r.department} request entirely? Any open offer or bump is closed, it leaves the backlog, and the department is told.`,
  };

  if (!mode) {
    return (
      <div className="flex items-center gap-2 flex-wrap text-[11px]" onClick={stop}>
        <span className="text-[10px] uppercase tracking-wide text-ops-muted mr-1">Controller:</span>
        {pending && onController && (
          <>
            <span className="text-ops-muted">{isBump ? "bump request" : "accepted reschedule"} awaiting you —</span>
            <button onClick={() => setMode("approve")} className="px-2.5 py-1 bg-emerald-600 text-white">
              Approve {isBump ? "bump" : "reschedule"}
            </button>
            <button onClick={() => setMode("reject")} className="px-2.5 py-1 border border-red-400/60 text-red-400">
              Reject
            </button>
          </>
        )}
        {pending && onDept && <span className="text-ops-muted">alternate offered, awaiting the department —</span>}
        <button onClick={() => setMode("alternate")} className="px-2.5 py-1 border border-ops-border text-ops-text">
          Find alternate slot
        </button>
        <button onClick={() => setMode("bump")} className="px-2.5 py-1 bg-ops-accent text-white">
          Bump into schedule
        </button>
        <button onClick={() => setMode("cancel")} className="px-2.5 py-1 border border-red-400/60 text-red-400">
          Cancel request
        </button>
      </div>
    );
  }
  const danger = mode === "reject" || mode === "cancel";
  return (
    <div className={`border p-2.5 space-y-2 ${danger ? "border-red-400/40 bg-red-500/5" : "border-ops-accent/40 bg-ops-raise"}`} onClick={stop}>
      <p className="text-xs text-ops-text">{texts[mode]}</p>
      <div className="flex items-center gap-2 flex-wrap">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional — goes to the department and the log)" className="text-[11px] bg-ops-panel border border-ops-border text-ops-text px-2 py-1 w-80" autoFocus />
        <button disabled={busy} onClick={() => run(mode)} className={`px-2.5 py-1 text-white text-[11px] disabled:opacity-50 ${danger ? "bg-red-600" : "bg-ops-accent"}`}>
          {busy ? "Working…" : mode === "approve" ? "Yes, approve" : mode === "reject" ? "Yes, reject" : mode === "alternate" ? "Yes, re-place it" : mode === "bump" ? "Yes, bump it in" : "Yes, cancel it"}
        </button>
        <button disabled={busy} onClick={() => setMode(null)} className="px-2.5 py-1 border border-ops-border text-ops-muted text-[11px]">
          Back
        </button>
        {error && <span className="text-[11px] text-red-400">{error}</span>}
      </div>
    </div>
  );
}
