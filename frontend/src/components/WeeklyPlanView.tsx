import { useState } from "react";
import { CorridorPicker } from "./CorridorPicker";
import { CorridorGantt } from "./CorridorGantt";

export function WeeklyPlanView({ zone, weekStart, weekEnd, planId }: { zone: string | null; weekStart: string; weekEnd: string; planId?: string | null }) {
  const [corridorId, setCorridorId] = useState<string | null>(null);
  return (
    <div className="p-3 space-y-2 bg-black/10">
      <CorridorPicker zone={zone} value={corridorId} onChange={setCorridorId} />
      {corridorId ? (
        <CorridorGantt corridorId={corridorId} rangeStart={weekStart} rangeEnd={weekEnd} planId={planId} />
      ) : (
        <p className="text-xs text-ops-muted p-3 border border-ops-border">Pick a corridor to see its day-by-day block schedule for this week.</p>
      )}
    </div>
  );
}
