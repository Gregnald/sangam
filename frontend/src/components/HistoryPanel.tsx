import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { CorridorPicker } from "./CorridorPicker";
import { SnapshotGantt } from "./SnapshotGantt";
import { ModificationList } from "./ModificationList";
import { MonthPlanCard } from "./MonthPlanCard";
import { WeeklyPlanRow } from "./WeeklyPlanRow";
import { fmtDate, planTimeState } from "../lib/dates";
import { useAppStore } from "../store/appStore";
import type { ModificationRequest, PlanHistoryEntry } from "../types/api";

interface SnapshotRow {
  corridor_id: string;
  department: string;
  allocated_start: string;
  allocated_end: string;
  defect_type?: string;
  severity_code?: string;
}

function groupByPeriod(entries: PlanHistoryEntry[]): Map<string, PlanHistoryEntry[]> {
  const map = new Map<string, PlanHistoryEntry[]>();
  for (const e of entries) {
    const key = `${e.horizonType}::${e.periodLabel}`;
    const bucket = map.get(key);
    if (bucket) bucket.push(e);
    else map.set(key, [e]);
  }
  return map;
}

function periodRange(entry: PlanHistoryEntry): { start: string; end: string } {
  const payload = (entry.payload as SnapshotRow[]) ?? [];
  if (payload.length === 0) {
    const today = fmtDate(new Date());
    return { start: today, end: today };
  }
  const starts = payload.map((r) => new Date(r.allocated_start).getTime());
  const ends = payload.map((r) => new Date(r.allocated_end).getTime());
  return { start: fmtDate(new Date(Math.min(...starts))), end: fmtDate(new Date(Math.max(...ends))) };
}

function SnapshotRowView({ entry }: { entry: PlanHistoryEntry }) {
  const [open, setOpen] = useState(false);
  const [corridorId, setCorridorId] = useState<string | null>(null);
  const payload = (entry.payload as SnapshotRow[]) ?? [];
  const range = periodRange(entry);
  const filtered = corridorId ? payload.filter((r) => r.corridor_id === corridorId) : [];

  return (
    <div className="border border-ops-border">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/5">
        <span className="text-xs text-ops-text">
          <span className={entry.snapshotType === "proposed" ? "text-amber-400" : entry.snapshotType === "rejected" ? "text-red-400" : "text-emerald-400"}>
            {entry.snapshotType}
          </span>{" "}
          — {payload.length} block{payload.length === 1 ? "" : "s"}
        </span>
        <span className="text-[10px] text-ops-muted mono">{new Date(entry.snapshotAt).toLocaleString()}</span>
      </button>
      {open && (
        <div className="p-3 space-y-2 bg-black/10">
          <CorridorPicker zone={null} value={corridorId} onChange={setCorridorId} />
          {corridorId ? (
            <SnapshotGantt rows={filtered} rangeStart={range.start} rangeEnd={range.end} />
          ) : (
            <p className="text-xs text-ops-muted p-3 border border-ops-border">Pick a corridor to see this snapshot's day-by-day schedule.</p>
          )}
        </div>
      )}
    </div>
  );
}

function PeriodCard({ periodKey, entries, isCurrentlyActive }: { periodKey: string; entries: PlanHistoryEntry[]; isCurrentlyActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [horizonType, periodLabel] = periodKey.split("::");
  const sorted = [...entries].sort((a, b) => b.snapshotAt.localeCompare(a.snapshotAt));

  return (
    <div className="border border-ops-border">
      <button onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-white/5">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-ops-text mono">{periodLabel}</span>
          <span className="text-[10px] text-ops-muted uppercase">{horizonType}</span>
          {isCurrentlyActive && <span className="text-[10px] font-semibold text-emerald-400 border border-emerald-400/40 px-1.5 py-0.5">CURRENTLY ACTIVE</span>}
        </div>
        <span className="text-ops-muted text-[10px]">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="border-t border-ops-border p-2 space-y-1.5">
          {sorted.map((e) => (
            <SnapshotRowView key={e.historyId} entry={e} />
          ))}
        </div>
      )}
    </div>
  );
}

export function HistoryPanel({ scope, department }: { scope: "own" | "all"; department?: string }) {
  const [entries, setEntries] = useState<PlanHistoryEntry[]>([]);
  const [modifications, setModifications] = useState<ModificationRequest[]>([]);
  const { plans, fetchPlans } = useAppStore();

  useEffect(() => {
    api.get<PlanHistoryEntry[]>("/api/v1/plans/history").then(setEntries);
    api.get<ModificationRequest[]>("/api/v1/modifications").then(setModifications);
    fetchPlans();
  }, [fetchPlans]);

  const decided = modifications.filter((m) => m.status === "approved" || m.status === "rejected");
  const groups = Array.from(groupByPeriod(entries).entries()).sort((a, b) => b[0].localeCompare(a[0]));

  const activePeriodKeys = new Set(
    plans.filter((p) => p.status === "approved" && planTimeState(p.horizonStart, p.horizonEnd) !== "past").map((p) => `${p.horizonType}::${p.periodLabel}`)
  );

  // Rejected, superseded, or approved-but-already-over — everything that
  // isn't live or awaiting a decision belongs here rather than cluttering
  // the Plans tab, which only shows what's still actionable.
  const isDone = (p: (typeof plans)[number]) =>
    p.status === "rejected" || p.status === "superseded" || (p.status === "approved" && planTimeState(p.horizonStart, p.horizonEnd) === "past");
  const pastMonthly = plans.filter((p) => p.horizonType === "monthly" && isDone(p)).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const pastWeekly = plans.filter((p) => p.horizonType === "weekly" && isDone(p)).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));

  return (
    <div className="space-y-6">
      <p className="text-[11px] text-ops-muted">
        {scope === "all"
          ? "Every department's schedule history and decided modification requests."
          : `${department ?? "Your department"}'s own schedule history and decided modification requests.`}
      </p>

      <div>
        <h3 className="text-xs font-semibold text-ops-text mb-2">Schedule History</h3>
        <div className="space-y-1.5">
          {groups.length === 0 && <p className="text-xs text-ops-muted p-4 border border-ops-border">No history yet.</p>}
          {groups.map(([key, es]) => (
            <PeriodCard key={key} periodKey={key} entries={es} isCurrentlyActive={activePeriodKeys.has(key)} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-ops-text mb-2">Past, Rejected &amp; Superseded Plans</h3>
        <div className="space-y-2">
          {pastMonthly.length === 0 && pastWeekly.length === 0 && (
            <p className="text-xs text-ops-muted p-4 border border-ops-border">Nothing here — every plan so far is either still live or awaiting a decision.</p>
          )}
          {pastMonthly.map((p) => (
            <MonthPlanCard key={p.planId} plan={p} weeklyPlans={plans.filter((wp) => wp.horizonType === "weekly")} />
          ))}
          {pastWeekly.map((p) => (
            <WeeklyPlanRow key={p.planId} planId={p.planId} periodLabel={p.periodLabel} status={p.status} zone={p.zone} horizonStart={p.horizonStart} horizonEnd={p.horizonEnd} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-ops-text mb-2">Modification Requests History</h3>
        <ModificationList items={decided} mode="controller" />
      </div>
    </div>
  );
}
