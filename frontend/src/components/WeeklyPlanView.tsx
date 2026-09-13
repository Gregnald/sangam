import { useEffect, useState } from "react";
import { api, qs } from "../lib/api";
import { useAppStore } from "../store/appStore";
import { CorridorPicker } from "./CorridorPicker";
import { CorridorGantt } from "./CorridorGantt";

export function WeeklyPlanView({ zone, weekStart, weekEnd, planId }: { zone: string | null; weekStart: string; weekEnd: string; planId?: string | null }) {
  const [corridorId, setCorridorId] = useState<string | null>(null);
  // Blocks per corridor for this week, from the same plan(s) the Gantt
  // draws — shown in the corridor picker so the corridors with work on them
  // can be found without opening each one.
  const [blockCounts, setBlockCounts] = useState<Record<string, number>>({});
  const planRevision = useAppStore((s) => s.planRevision);

  useEffect(() => {
    if (!zone) return;
    let cancelled = false;
    api
      .get<Record<string, number>>(`/api/v1/corridors/block-counts${qs({ zone, start: weekStart, end: weekEnd, planId: planId ?? undefined })}`)
      .then((counts) => {
        if (!cancelled) setBlockCounts(counts);
      })
      .catch(() => {
        if (!cancelled) setBlockCounts({});
      });
    return () => {
      cancelled = true;
    };
  }, [zone, weekStart, weekEnd, planId, planRevision]);

  return (
    <div className="p-3 space-y-2 bg-ops-inset">
      <CorridorPicker zone={zone} value={corridorId} onChange={setCorridorId} lockZone blockCounts={blockCounts} />
      {corridorId ? (
        <CorridorGantt corridorId={corridorId} rangeStart={weekStart} rangeEnd={weekEnd} planId={planId} />
      ) : (
        <p className="text-xs text-ops-muted p-3 border border-ops-border">Select a corridor.</p>
      )}
    </div>
  );
}
