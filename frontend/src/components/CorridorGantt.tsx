import { useEffect, useState } from "react";
import { api, ApiError, qs } from "../lib/api";
import { fmtDate, fmtDateTimeIST, fmtTimeIST, istDateKey, istMinuteOfDay } from "../lib/dates";
import { api as apiClient } from "../lib/api";
import { useAppStore } from "../store/appStore";
import { useAuthStore } from "../store/authStore";
import { HourGrid, TimeAxis } from "./GanttAxis";
import type { CorridorBlockWindow, CorridorSchedule, GoodsForecastBand, ScheduleAssignment, SchedulePendingRequest, ScheduleTraversal } from "../types/api";

const DEPT_COLOR: Record<string, string> = { ENGG: "#2563eb", SIGNAL: "#9333ea", TRD: "#ea580c" };
const DEPT_LABEL: Record<string, string> = { ENGG: "Engineering", SIGNAL: "Signal & Telecom", TRD: "Traction Distribution" };
const SOURCE_LABEL: Record<string, string> = { TMS: "TMS (Track Management)", SMMS: "SMMS (Signalling)", TDMS: "TDMS (Traction Distribution)" };
// Timetabled trains: the reason a free window has gaps in it. Drawn as a
// bright tick the full height of the row so even a 9-minute passage is
// visible and hoverable.
const TRAIN_COLOR = "var(--ops-train)";
// A train that cannot run: the section is closed by a fault. Greyed and
// hatched so it still reads as a timetabled passage that isn't happening.
const CANCELLED_TRAIN = "repeating-linear-gradient(180deg, color-mix(in srgb, var(--ops-muted) 55%, transparent) 0 3px, transparent 3px 5px)";
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
/** "YYYY-MM-DD" + minute-of-day → ISO timestamp in IST. */
function istIso(day: string, minute: number): string {
  return `${day}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00+05:30`;
}
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
/** Does [startIso, endIso) touch this operational day? */
function overlapsDay(startIso: string, endIso: string, day: string): boolean {
  const sd = dateKey(startIso);
  const ed = dateKey(endIso);
  const endsAtMidnight = ed > sd && istMinuteOfDay(endIso) === 0;
  return sd <= day && (endsAtMidnight ? day < ed : day <= ed);
}
/** The part of [startIso, endIso) that falls on this day, in minutes of that day — a block over midnight is [start, 1440] on its first day and [0, end] on the next. */
function minutesOn(startIso: string, endIso: string, day: string): [number, number] {
  const s = dateKey(startIso) === day ? minuteOfDay(startIso) : 0;
  const ed = dateKey(endIso);
  const e = ed === day ? Math.max(minuteOfDay(endIso), ed > dateKey(startIso) && minuteOfDay(endIso) === 0 ? 1440 : 0) : 1440;
  return [s, e === 0 ? 1440 : e];
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
  const [selected, setSelected] = useState<Sel | null>(null);
  const pick = (next: Sel) => setSelected((cur) => (cur && sameSel(cur, next) ? null : next));
  const role = useAuthStore((s) => s.role);
  const bumpPlanRevision = useAppStore((s) => s.bumpPlanRevision);
  const planRevision = useAppStore((s) => s.planRevision);

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
  }, [corridorId, rangeStart, rangeEnd, planId, reloadKey, planRevision]);

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
    if (p.requestedWindowStart) return dateKey(p.requestedWindowStart); // first day; later days via pendingOnDay
    if (!p.dueDate) return null;
    if (p.isOverdue && p.dueDate < days[0]) return firstOpenDay;
    if (p.dueDate < days[0] || p.dueDate > days[days.length - 1]) return null;
    return p.dueDate;
  };
  const backlogElsewhere = data.pendingRequests.filter((p) => pendingDay(p) === null);
  // Controller can accept/reject a proposed block, or remove a live one that hasn't run yet.
  const canDecide = (a: ScheduleAssignment) =>
    role === "CONTROLLER" && Boolean(a.planId) && (a.planStatus === "pending_approval" || a.planStatus === "approved") && new Date(a.allocatedEnd).getTime() > Date.now();

  // A flagged job's block cancels the trains it overlaps: the fault is too
  // severe for trains to pass while the repair is on. Only that block —
  // every other passage runs as timetabled.
  const cancellingBlocks = data.assignments.filter((a) => a.trafficSuspended && (!a.planStatus || a.planStatus === "approved" || Boolean(planId)));
  const cancelledBy = (day: string, depMin: number, arrMin: number): ScheduleAssignment | null => {
    for (const a of cancellingBlocks) {
      if (!overlapsDay(a.allocatedStart, a.allocatedEnd, day)) continue;
      const [s, e] = minutesOn(a.allocatedStart, a.allocatedEnd, day);
      if (depMin < e && arrMin > s) return a;
    }
    return null;
  };
  const cancelledInView = days.reduce((n, day) => {
    const trains = data.traversals.filter((t) => (!t.effectiveFrom || t.effectiveFrom <= day) && (!t.effectiveTo || day < t.effectiveTo));
    return n + trains.filter((t) => cancelledBy(day, t.departMin, t.arriveMin)).length;
  }, 0);
  const closureLabel = (a: ScheduleAssignment) =>
    `${a.department} ${(a.defectType ?? "").replace(/_/g, " ")} block ${fmtTime(a.allocatedStart)}–${fmtTime(a.allocatedEnd)} (#${(a.defectId ?? "").slice(0, 8).toUpperCase()}) — section unsafe for trains while the repair is on`;
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
        {cancelledInView > 0 && (
          <span className="flex items-center gap-1 text-red-400">
            <span className="w-1 h-2.5 inline-block" style={{ background: CANCELLED_TRAIN }} /> Cancelled / postponed for a block ({cancelledInView} in view)
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
          const isPast = day < todayKey;
          // Trains of the timetable version in force on this day.
          const dayTrains = data.traversals.filter((t) => (!t.effectiveFrom || t.effectiveFrom <= day) && (!t.effectiveTo || day < t.effectiveTo));
          const dayGoods = data.goodsForecasts.filter((g) => dateKey(g.bandStart) === day);
          let dayWindows = data.windows.filter((w) => dateKey(w.windowStart) === day);
          if (isPast && dayWindows.length === 0 && dayTrains.length > 0) {
            // The stored window calendar only starts on the day the pipeline
            // ran; a past day is drawn as it was by rebuilding its free
            // windows from the same timetable gaps.
            const busy: Array<[number, number]> = [...dayTrains.map((t): [number, number] => [t.departMin, Math.min(t.arriveMin, 1440)]), ...dayGoods.map((g) => minutesOf(g.bandStart, g.bandEnd))];
            dayWindows = uncovered(busy)
              .filter(([a, b]) => b - a >= MIN_BLOCK_MIN)
              .map(([a, b]) => ({ windowId: `past-${day}-${a}`, corridorId: corridorId, windowStart: istIso(day, a), windowEnd: istIso(day, b), maxConcurrentDepts: 3 }));
          }
          const dayAssignments = data.assignments.filter((a) => overlapsDay(a.allocatedStart, a.allocatedEnd, day));
          const { lanes, count: laneCount } = assignLanes(dayAssignments);
          const laneH = 24 / laneCount;
          const dayPending = data.pendingRequests.filter((p) => (p.requestedWindowStart && p.requestedWindowEnd ? overlapsDay(p.requestedWindowStart, p.requestedWindowEnd, day) : pendingDay(p) === day));
          const sortedWindows = [...dayWindows].sort((a, b) => a.windowStart.localeCompare(b.windowStart));
          const isHighlightDay = day === highlightDay;
          const hasCalendar = dayWindows.length > 0 || dayGoods.length > 0 || (isPast && dayTrains.length > 0);
          const covered: Array<[number, number]> = [
            ...dayWindows.map((w) => minutesOf(w.windowStart, w.windowEnd)),
            ...dayGoods.map((g) => minutesOf(g.bandStart, g.bandEnd)),
            ...(hasCalendar ? dayTrains.map((t): [number, number] => [t.departMin, Math.min(t.arriveMin, 1440)]) : []),
          ];
          const gaps = hasCalendar ? uncovered(covered) : [];
          return (
            <div key={day} className={`flex items-center gap-2 px-3 py-1.5 ${isHighlightDay ? "bg-amber-500/10" : ""} ${isPast ? "opacity-70" : ""}`} title={isPast ? "Past day — shown as it was; read-only" : undefined}>
              <span className="w-28 shrink-0 text-[11px] text-ops-muted mono">
                {new Date(day + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                {isPast && <span className="block text-[9px] uppercase tracking-wide text-ops-muted/80">past · read-only</span>}
              </span>
              <div className="relative flex-1 h-8 bg-ops-inset-strong border border-ops-border/60">
                <HourGrid />
                {!hasCalendar && (
                  <div
                    className="absolute inset-0 flex items-center justify-center text-[11px] text-ops-muted"
                    style={{ background: PAST_DAY_STYLE }}
                    title="No block-window calendar for this day yet (calendar covers 35 days from the last pipeline run)"
                  >
                    no calendar
                  </div>
                )}
                {gaps.map(([a, b]) => (
                  <div
                    key={`gap-${a}`}
                    className="absolute top-0 h-full cursor-pointer"
                    onClick={() => pick({ kind: "gap", day, from: a, to: b })}
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
                    className="absolute top-0 h-full cursor-pointer"
                    onClick={() => pick({ kind: "goods", g, day })}
                    style={{ left: `${(minuteOfDay(g.bandStart) / 1440) * 100}%`, width: `${widthPct(g.bandStart, g.bandEnd)}%`, background: GOODS_HATCH }}
                    title={`Goods forecast (${g.source}): ${g.trainCount} train${g.trainCount === 1 ? "" : "s"} expected ${fmtTime(g.bandStart)}–${fmtTime(g.bandEnd)} — not available for blocks`}
                  />
                ))}
                {dayWindows.flatMap((w) => {
                  // What's left of the window once the blocks in it are
                  // taken out — the free part shrinks as jobs are placed.
                  const [ws, we] = minutesOf(w.windowStart, w.windowEnd);
                  const taken = dayAssignments.map((a) => minutesOn(a.allocatedStart, a.allocatedEnd, day)).filter(([s, e]) => s < we && e > ws);
                  const free = uncovered([[0, ws], [we, 1440], ...taken]).filter(([s, e]) => s < we && e > ws && e - s >= 1);
                  const selectedHere = selected?.kind === "window" && selected.w.windowId === w.windowId;
                  return free.map(([s, e]) => {
                    const usable = e - s >= MIN_BLOCK_MIN;
                    return (
                      <div
                        key={`${w.windowId}-${s}`}
                        className={`absolute top-0 h-full cursor-pointer ${usable ? "bg-ops-window border-l border-r border-ops-outline/50" : ""} ${selectedHere ? "ring-2 ring-ops-text ring-inset" : ""}`}
                        onClick={() => pick({ kind: "window", w, day })}
                        style={{ left: `${(s / 1440) * 100}%`, width: `${((e - s) / 1440) * 100}%`, ...(usable ? {} : { background: SHORT_GAP_STYLE }) }}
                        title={
                          usable
                            ? `Free ${fmtMin(s)}–${fmtMin(e)}${taken.length ? ` (what's left of the ${fmtTime(w.windowStart)}–${fmtTime(w.windowEnd)} window around its blocks)` : ""} — any number of jobs may share it if their kinds of work are compatible`
                            : `${fmtMin(s)}–${fmtMin(e)}: only ${e - s} min left of this window beside its blocks — too short for another possession`
                        }
                      />
                    );
                  });
                })}
                {hasCalendar &&
                  dayTrains.map((t) => {
                    const cancelled = cancelledBy(day, t.departMin, t.arriveMin);
                    const name = `Train ${t.trainNumber}${t.trainName ? ` ${t.trainName}` : ""} (${t.direction.toUpperCase()}) on this section ${fmtMin(t.departMin)}–${fmtMin(t.arriveMin)}`;
                    return (
                      <div
                        key={`${t.trainNumber}-${t.departMin}`}
                        onClick={() => pick({ kind: "train", t, day, cancelledBy: cancelled })}
                        className={`absolute top-0 h-full cursor-pointer ${cancelled ? "opacity-70" : "opacity-80"} ${selected?.kind === "train" && selected.day === day && selected.t.trainNumber === t.trainNumber && selected.t.departMin === t.departMin ? "ring-2 ring-ops-text z-10" : ""}`}
                        style={{ left: `${(t.departMin / 1440) * 100}%`, width: `${Math.max(((t.arriveMin - t.departMin) / 1440) * 100, cancelled ? 0.4 : 0.25)}%`, background: cancelled ? CANCELLED_TRAIN : TRAIN_COLOR }}
                        title={cancelled ? `${name} — CANCELLED / POSTPONED: ${closureLabel(cancelled)}` : `${name} — no block possible`}
                      />
                    );
                  })}
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
                      onClick={() => pick({ kind: "block", a })}
                      className={`absolute cursor-pointer ${a.trafficSuspended ? "outline outline-1 outline-dashed outline-red-400" : ""} ${isHighlight ? "ring-2 ring-ops-highlight z-10" : ""} ${a.decision === "accepted" ? "ring-2 ring-emerald-400 z-10" : ""} ${selected?.kind === "block" && selected.a.assignmentId === a.assignmentId ? "ring-2 ring-ops-text z-20" : ""} ${isProposed ? "border border-dashed border-ops-outline opacity-60" : ""} ${partners.length && !isHighlight ? "outline outline-1 outline-ops-outline" : ""}`}
                      style={{
                        left: `${(minutesOn(a.allocatedStart, a.allocatedEnd, day)[0] / 1440) * 100}%`,
                        width: `${Math.max(((minutesOn(a.allocatedStart, a.allocatedEnd, day)[1] - minutesOn(a.allocatedStart, a.allocatedEnd, day)[0]) / 1440) * 100, 0.6)}%`,
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
                        onClick={() => pick({ kind: "request", p, day, fit: null })}
                        className={`absolute top-0.5 h-5 border border-amber-400/70 cursor-pointer ${selected?.kind === "request" && selected.p.defectId === p.defectId ? "ring-2 ring-ops-text z-10" : ""}`}
                        style={{ left: `${(minutesOn(p.requestedWindowStart, p.requestedWindowEnd, day)[0] / 1440) * 100}%`, width: `${Math.max(((minutesOn(p.requestedWindowStart, p.requestedWindowEnd, day)[1] - minutesOn(p.requestedWindowStart, p.requestedWindowEnd, day)[0]) / 1440) * 100, 0.6)}%`, background: REQUESTED_HATCH }}
                        title={`Requested (not yet placed) at the time asked for: ${label} · ${fmtDateTimeIST(p.requestedWindowStart)}–${fmtDateTimeIST(p.requestedWindowEnd)}${dateKey(p.requestedWindowStart) !== dateKey(p.requestedWindowEnd) ? " (runs past midnight — shown on both days)" : ""}`}
                      />
                    );
                  }
                  const mins = Math.round(p.estimatedBlockHours * 60);
                  const fit = sortedWindows.find((w) => (new Date(w.windowEnd).getTime() - new Date(w.windowStart).getTime()) / 60000 >= mins);
                  const left = fit ? minuteOfDay(fit.windowStart) : 0;
                  return (
                    <div
                      key={p.defectId}
                      onClick={() => pick({ kind: "request", p, day, fit: fit ?? null })}
                      className={`absolute h-2 border cursor-pointer ${fit ? "border-amber-400/70" : "border-red-400"} ${selected?.kind === "request" && selected.p.defectId === p.defectId ? "ring-2 ring-ops-text z-10" : ""}`}
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
      {selected?.kind === "block" && (
        <BlockDetail
          a={selected.a}
          partners={selected.a.jointBlockGroupId ? data.assignments.filter((o) => o.jointBlockGroupId === selected.a.jointBlockGroupId && o.assignmentId !== selected.a.assignmentId) : []}
          canDecide={canDecide(selected.a)}
          onClose={() => setSelected(null)}
          onDecided={() => {
            setSelected(null);
            setReloadKey((k) => k + 1);
            bumpPlanRevision();
            useAppStore.getState().fetchRequests();
          }}
        />
      )}
      {selected && selected.kind !== "block" && (
        <ElementDetail
          sel={selected}
          data={data}
          canAct={role === "CONTROLLER"}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            setReloadKey((k) => k + 1);
            bumpPlanRevision();
            useAppStore.getState().fetchRequests();
            useAppStore.getState().fetchModifications();
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

/** Anything on the Gantt that can be clicked open. */
type Sel =
  | { kind: "block"; a: ScheduleAssignment }
  | { kind: "window"; w: CorridorBlockWindow; day: string }
  | { kind: "train"; t: ScheduleTraversal; day: string; cancelledBy: ScheduleAssignment | null }
  | { kind: "goods"; g: GoodsForecastBand; day: string }
  | { kind: "request"; p: SchedulePendingRequest; day: string; fit: CorridorBlockWindow | null }
  | { kind: "gap"; day: string; from: number; to: number };

function sameSel(a: Sel, b: Sel): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "block":
      return a.a.assignmentId === (b as typeof a).a.assignmentId;
    case "window":
      return a.w.windowId === (b as typeof a).w.windowId;
    case "train":
      return a.day === (b as typeof a).day && a.t.trainNumber === (b as typeof a).t.trainNumber && a.t.departMin === (b as typeof a).t.departMin;
    case "goods":
      return a.g.forecastId === (b as typeof a).g.forecastId;
    case "request":
      return a.p.defectId === (b as typeof a).p.defectId;
    case "gap":
      return a.day === (b as typeof a).day && a.from === (b as typeof a).from;
  }
}

function Panel({ title, chip, onClose, children }: { title: React.ReactNode; chip?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="border-t border-ops-border bg-ops-inset px-3 py-2 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold text-ops-text">{title}</span>
        {chip}
        <button onClick={onClose} className="ml-auto text-[11px] text-ops-muted hover:text-ops-text">close ✕</button>
      </div>
      {children}
    </div>
  );
}

const dayLabel = (day: string) => new Date(day + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const hoursOf = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3.6e6;

/** Details for a window, train, goods band, pending request or unusable gap. */
function ElementDetail({ sel, data, canAct, onClose, onChanged }: { sel: Exclude<Sel, { kind: "block" }>; data: CorridorSchedule; canAct: boolean; onClose: () => void; onChanged: () => void }) {
  if (sel.kind === "window") {
    const { w, day } = sel;
    const inside = data.assignments.filter((a) => new Date(a.allocatedStart) < new Date(w.windowEnd) && new Date(a.allocatedEnd) > new Date(w.windowStart));
    const cap = hoursOf(w.windowStart, w.windowEnd);
    const byDept: Record<string, number> = {};
    for (const a of inside) byDept[a.department] = (byDept[a.department] ?? 0) + hoursOf(a.allocatedStart, a.allocatedEnd);
    const goods = data.goodsForecasts.filter((g) => dateKey(g.bandStart) === day && new Date(g.bandStart) < new Date(w.windowEnd) && new Date(g.bandEnd) > new Date(w.windowStart));
    return (
      <Panel title="Free window" chip={<span className="text-[10px] uppercase text-ops-muted">{dayLabel(day)}</span>} onClose={onClose}>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-x-4 gap-y-1.5">
          <Field k="Time" v={`${fmtTime(w.windowStart)} – ${fmtTime(w.windowEnd)}`} />
          <Field k="Length" v={`${cap.toFixed(2)} h`} />
          <Field k="Blocks in it" v={inside.length ? `${inside.length} (${[...new Set(inside.map((a) => a.department))].join(", ")})` : "none — empty"} />
          {(["ENGG", "SIGNAL", "TRD"] as const).map((d) => (
            <Field key={d} k={`${d} capacity left`} v={`${Math.max(cap - (byDept[d] ?? 0), 0).toFixed(2)} h`} />
          ))}
        </div>
        <p className="text-[11px] text-ops-muted">
          A gap between timetabled trains long enough for a block (≥ {MIN_BLOCK_MIN} min){goods.length ? `, after ${goods.length} goods forecast band${goods.length === 1 ? "" : "s"} were carved out` : ""}. Departments work in
          parallel inside it; each department's own jobs queue back to back, so a department can use up to the full length. Any number of jobs may share it if their kinds of work are
          compatible.
        </p>
        {inside.length > 0 && (
          <p className="text-[11px] text-ops-muted">
            Holding:{" "}
            {inside.map((a, i) => (
              <span key={a.assignmentId}>
                {i > 0 ? "; " : ""}
                <span className="font-semibold" style={{ color: DEPT_COLOR[a.department] }}>{a.department}</span> {(a.defectType ?? "").replace(/_/g, " ")} {fmtTime(a.allocatedStart)}–{fmtTime(a.allocatedEnd)}
              </span>
            ))}
          </p>
        )}
      </Panel>
    );
  }
  if (sel.kind === "train") {
    const { t, day, cancelledBy } = sel;
    return (
      <Panel
        title={`Train ${t.trainNumber}${t.trainName ? ` · ${t.trainName}` : ""}`}
        chip={cancelledBy ? <span className="text-[10px] font-semibold uppercase text-red-400 border border-red-400/40 px-1.5 py-px">Cancelled / postponed</span> : <span className="text-[10px] uppercase text-ops-muted">runs as timetabled</span>}
        onClose={onClose}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-x-4 gap-y-1.5">
          <Field k="Day" v={dayLabel(day)} />
          <Field k="Direction" v={t.direction.toUpperCase()} />
          <Field k="On this section" v={`${fmtMin(t.departMin)} – ${fmtMin(t.arriveMin)}`} />
          <Field k="Run time" v={`${t.arriveMin - t.departMin} min`} />
          <Field k="Timetable" v={t.effectiveFrom && t.effectiveFrom > "1900-01-02" ? `version from ${t.effectiveFrom}${t.effectiveTo ? ` until ${t.effectiveTo}` : ""}` : "bundled default"} />
        </div>
        <p className="text-[11px] text-ops-muted">
          {cancelledBy
            ? `Cancelled or postponed for the ${cancelledBy.department} ${(cancelledBy.defectType ?? "").replace(/_/g, " ")} block ${fmtTime(cancelledBy.allocatedStart)}–${fmtTime(cancelledBy.allocatedEnd)} (#${(cancelledBy.defectId ?? "").slice(0, 8).toUpperCase()}): the fault is unsafe for trains while the repair is on.`
            : "No block can be placed over this passage — free windows are the gaps between timetabled trains."}
        </p>
      </Panel>
    );
  }
  if (sel.kind === "goods") {
    const { g, day } = sel;
    return (
      <Panel title="Goods-train forecast" chip={<span className="text-[10px] uppercase text-ops-muted">{dayLabel(day)}</span>} onClose={onClose}>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-x-4 gap-y-1.5">
          <Field k="Band" v={`${fmtTime(g.bandStart)} – ${fmtTime(g.bandEnd)}`} />
          <Field k="Trains expected" v={String(g.trainCount)} />
          <Field k="Source" v={g.source} />
          <Field k="Forecast date" v={g.forecastDate} />
        </div>
        <p className="text-[11px] text-ops-muted">
          Freight paths aren't in the passenger timetable, so the Control Office forecasts them per section and day. This band is treated as occupied: it is carved out of the free windows before the optimizer and
          the request workflow see them, exactly like a timetabled train.
        </p>
      </Panel>
    );
  }
  if (sel.kind === "request") {
    const { p, day, fit } = sel;
    return (
      <Panel
        title={`${p.department} · ${p.defectType.replace(/_/g, " ")}`}
        chip={<span className={`text-[10px] font-semibold uppercase px-1.5 py-px border ${p.isOverdue ? "text-red-400 border-red-400/40" : "text-amber-400 border-amber-400/40"}`}>{p.isOverdue ? "Overdue — not yet placed" : "Requested — not yet placed"}</span>}
        onClose={onClose}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-x-4 gap-y-1.5">
          <Field k="Request" v={<span title={p.defectId}>#{p.defectId.slice(0, 8).toUpperCase()}</span>} />
          <Field k="Severity" v={p.severityCode} />
          <Field k="Duration" v={`${p.estimatedBlockHours.toFixed(2)} h`} />
          <Field k="Due" v={p.dueDate ?? "—"} />
          <Field k="Priority" v={p.priorityScore != null ? `${p.priorityScore.toFixed(0)} / 100` : "not scored yet"} />
          <Field k="Status" v={p.workflowStatus.replace(/_/g, " ")} />
          <Field k="Asked for" v={p.requestedWindowStart && p.requestedWindowEnd ? `${fmtDateTimeIST(p.requestedWindowStart)} – ${fmtTime(p.requestedWindowEnd)}` : "any time"} />
          <Field k="Trains during block" v={p.trafficSuspended ? <span className="text-red-400 font-semibold">CANCELLED / POSTPONED</span> : "run in the gaps"} />
        </div>
        <p className="text-[11px] text-ops-muted">
          {p.requestedWindowStart
            ? "Drawn at the time the department asked for. It is not scheduled: it will be placed there if it fits, offered the nearest alternate, or raised as a bump request."
            : fit
              ? `Drawn on ${dayLabel(day)} in the earliest free window that could take it (from ${fmtTime(fit.windowStart)}) — an indication of where it could go, not a placement. The next solve, the daily sweep or a controller plan will place it.`
              : `No free window on ${dayLabel(day)} is long enough for ${p.estimatedBlockHours.toFixed(2)} h — it needs a longer gap, another day, or a split job.`}
        </p>
        {canAct && <RequestActions p={p} onChanged={onChanged} />}
      </Panel>
    );
  }
  // gap
  const { day, from, to } = sel;
  const short = to - from < MIN_BLOCK_MIN;
  return (
    <Panel title="Not usable for a block" chip={<span className="text-[10px] uppercase text-ops-muted">{dayLabel(day)}</span>} onClose={onClose}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5">
        <Field k="Time" v={`${fmtMin(from)} – ${fmtMin(to)}`} />
        <Field k="Length" v={`${to - from} min`} />
      </div>
      <p className="text-[11px] text-ops-muted">
        {short
          ? `Only ${to - from} minutes between trains — shorter than the ${MIN_BLOCK_MIN}-minute minimum for a possession, so no block can be taken here.`
          : "Long enough on its own, but not offered as a window: a goods-train forecast band clipped the free stretch, or this is the shorter remainder after the longest free stretch of the gap was kept."}
      </p>
    </Panel>
  );
}

/** Controller's options on a request that is still waiting: re-place it (drop the asked-for time, withdraw any open offer, find the earliest fit) or cancel it outright. Both confirm first. */
function RequestActions({ p, onChanged }: { p: SchedulePendingRequest; onChanged: () => void }) {
  const [mode, setMode] = useState<null | "alternate" | "cancel">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "alternate" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ ok: boolean; message?: string }>(`/api/v1/requests/${p.defectId}/${kind === "alternate" ? "find-alternate" : "clear"}`, { reason: reason.trim() || null });
      setMsg(kind === "alternate" ? `Done — ${res.message ?? "re-placed"}.` : "Request cancelled.");
      setTimeout(onChanged, 900);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (msg) return <p className="text-[11px] text-emerald-400">{msg}</p>;
  if (!mode) {
    return (
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <button onClick={() => setMode("alternate")} className="px-2.5 py-1 bg-ops-accent text-white text-[11px]">
          Find an alternate slot
        </button>
        <button onClick={() => setMode("cancel")} className="px-2.5 py-1 border border-red-400/60 text-red-400 text-[11px]">
          Cancel request
        </button>
        <span className="text-[10px] text-ops-muted">
          {p.workflowStatus === "awaiting_dept_response" ? "an alternate is already offered — re-placing withdraws it" : p.workflowStatus === "awaiting_controller" ? "a bump request is pending — re-placing withdraws it" : ""}
        </span>
      </div>
    );
  }
  return (
    <div className={`border p-2.5 space-y-2 ${mode === "cancel" ? "border-red-400/40 bg-red-500/5" : "border-ops-accent/40 bg-ops-raise"}`}>
      <p className="text-xs text-ops-text">
        {mode === "cancel"
          ? `Cancel this ${p.department} request entirely? Any open offer or bump for it is closed, it leaves the backlog, and the department is told.`
          : `Look for a different slot? ${p.requestedWindowStart ? "The time it asked for is dropped, " : ""}any open offer or bump is withdrawn, and it is placed into the earliest slot that fits up to its due date — or offered a new alternate / raised as a bump.`}
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional — goes to the department and the log)" className="text-[11px] bg-ops-panel border border-ops-border text-ops-text px-2 py-1 w-80" autoFocus />
        <button disabled={busy} onClick={() => run(mode)} className={`px-2.5 py-1 text-white text-[11px] disabled:opacity-50 ${mode === "cancel" ? "bg-red-600" : "bg-ops-accent"}`}>
          {busy ? "Working…" : mode === "cancel" ? "Yes, cancel it" : "Yes, re-place it"}
        </button>
        <button disabled={busy} onClick={() => setMode(null)} className="px-2.5 py-1 border border-ops-border text-ops-muted text-[11px]">
          Back
        </button>
        {error && <span className="text-[11px] text-red-400">{error}</span>}
      </div>
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
  const [confirming, setConfirming] = useState(false);
  const isProposed = a.planStatus && a.planStatus !== "approved";
  const isLive = a.planStatus === "approved";

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
        <Field k="Trains during block" v={a.trafficSuspended ? <span className="text-red-400 font-semibold">CANCELLED / POSTPONED</span> : "run in the gaps"} />
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
      {canDecide && !confirming && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          {isProposed && a.decision !== "accepted" && (
            <button disabled={busy} onClick={() => decide(true)} className="px-2.5 py-1 bg-emerald-600 text-white text-[11px] disabled:opacity-50">
              Accept block
            </button>
          )}
          <button disabled={busy} onClick={() => setConfirming(true)} className="px-2.5 py-1 border border-red-400/60 text-red-400 text-[11px] disabled:opacity-50">
            {isLive ? "Remove block" : "Reject block"}
          </button>
          {partners.some((p) => p.department !== a.department) && <span className="text-[10px] text-ops-muted">decisions here also teach the compatibility model about its partners</span>}
          {error && <span className="text-[11px] text-red-400">{error}</span>}
        </div>
      )}
      {canDecide && confirming && (
        <div className="border border-red-400/40 bg-red-500/5 p-2.5 space-y-2">
          <p className="text-xs text-ops-text">
            {isLive
              ? `Remove this block from the approved plan? ${a.department}'s job goes back to the backlog (one more deferral, so its priority rises), the department is notified, and automatic placement won't offer it this slot again.`
              : `Reject this proposed block? It is dropped from the proposal and the job stays in the backlog; the rest of the plan is untouched.`}{" "}
            The priority model{partners.some((p) => p.department !== a.department) ? " and the compatibility model" : ""} learn from this decision.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional — goes to the department and the log)" className="text-[11px] bg-ops-panel border border-ops-border text-ops-text px-2 py-1 w-80" autoFocus />
            <button disabled={busy} onClick={() => decide(false)} className="px-2.5 py-1 bg-red-600 text-white text-[11px] disabled:opacity-50">
              {busy ? "Working…" : isLive ? "Yes, remove it" : "Yes, reject it"}
            </button>
            <button disabled={busy} onClick={() => setConfirming(false)} className="px-2.5 py-1 border border-ops-border text-ops-muted text-[11px]">
              Cancel
            </button>
            {error && <span className="text-[11px] text-red-400">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
