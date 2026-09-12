import { useEffect, useState } from "react";
import { api, ApiError, qs } from "../lib/api";
import { fmtDate, fmtDateTimeIST, fmtTimeIST, istDateKey, istMinuteOfDay } from "../lib/dates";
import { useAppStore } from "../store/appStore";
import { useAuthStore } from "../store/authStore";
import { HourGrid, TimeAxis } from "./GanttAxis";
import type { CorridorSchedule, ScheduleAssignment, SchedulePendingRequest } from "../types/api";

const DEPT_COLOR: Record<string, string> = { ENGG: "#2563eb", SIGNAL: "#9333ea", TRD: "#ea580c" };
const DEPT_LABEL: Record<string, string> = { ENGG: "Engineering", SIGNAL: "Signal & Telecom", TRD: "Traction Distribution" };
const SOURCE_LABEL: Record<string, string> = { TMS: "TMS (Track Management)", SMMS: "SMMS (Signalling)", TDMS: "TDMS (Traction Distribution)" };
// Timetabled trains: the reason a free window has gaps in it. Drawn as a
// bright tick the full height of the row so even a 9-minute passage is
// visible and hoverable.
const TRAIN_COLOR = "var(--ops-train)";
// Stretches of the day that are neither a free window, a train, nor a goods
// band: gaps between trains too short for a block (< 90 min), a window's
// tail after it was clipped, or a day the calendar doesn't cover. Drawn as
// a dim dotted band so the timeline is never simply black.
const SHORT_GAP_STYLE = "repeating-linear-gradient(90deg, color-mix(in srgb, var(--ops-muted) 35%, transparent) 0 2px, transparent 2px 6px)";
const PAST_DAY_STYLE = "repeating-linear-gradient(-45deg, color-mix(in srgb, var(--ops-muted) 18%, transparent) 0 6px, transparent 6px 14px)";
const MIN_BLOCK_MIN = 90;

// Requested blocks are hatched rather than just a different solid colour:
// TRD's orange and any "requested" amber sit close enough on screen that a
// solid-vs-solid distinction gets misread as the same thing.
const REQUESTED_HATCH = "repeating-linear-gradient(45deg, #fbbf24 0 4px, rgba(251,191,36,0.2) 4px 8px)";
// Goods-train forecast bands: Control Office expects freight paths through
// here, so the planner treats the band as occupied. Drawn as a red hatch
// under the free windows so a "free" gap that's been clipped reads as such.
const GOODS_HATCH = "repeating-linear-gradient(-45deg, rgba(239,68,68,0.55) 0 3px, rgba(239,68,68,0.12) 3px 7px)";

const dateKey = istDateKey;
const minuteOfDay = istMinuteOfDay;
const fmtTime = fmtTimeIST;
function widthPct(startIso: string, endIso: string): number {
  const mins = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
  return Math.max((mins / 1440) * 100, 0.6);
}
function fmtMin(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function fmtDue(iso: string | null): string {
  return iso ? new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
}

// Jobs sharing a possession overlap in time (departments work in parallel
// under one block), so they can't all sit on the same 5px strip. Greedy
// interval colouring: each bar takes the lowest lane free at its start.
function assignLanes(items: ScheduleAssignment[]): { lanes: Map<string, number>; count: number } {
  const sorted = [...items].sort((a, b) => new Date(a.allocatedStart).getTime() - new Date(b.allocatedStart).getTime());
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const a of sorted) {
    const start = new Date(a.allocatedStart).getTime();
    const end = new Date(a.allocatedEnd).getTime();
    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    lanes.set(a.assignmentId, lane);
  }
  return { lanes, count: Math.max(laneEnds.length, 1) };
}

