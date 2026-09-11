import { useEffect, useState } from "react";
import { api, qs } from "../lib/api";
import type { CorridorSchedule, ScheduleAssignment } from "../types/api";

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

function dateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function minuteOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

function assignmentTitle(a: ScheduleAssignment, isProposed: boolean, partners: ScheduleAssignment[]): string {
  const lines = [
    `${DEPT_LABEL[a.department] ?? a.department} (${a.department}) — ${(a.defectType ?? "").replace(/_/g, " ")}`,
    `Block: ${fmtTime(a.allocatedStart)}–${fmtTime(a.allocatedEnd)}${a.estimatedBlockHours != null ? ` (${a.estimatedBlockHours.toFixed(2)} h)` : ""}`,
    `Severity ${a.severityCode ?? "?"}${a.speedRestrictionKmph != null ? ` · speed restriction ${a.speedRestrictionKmph} km/h in force` : ""} · due ${fmtDue(a.dueDate)}${a.priorityScore != null ? ` · priority ${a.priorityScore.toFixed(0)}/100` : ""}`,
    `Asset: ${a.assetId ?? "—"} · source: ${a.sourceSystem ? SOURCE_LABEL[a.sourceSystem] ?? a.sourceSystem : "—"}`,
    `Requested by: ${a.requestedBy ?? "—"}${a.planPeriodLabel ? ` · plan ${a.planPeriodLabel}` : ""}${isProposed ? " · PROPOSED (not yet approved)" : " · approved"}`,
  ];
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
  planId?: string | null;
}) {
  const [data, setData] = useState<CorridorSchedule | null>(null);
  const [loading, setLoading] = useState(true);

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
  }, [corridorId, rangeStart, rangeEnd, planId]);

  if (loading) return <p className="text-xs text-ops-muted p-3">Loading schedule…</p>;
  if (!data) return null;

  const days: string[] = [];
  const cursor = new Date(rangeStart + "T00:00:00");
  const end = new Date(rangeEnd + "T00:00:00");
  while (cursor <= end) {
    days.push(dateKey(cursor.toISOString()));
    cursor.setDate(cursor.getDate() + 1);
  }

  const highlightDay = highlightWindowStart ? dateKey(highlightWindowStart) : null;
  const backlogNoTime = data.pendingRequests.filter((p) => !p.requestedWindowStart);
  const todayKey = dateKey(new Date().toISOString());

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
            <span className="w-0.5 h-2.5 inline-block" style={{ background: TRAIN_COLOR }} /> Timetabled train ({data.traversals.length}/day)
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 inline-block border border-ops-border" style={{ background: SHORT_GAP_STYLE }} /> Gap too short for a block (&lt;{MIN_BLOCK_MIN} min)
        </span>
        {highlightWindowStart && (
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 inline-block border-2 border-ops-highlight" /> {highlightLabel ?? (highlightKind === "own" ? "This block" : "Proposed slot for this request")}
          </span>
        )}
        {data.goodsForecasts.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 inline-block" style={{ background: GOODS_HATCH }} /> Goods forecast (COA)
          </span>
        )}
      </div>
      <div className="divide-y divide-ops-border">
        {days.map((day) => {
          const dayWindows = data.windows.filter((w) => dateKey(w.windowStart) === day);
          const dayAssignments = data.assignments.filter((a) => dateKey(a.allocatedStart) === day);
          const { lanes, count: laneCount } = assignLanes(dayAssignments);
          const laneH = 24 / laneCount;
          const dayPending = data.pendingRequests.filter((p) => p.requestedWindowStart && dateKey(p.requestedWindowStart) === day);
          const dayGoods = data.goodsForecasts.filter((g) => dateKey(g.bandStart) === day);
          const isHighlightDay = day === highlightDay;
          const isPast = day < todayKey;
          const hasCalendar = dayWindows.length > 0 || dayGoods.length > 0;
          const covered: Array<[number, number]> = [
            ...dayWindows.map((w) => minutesOf(w.windowStart, w.windowEnd)),
            ...dayGoods.map((g) => minutesOf(g.bandStart, g.bandEnd)),
            ...(hasCalendar ? data.traversals.map((t): [number, number] => [t.departMin, Math.min(t.arriveMin, 1440)]) : []),
          ];
          const gaps = hasCalendar ? uncovered(covered) : [];
          return (
            <div key={day} className={`flex items-center gap-2 px-3 py-1.5 ${isHighlightDay ? "bg-amber-500/10" : ""}`}>
              <span className="w-28 shrink-0 text-[11px] text-ops-muted mono">
                {new Date(day + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </span>
              <div className="relative flex-1 h-8 bg-ops-inset-strong border border-ops-border/60">
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
                    title={`Free window ${fmtTime(w.windowStart)}–${fmtTime(w.windowEnd)} (max ${w.maxConcurrentDepts} depts)`}
                  />
                ))}
                {dayWindows.length > 0 &&
                  data.traversals.map((t) => (
                    <div
                      key={`${t.trainNumber}-${t.departMin}`}
                      className="absolute top-0 h-full opacity-80"
                      style={{ left: `${(t.departMin / 1440) * 100}%`, width: `${Math.max(((t.arriveMin - t.departMin) / 1440) * 100, 0.25)}%`, background: TRAIN_COLOR }}
                      title={`Train ${t.trainNumber}${t.trainName ? ` ${t.trainName}` : ""} (${t.direction.toUpperCase()}) on this section ${fmtMin(t.departMin)}–${fmtMin(t.arriveMin)} — no block possible`}
                    />
                  ))}
                {dayAssignments.map((a) => {
                  const isHighlight =
                    isHighlightDay && highlightWindowStart && Math.abs(new Date(a.allocatedStart).getTime() - new Date(highlightWindowStart).getTime()) < 60000;
                  const isProposed = a.planStatus && a.planStatus !== "approved";
                  const partners = a.jointBlockGroupId ? dayAssignments.filter((o) => o.jointBlockGroupId === a.jointBlockGroupId && o.assignmentId !== a.assignmentId) : [];
                  const lane = lanes.get(a.assignmentId) ?? 0;
                  return (
                    <div
                      key={a.assignmentId}
                      className={`absolute ${isHighlight ? "ring-2 ring-amber-400" : ""} ${isProposed ? "border border-dashed border-ops-outline opacity-60" : ""} ${partners.length ? "outline outline-1 outline-ops-outline" : ""}`}
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
                {dayPending.map((p) =>
                  p.requestedWindowStart && p.requestedWindowEnd ? (
                    <div
                      key={p.defectId}
                      className="absolute top-0.5 h-5 border border-amber-400/70"
                      style={{ left: `${(minuteOfDay(p.requestedWindowStart) / 1440) * 100}%`, width: `${widthPct(p.requestedWindowStart, p.requestedWindowEnd)}%`, background: REQUESTED_HATCH }}
                      title={`Requested: ${p.department} · ${p.defectType.replace(/_/g, " ")} · ${fmtTime(p.requestedWindowStart)}–${fmtTime(p.requestedWindowEnd)}`}
                    />
                  ) : null
                )}
                {isHighlightDay && highlightWindowStart && highlightWindowEnd && highlightKind === "own" && (
                  // Outline only — the bar underneath is the block itself; a
                  // label on top would just cover it.
                  <div
                    className="absolute -top-0.5 -bottom-0.5 border-2 border-ops-highlight pointer-events-none"
                    style={{ left: `${(minuteOfDay(highlightWindowStart) / 1440) * 100}%`, width: `${widthPct(highlightWindowStart, highlightWindowEnd)}%` }}
                  />
                )}
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
      {backlogNoTime.length > 0 && (
        <div className="px-3 py-2 border-t border-ops-border">
          <p className="text-[11px] text-ops-muted mb-1">Also in this corridor's backlog (no specific time requested):</p>
          <div className="flex flex-wrap gap-1.5">
            {backlogNoTime.map((p) => (
              <span key={p.defectId} className="text-[11px] px-1.5 py-0.5 bg-amber-400/20 text-amber-300">
                {p.department} · {p.defectType.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
