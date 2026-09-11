import { useEffect, useState } from "react";
import { api, qs } from "../lib/api";
import type { CorridorSchedule } from "../types/api";

const DEPT_COLOR: Record<string, string> = { ENGG: "#2563eb", SIGNAL: "#9333ea", TRD: "#ea580c" };

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

export function CorridorGantt({
  corridorId,
  rangeStart,
  rangeEnd,
  highlightWindowStart,
  highlightWindowEnd,
  planId,
}: {
  corridorId: string;
  rangeStart: string;
  rangeEnd: string;
  highlightWindowStart?: string | null;
  highlightWindowEnd?: string | null;
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

  return (
    <div className="border border-ops-border">
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-ops-border text-[10px] text-ops-muted">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 inline-block" style={{ background: "#2563eb" }} /> Allocated
        </span>
        {planId && (
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 inline-block border border-dashed border-blue-400" style={{ background: "rgba(37,99,235,0.35)" }} /> Proposed (not yet approved)
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 inline-block" style={{ background: REQUESTED_HATCH }} /> Requested (not yet placed)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-white/10 border border-ops-border inline-block" /> Free window
        </span>
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
          const dayPending = data.pendingRequests.filter((p) => p.requestedWindowStart && dateKey(p.requestedWindowStart) === day);
          const dayGoods = data.goodsForecasts.filter((g) => dateKey(g.bandStart) === day);
          const isHighlightDay = day === highlightDay;
          return (
            <div key={day} className={`flex items-center gap-2 px-3 py-1.5 ${isHighlightDay ? "bg-amber-500/10" : ""}`}>
              <span className="w-24 shrink-0 text-[10px] text-ops-muted mono">
                {new Date(day + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </span>
              <div className="relative flex-1 h-6 bg-black/20">
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
                    className="absolute top-0 h-full bg-white/5 border-l border-r border-white/10"
                    style={{ left: `${(minuteOfDay(w.windowStart) / 1440) * 100}%`, width: `${widthPct(w.windowStart, w.windowEnd)}%` }}
                    title={`Free window ${fmtTime(w.windowStart)}–${fmtTime(w.windowEnd)} (max ${w.maxConcurrentDepts} depts)`}
                  />
                ))}
                {dayAssignments.map((a) => {
                  const isHighlight =
                    isHighlightDay && highlightWindowStart && Math.abs(new Date(a.allocatedStart).getTime() - new Date(highlightWindowStart).getTime()) < 60000;
                  const isProposed = a.planStatus && a.planStatus !== "approved";
                  return (
                    <div
                      key={a.assignmentId}
                      className={`absolute top-0.5 h-5 ${isHighlight ? "ring-2 ring-amber-400" : ""} ${isProposed ? "border border-dashed border-white/60 opacity-60" : ""}`}
                      style={{ left: `${(minuteOfDay(a.allocatedStart) / 1440) * 100}%`, width: `${widthPct(a.allocatedStart, a.allocatedEnd)}%`, background: DEPT_COLOR[a.department] ?? "#2563eb" }}
                      title={`${a.department} · ${(a.defectType ?? "").replace(/_/g, " ")} · ${fmtTime(a.allocatedStart)}–${fmtTime(a.allocatedEnd)}${a.requestedBy ? ` · requested by ${a.requestedBy}` : ""}${isProposed ? " · PROPOSED (not yet approved)" : ""}`}
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
                {isHighlightDay && highlightWindowStart && highlightWindowEnd && (
                  <div
                    className="absolute top-0 h-full border-2 border-amber-400 pointer-events-none"
                    style={{ left: `${(minuteOfDay(highlightWindowStart) / 1440) * 100}%`, width: `${widthPct(highlightWindowStart, highlightWindowEnd)}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      {backlogNoTime.length > 0 && (
        <div className="px-3 py-2 border-t border-ops-border">
          <p className="text-[10px] text-ops-muted mb-1">Also in this corridor's backlog (no specific time requested):</p>
          <div className="flex flex-wrap gap-1.5">
            {backlogNoTime.map((p) => (
              <span key={p.defectId} className="text-[10px] px-1.5 py-0.5 bg-amber-400/20 text-amber-300">
                {p.department} · {p.defectType.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
