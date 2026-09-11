import { useEffect, useState } from "react";
import { CorridorGantt } from "./CorridorGantt";
import { api, qs } from "../lib/api";
import { addDays, fmtDate, mondayOf, todayIso } from "../lib/dates";
import type { CorridorSchedule } from "../types/api";

export function CorridorSchedulePanel({
  corridorId,
  corridorInfo,
  initialAnchor,
  onClose,
  onSwitchCorridor,
}: {
  corridorId: string;
  corridorInfo: Record<string, unknown> | null;
  initialAnchor?: string | null;
  onClose: () => void;
  onSwitchCorridor?: (corridorId: string) => void;
}) {
  const [anchor, setAnchor] = useState<string>(initialAnchor?.slice(0, 10) || todayIso());
  const [dayDetail, setDayDetail] = useState<CorridorSchedule | null>(null);
  const oppositeCorridorId = corridorInfo?.opposite_corridor_id ? String(corridorInfo.opposite_corridor_id) : null;

  useEffect(() => {
    setAnchor(initialAnchor?.slice(0, 10) || todayIso());
  }, [corridorId, initialAnchor]);

  const weekStart = mondayOf(new Date(anchor + "T00:00:00"));
  const weekEnd = addDays(weekStart, 6);

  useEffect(() => {
    api.get<CorridorSchedule>(`/api/v1/corridors/${corridorId}/schedule${qs({ start: anchor, end: anchor })}`).then(setDayDetail);
  }, [corridorId, anchor]);

  return (
    <div className="border border-ops-border bg-ops-panel">
      <div className="flex items-center justify-between px-3 py-2 border-b border-ops-border">
        <div>
          <p className="text-xs font-semibold text-ops-text mono">{corridorId}</p>
          <p className="text-[10px] text-ops-muted">
            {String(corridorInfo?.direction_label ?? "")}
            {oppositeCorridorId && onSwitchCorridor && (
              <button onClick={() => onSwitchCorridor(oppositeCorridorId)} className="ml-2 text-ops-accent underline">
                view {oppositeCorridorId} (other track)
              </button>
            )}
          </p>
        </div>
        <button onClick={onClose} className="text-ops-muted text-xs">
          ✕
        </button>
      </div>
      <div className="px-3 py-2 flex items-center gap-2 border-b border-ops-border">
        <button onClick={() => setAnchor(fmtDate(addDays(weekStart, -7)))} className="text-[11px] text-ops-muted border border-ops-border px-2 py-1">
          ◀ Prev week
        </button>
        <input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} className="text-xs bg-black/20 border border-ops-border text-ops-text px-2 py-1" />
        <button onClick={() => setAnchor(fmtDate(addDays(weekStart, 7)))} className="text-[11px] text-ops-muted border border-ops-border px-2 py-1">
          Next week ▶
        </button>
      </div>
      <CorridorGantt corridorId={corridorId} rangeStart={fmtDate(weekStart)} rangeEnd={fmtDate(weekEnd)} />
      {dayDetail && (
        <div className="px-3 py-2 border-t border-ops-border">
          <p className="text-[10px] text-ops-muted mb-1">Who's working on {anchor}:</p>
          {dayDetail.assignments.length === 0 ? (
            <p className="text-[11px] text-ops-muted">No allocated blocks that day.</p>
          ) : (
            <ul className="space-y-1">
              {dayDetail.assignments.map((a) => (
                <li key={a.assignmentId} className="text-[11px] text-ops-text">
                  <span className="font-semibold">{a.department}</span> — {(a.defectType ?? "").replace(/_/g, " ")} ·{" "}
                  {new Date(a.allocatedStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–
                  {new Date(a.allocatedEnd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {a.requestedBy ? ` · requested by ${a.requestedBy}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