// Minute-of-day intervals of a 24 h row not covered by any of `covered`.
function uncovered(covered: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...covered].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  let cursor = 0;
  for (const [a, b] of sorted) {
    if (a > cursor) out.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < 1440) out.push([cursor, 1440]);
  return out.filter(([a, b]) => b - a >= 1);
}
function minutesOf(startIso: string, endIso: string): [number, number] {
  const s = minuteOfDay(startIso);
  const len = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  return [s, Math.min(s + len, 1440)];
}

function assignmentTitle(a: ScheduleAssignment, isProposed: boolean, partners: ScheduleAssignment[]): string {
  const lines = [
    `${DEPT_LABEL[a.department] ?? a.department} (${a.department}) — ${(a.defectType ?? "").replace(/_/g, " ")}`,
    `Block: ${fmtTime(a.allocatedStart)}–${fmtTime(a.allocatedEnd)}${a.estimatedBlockHours != null ? ` (${a.estimatedBlockHours.toFixed(2)} h)` : ""}`,
    `Severity ${a.severityCode ?? "?"}${a.speedRestrictionKmph != null ? ` · speed restriction ${a.speedRestrictionKmph} km/h in force` : ""} · due ${fmtDue(a.dueDate)}${a.priorityScore != null ? ` · priority ${a.priorityScore.toFixed(0)}/100` : ""}`,
    `Asset: ${a.assetId ?? "—"} · source: ${a.sourceSystem ? SOURCE_LABEL[a.sourceSystem] ?? a.sourceSystem : "—"}`,
    `Requested by: ${a.requestedBy ?? "—"}${a.planPeriodLabel ? ` · plan ${a.planPeriodLabel}` : ""}${isProposed ? " · PROPOSED (not yet approved)" : " · approved"}`,
  ];
  if (a.rescheduledAt) lines.push("RESCHEDULED — was overdue; placed here automatically");
  if (partners.length > 0) {
    const otherDepts = [...new Set(partners.map((p) => p.department))].filter((d) => d !== a.department);
    const head = otherDepts.length > 0
      ? `JOINT BLOCK with ${otherDepts.join(", ")} — ${partners.length} other job${partners.length === 1 ? " shares" : "s share"} this possession: `
      : `SHARED POSSESSION — ${partners.length} other ${a.department} job${partners.length === 1 ? "" : "s"} back to back in the same window: `;
    lines.push(head + partners.map((p) => `${p.department} ${(p.defectType ?? "").replace(/_/g, " ")} ${fmtTime(p.allocatedStart)}–${fmtTime(p.allocatedEnd)}`).join("; "));
  }
  return lines.join("\n");
}

export function CorridorGantt({
  corridorId,
  rangeStart,
  rangeEnd,
  highlightWindowStart,
  highlightWindowEnd,
  highlightLabel,
  highlightKind = "proposed",
  highlightDefectId,
  planId,
}: {
  corridorId: string;
  rangeStart: string;
  rangeEnd: string;
  highlightWindowStart?: string | null;
  highlightWindowEnd?: string | null;
  /** What the highlighted slot means (e.g. "Offered alternate slot for SIGNAL cable fault"). */
  highlightLabel?: string | null;
  /** "proposed": an empty slot a pending request would occupy. "own": an existing block being pointed at. */
  highlightKind?: "proposed" | "own";
  /** The request whose own bar is outlined (kind "own"); other jobs sharing the possession are left alone. */
  highlightDefectId?: string | null;
  planId?: string | null;
}) {
  const [data, setData] = useState<CorridorSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<ScheduleAssignment | null>(null);
  const role = useAuthStore((s) => s.role);
  const bumpPlanRevision = useAppStore((s) => s.bumpPlanRevision);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<CorridorSchedule>(`/api/v1/corridors/${corridorId}/schedule${qs({ start: rangeStart, end: rangeEnd, planId: planId ?? undefined })}`)
      .then((d) => !cancelled && setData(d))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [corridorId, rangeStart, rangeEnd, planId, reloadKey]);

  if (loading) return <p className="text-xs text-ops-muted p-3">Loading schedule…</p>;
  if (!data) return null;

  // Calendar days of the range (local midnight → date parts, never via UTC).
  const days: string[] = [];
  const cursor = new Date(rangeStart + "T00:00:00");
  const end = new Date(rangeEnd + "T00:00:00");
  while (cursor <= end) {
    days.push(fmtDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  const highlightDay = highlightWindowStart ? dateKey(highlightWindowStart) : null;
  const todayKey = dateKey(new Date().toISOString());
  const firstOpenDay = days.find((d) => d >= todayKey) ?? days[0];

  // Which row a pending request belongs on. A pinned request sits on the
  // day it asked for. An unpinned one is due by its due date, so it sits
  // there, drawn in the earliest free window that could take it — an
  // indication of where it could go, not a placement. Only a request that is
  // already overdue is pulled forward to the first open day (any day is
  // better than none); one due before or after these days belongs to
  // another week and is listed, not drawn.
  const pendingDay = (p: SchedulePendingRequest): string | null => {
    if (p.requestedWindowStart) return dateKey(p.requestedWindowStart);
    if (!p.dueDate) return null;
    if (p.isOverdue && p.dueDate < days[0]) return firstOpenDay;
    if (p.dueDate < days[0] || p.dueDate > days[days.length - 1]) return null;
    return p.dueDate;
  };
  const backlogElsewhere = data.pendingRequests.filter((p) => pendingDay(p) === null);
  const canDecide = (a: ScheduleAssignment) => role === "CONTROLLER" && a.planStatus === "pending_approval" && Boolean(a.planId);
  const anyAccepted = data.assignments.some((a) => a.decision === "accepted");

  return (
    <div className="border border-ops-border">
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap px-3 py-1.5 border-b border-ops-border text-[11px] text-ops-muted">
        <span className="flex items-center gap-1">
          Allocated:
          {Object.entries(DEPT_COLOR).map(([dept, color]) => (
            <span key={dept} className="flex items-center gap-1 ml-1">
              <span className="w-2.5 h-2.5 inline-block" style={{ background: color }} /> {dept}
            </span>
          ))}
        </span>
        {planId && (
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 inline-block border border-dashed border-blue-400" style={{ background: "rgba(37,99,235,0.35)" }} /> Proposed (not yet approved)
          </span>
        )}
        {anyAccepted && (
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 inline-block ring-2 ring-emerald-400" /> Accepted by controller
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 inline-block outline outline-1 outline-ops-outline" style={{ background: "linear-gradient(180deg, #2563eb 50%, #9333ea 50%)" }} /> Shared possession (joint if multi-dept)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 inline-block" style={{ background: REQUESTED_HATCH }} /> Requested (not yet placed)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-ops-window border border-ops-outline/60 inline-block" /> Free window
        </span>
        {data.traversals.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-0.5 h-2.5 inline-block" style={{ background: TRAIN_COLOR }} /> Timetabled train
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 inline-block border border-ops-border" style={{ background: SHORT_GAP_STYLE }} /> Gap too short for a block (&lt;{MIN_BLOCK_MIN} min)
        </span>
        {(highlightWindowStart || highlightDefectId) && (
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 inline-block ring-2 ring-ops-highlight" /> {highlightLabel ?? (highlightKind === "own" ? "This job" : "Proposed slot for this request")}
          </span>
        )}
        {data.goodsForecasts.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 inline-block" style={{ background: GOODS_HATCH }} /> Goods forecast (COA)
          </span>
        )}
      </div>
      <TimeAxis labelWidth="w-28" />
      <div className="divide-y divide-ops-border">
        {days.map((day) => {
          const dayWindows = data.windows.filter((w) => dateKey(w.windowStart) === day);
          const dayAssignments = data.assignments.filter((a) => dateKey(a.allocatedStart) === day);
          const { lanes, count: laneCount } = assignLanes(dayAssignments);
          const laneH = 24 / laneCount;
          const dayPending = data.pendingRequests.filter((p) => pendingDay(p) === day);
          const sortedWindows = [...dayWindows].sort((a, b) => a.windowStart.localeCompare(b.windowStart));
          const dayGoods = data.goodsForecasts.filter((g) => dateKey(g.bandStart) === day);
          const isHighlightDay = day === highlightDay;
          const isPast = day < todayKey;
          const hasCalendar = dayWindows.length > 0 || dayGoods.length > 0;
          // Trains of the timetable version in force on this day.
          const dayTrains = data.traversals.filter((t) => (!t.effectiveFrom || t.effectiveFrom <= day) && (!t.effectiveTo || day < t.effectiveTo));
          const covered: Array<[number, number]> = [
            ...dayWindows.map((w) => minutesOf(w.windowStart, w.windowEnd)),
            ...dayGoods.map((g) => minutesOf(g.bandStart, g.bandEnd)),
            ...(hasCalendar ? dayTrains.map((t): [number, number] => [t.departMin, Math.min(t.arriveMin, 1440)]) : []),
          ];
          const gaps = hasCalendar ? uncovered(covered) : [];
          return (
            <div key={day} className={`flex items-center gap-2 px-3 py-1.5 ${isHighlightDay ? "bg-amber-500/10" : ""}`}>
              <span className="w-28 shrink-0 text-[11px] text-ops-muted mono">
                {new Date(day + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </span>
              <div className="relative flex-1 h-8 bg-ops-inset-strong border border-ops-border/60">
                <HourGrid />
                {!hasCalendar && (
                  <div
                    className="absolute inset-0 flex items-center justify-center text-[11px] text-ops-muted"
                    style={{ background: PAST_DAY_STYLE }}
                    title={isPast ? "Past day — the block-window calendar only covers today onward" : "No block-window calendar for this day yet (calendar covers 35 days from the last pipeline run)"}
                  >
                    {isPast ? "past" : "no calendar"}
                  </div>
                )}
                {gaps.map(([a, b]) => (
                  <div
                    key={`gap-${a}`}
                    className="absolute top-0 h-full"
                    style={{ left: `${(a / 1440) * 100}%`, width: `${((b - a) / 1440) * 100}%`, background: SHORT_GAP_STYLE }}
                    title={
                      b - a < MIN_BLOCK_MIN
                        ? `${fmtMin(a)}–${fmtMin(b)}: ${b - a} min between trains — shorter than the ${MIN_BLOCK_MIN}-min minimum for a block`
                        : `${fmtMin(a)}–${fmtMin(b)}: not available for a block (window clipped by a goods forecast or a shorter remaining stretch)`
                    }
                  />
                ))}
                {dayGoods.map((g) => (
                  <div
                    key={g.forecastId}
                    className="absolute top-0 h-full"
                    style={{ left: `${(minuteOfDay(g.bandStart) / 1440) * 100}%`, width: `${widthPct(g.bandStart, g.bandEnd)}%`, background: GOODS_HATCH }}
                    title={`Goods forecast (${g.source}): ${g.trainCount} train${g.trainCount === 1 ? "" : "s"} expected ${fmtTime(g.bandStart)}–${fmtTime(g.bandEnd)} — not available for blocks`}
                  />
                ))}
                {dayWindows.map((w) => (
                  <div
                    key={w.windowId}
                    className="absolute top-0 h-full bg-ops-window border-l border-r border-ops-outline/50"
                    style={{ left: `${(minuteOfDay(w.windowStart) / 1440) * 100}%`, width: `${widthPct(w.windowStart, w.windowEnd)}%` }}
                    title={`Free window ${fmtTime(w.windowStart)}–${fmtTime(w.windowEnd)} — any number of jobs may share it if their kinds of work are compatible (Compatibility tab)`}
                  />
                ))}
                {dayWindows.length > 0 &&
                  dayTrains.map((t) => (
                    <div
                      key={`${t.trainNumber}-${t.departMin}`}
                      className="absolute top-0 h-full opacity-80"
                      style={{ left: `${(t.departMin / 1440) * 100}%`, width: `${Math.max(((t.arriveMin - t.departMin) / 1440) * 100, 0.25)}%`, background: TRAIN_COLOR }}
                      title={`Train ${t.trainNumber}${t.trainName ? ` ${t.trainName}` : ""} (${t.direction.toUpperCase()}) on this section ${fmtMin(t.departMin)}–${fmtMin(t.arriveMin)} — no block possible`}
                    />
                  ))}
                {dayAssignments.map((a) => {
                  const isHighlight = highlightDefectId
                    ? a.defectId === highlightDefectId
                    : isHighlightDay && highlightWindowStart && Math.abs(new Date(a.allocatedStart).getTime() - new Date(highlightWindowStart).getTime()) < 60000;
                  const isProposed = a.planStatus && a.planStatus !== "approved";
                  const partners = a.jointBlockGroupId ? dayAssignments.filter((o) => o.jointBlockGroupId === a.jointBlockGroupId && o.assignmentId !== a.assignmentId) : [];
                  const lane = lanes.get(a.assignmentId) ?? 0;
                  return (
                    <div
                      key={a.assignmentId}
                      onClick={() => setSelected((s) => (s?.assignmentId === a.assignmentId ? null : a))}
                      className={`absolute cursor-pointer ${isHighlight ? "ring-2 ring-ops-highlight z-10" : ""} ${a.decision === "accepted" ? "ring-2 ring-emerald-400 z-10" : ""} ${selected?.assignmentId === a.assignmentId ? "ring-2 ring-ops-text z-20" : ""} ${isProposed ? "border border-dashed border-ops-outline opacity-60" : ""} ${partners.length && !isHighlight ? "outline outline-1 outline-ops-outline" : ""}`}
                      style={{
                        left: `${(minuteOfDay(a.allocatedStart) / 1440) * 100}%`,
                        width: `${widthPct(a.allocatedStart, a.allocatedEnd)}%`,
                        top: `${2 + lane * laneH}px`,
                        height: `${Math.max(laneH - (laneCount > 1 ? 1 : 0), 3)}px`,
                        background: DEPT_COLOR[a.department] ?? "#2563eb",
                      }}
                      title={assignmentTitle(a, Boolean(isProposed), partners)}
                    />
                  );
                })}
                {dayPending.map((p, i) => {
                  const label = `${p.department} · ${p.defectType.replace(/_/g, " ")} · Sev ${p.severityCode} · ${p.estimatedBlockHours.toFixed(2)} h${p.priorityScore != null ? ` · priority ${p.priorityScore.toFixed(0)}` : ""} · due ${fmtDue(p.dueDate)}${p.isOverdue ? " (OVERDUE)" : ""}`;
                  if (p.requestedWindowStart && p.requestedWindowEnd) {
                    return (
                      <div
                        key={p.defectId}
                        className="absolute top-0.5 h-5 border border-amber-400/70"
                        style={{ left: `${(minuteOfDay(p.requestedWindowStart) / 1440) * 100}%`, width: `${widthPct(p.requestedWindowStart, p.requestedWindowEnd)}%`, background: REQUESTED_HATCH }}
                        title={`Requested (not yet placed) at the time asked for: ${label} · ${fmtTime(p.requestedWindowStart)}–${fmtTime(p.requestedWindowEnd)}`}
                      />
                    );
                  }
                  const mins = Math.round(p.estimatedBlockHours * 60);
                  const fit = sortedWindows.find((w) => (new Date(w.windowEnd).getTime() - new Date(w.windowStart).getTime()) / 60000 >= mins);
                  const left = fit ? minuteOfDay(fit.windowStart) : 0;
                  return (
                    <div
                      key={p.defectId}
                      className={`absolute h-2 border ${fit ? "border-amber-400/70" : "border-red-400"}`}
                      style={{ top: `${1 + (i % 3) * 3}px`, left: `${(left / 1440) * 100}%`, width: `${Math.max((mins / 1440) * 100, 0.6)}%`, background: REQUESTED_HATCH }}
                      title={
                        fit
                          ? `Requested (not yet placed): ${label} · could take the free window from ${fmtTime(fit.windowStart)} — indicative, not scheduled`
                          : `Requested (not yet placed): ${label} · no free window on this day is long enough`
                      }
                    />
                  );
                })}
                {isHighlightDay && highlightWindowStart && highlightWindowEnd && highlightKind === "proposed" && (
                  <div
                    className="absolute top-0 h-full border-2 border-ops-highlight bg-ops-highlight/10 overflow-hidden whitespace-nowrap text-[11px] leading-7 px-1.5 text-ops-text"
                    style={{ left: `${(minuteOfDay(highlightWindowStart) / 1440) * 100}%`, width: `${widthPct(highlightWindowStart, highlightWindowEnd)}%` }}
                    title={`${highlightLabel ?? "Proposed slot for this request"}: ${fmtTime(highlightWindowStart)}–${fmtTime(highlightWindowEnd)} — empty until the request is approved`}
                  >
                    {fmtTime(highlightWindowStart)}–{fmtTime(highlightWindowEnd)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {selected && (
        <BlockDetail
          a={selected}
          partners={selected.jointBlockGroupId ? data.assignments.filter((o) => o.jointBlockGroupId === selected.jointBlockGroupId && o.assignmentId !== selected.assignmentId) : []}
          canDecide={canDecide(selected)}
          onClose={() => setSelected(null)}
          onDecided={() => {
            setSelected(null);
            setReloadKey((k) => k + 1);
            bumpPlanRevision();
            useAppStore.getState().fetchRequests();
          }}
        />
      )}
      {backlogElsewhere.length > 0 && (
        <div className="px-3 py-2 border-t border-ops-border">
          <p className="text-[11px] text-ops-muted mb-1">Also requested on this corridor, due outside these days:</p>
          <div className="flex flex-wrap gap-1.5">
            {backlogElsewhere.map((p) => (
              <span key={p.defectId} className="text-[11px] px-1.5 py-0.5 bg-amber-400/20 text-amber-300" title={`${p.estimatedBlockHours.toFixed(2)} h · due ${fmtDue(p.dueDate)}`}>
                {p.department} · {p.defectType.replace(/_/g, " ")} · due {fmtDue(p.dueDate)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-ops-muted">{k}</p>
      <p className="text-[11px] text-ops-text mono truncate">{v}</p>
    </div>
  );
}

/** Everything about one block, and — while its plan is still a proposal — the controller's accept / reject for just that block. */
function BlockDetail({ a, partners, canDecide, onClose, onDecided }: { a: ScheduleAssignment; partners: ScheduleAssignment[]; canDecide: boolean; onClose: () => void; onDecided: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isProposed = a.planStatus && a.planStatus !== "approved";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/plans/assignments/${a.assignmentId}/decision`, { approve, reason: reason.trim() || null });
      onDecided();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-ops-border bg-ops-inset px-3 py-2 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold" style={{ color: DEPT_COLOR[a.department] }}>{DEPT_LABEL[a.department] ?? a.department}</span>
        <span className="text-xs text-ops-text">{(a.defectType ?? "").replace(/_/g, " ")}</span>
        <span className={`text-[11px] font-semibold ${a.severityCode === "A" ? "text-red-400" : a.severityCode === "B" ? "text-amber-400" : "text-emerald-400"}`}>Sev {a.severityCode ?? "?"}</span>
        {a.decision === "accepted" ? (
          <span className="text-[10px] font-semibold uppercase text-emerald-400 border border-emerald-400/40 px-1.5 py-px">Accepted{a.decidedBy ? ` by ${a.decidedBy}` : ""}</span>
        ) : isProposed ? (
          <span className="text-[10px] font-semibold uppercase text-amber-400 border border-amber-400/40 px-1.5 py-px">Proposed — awaiting approval</span>
        ) : (
          <span className="text-[10px] font-semibold uppercase text-emerald-400">Approved</span>
        )}
        {a.rescheduledAt && <span className="text-[10px] font-semibold uppercase text-blue-400 border border-blue-400/40 px-1.5 py-px">Rescheduled</span>}
        <button onClick={onClose} className="ml-auto text-[11px] text-ops-muted hover:text-ops-text">close ✕</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-x-4 gap-y-1.5">
        <Field k="Block" v={`${fmtDateTimeIST(a.allocatedStart)} – ${fmtTime(a.allocatedEnd)}`} />
        <Field k="Duration" v={`${a.estimatedBlockHours != null ? a.estimatedBlockHours.toFixed(2) : ((new Date(a.allocatedEnd).getTime() - new Date(a.allocatedStart).getTime()) / 3.6e6).toFixed(2)} h`} />
        <Field k="Due" v={a.dueDate ?? "—"} />
        <Field k="Priority" v={a.priorityScore != null ? `${a.priorityScore.toFixed(0)} / 100` : "—"} />
        <Field k="Speed restriction" v={a.speedRestrictionKmph != null ? `${a.speedRestrictionKmph} km/h` : "none"} />
        <Field k="Request" v={a.defectId ? <span title={a.defectId}>#{a.defectId.slice(0, 8).toUpperCase()}</span> : "—"} />
        <Field k="Asset" v={a.assetId ?? "—"} />
        <Field k="Source" v={a.sourceSystem ? SOURCE_LABEL[a.sourceSystem] ?? a.sourceSystem : "—"} />
        <Field k="Requested by" v={a.requestedBy ?? "—"} />
        <Field k="Detected" v={a.detectedDate ?? "—"} />
        <Field k="Deferred" v={a.deferCount ? `${a.deferCount}×` : "never"} />
        <Field k="Plan" v={a.planPeriodLabel ?? "—"} />
      </div>
      {partners.length > 0 && (
        <p className="text-[11px] text-ops-muted">
          Shares the possession with{" "}
          {partners.map((p, i) => (
            <span key={p.assignmentId}>
              {i > 0 ? ", " : ""}
              <span className="font-semibold" style={{ color: DEPT_COLOR[p.department] }}>{p.department}</span> {(p.defectType ?? "").replace(/_/g, " ")} {fmtTime(p.allocatedStart)}–{fmtTime(p.allocatedEnd)}
            </span>
          ))}
        </p>
      )}
      {canDecide && a.decision !== "accepted" && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="text-[11px] bg-ops-panel border border-ops-border text-ops-text px-2 py-1 w-64" />
          <button disabled={busy} onClick={() => decide(true)} className="px-2.5 py-1 bg-emerald-600 text-white text-[11px] disabled:opacity-50">Accept block</button>
          <button disabled={busy} onClick={() => decide(false)} className="px-2.5 py-1 border border-red-400/60 text-red-400 text-[11px] disabled:opacity-50">Reject block</button>
          {partners.some((p) => p.department !== a.department) && <span className="text-[10px] text-ops-muted">also recorded as a compatibility decision for its partners</span>}
          {error && <span className="text-[11px] text-red-400">{error}</span>}
        </div>
      )}
      {canDecide && a.decision === "accepted" && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <button disabled={busy} onClick={() => decide(false)} className="px-2.5 py-1 border border-red-400/60 text-red-400 text-[11px] disabled:opacity-50">Reject block</button>
          {error && <span className="text-[11px] text-red-400">{error}</span>}
        </div>
      )}
    </div>
  );
}
