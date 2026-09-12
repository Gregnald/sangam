import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { CorridorPicker } from "./CorridorPicker";
import { SnapshotGantt } from "./SnapshotGantt";
import { ModificationList } from "./ModificationList";
import { PlanPeriodBrowser } from "./PlanPeriodBrowser";
import { fmtDate, periodLabelText, planTimeState } from "../lib/dates";
import { useAppStore } from "../store/appStore";
import type { ModelVersion, ModificationRequest, PlanHistoryEntry } from "../types/api";
import { BacklogHistory } from "./BacklogHistory";

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
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-ops-hover">
        <span className="text-xs text-ops-text">
          <span className={entry.snapshotType === "proposed" ? "text-amber-400" : entry.snapshotType === "rejected" ? "text-red-400" : "text-emerald-400"}>
            {entry.snapshotType}
          </span>{" "}
          — {payload.length} block{payload.length === 1 ? "" : "s"}
        </span>
        <span className="text-[10px] text-ops-muted mono">{new Date(entry.snapshotAt).toLocaleString()}</span>
      </button>
      {open && (
        <div className="p-3 space-y-2 bg-ops-inset">
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
      <button onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-ops-hover">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-ops-text" title={periodLabel}>{periodLabelText(horizonType, periodLabel)}</span>
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

const SUB_TABS = ["Plans", "Backlog", "Modifications", "Model versions"] as const;
type SubTab = (typeof SUB_TABS)[number];

function ModelVersions() {
  const [versions, setVersions] = useState<ModelVersion[]>([]);
  useEffect(() => {
    api.get<ModelVersion[]>("/api/v1/plans/models").then(setVersions);
  }, []);
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ops-muted">
        Every retrain of the priority ranker. A candidate is promoted only when its holdout ranking score is at least as good as the model in use;
        controller approve/reject decisions are folded in as label nudges, so the count of decisions used shows how much human feedback each version learned from.
      </p>
      <div className="border border-ops-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-ops-inset text-ops-muted uppercase text-[10px]">
            <tr>
              <th className="text-left p-2">Trained</th>
              <th className="text-left p-2">Holdout Spearman</th>
              <th className="text-left p-2">Controller decisions used</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Artifact</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ops-border">
            {versions.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-ops-muted">
                  No model versions yet.
                </td>
              </tr>
            )}
            {versions.map((v) => (
              <tr key={v.versionId}>
                <td className="p-2 text-ops-muted mono whitespace-nowrap">{new Date(v.trainedAt).toLocaleString()}</td>
                <td className="p-2 text-ops-text mono">{typeof v.metrics?.holdout_spearman === "number" ? (v.metrics.holdout_spearman as number).toFixed(3) : "—"}</td>
                <td className="p-2 text-ops-text mono">{String(v.metrics?.n_controller_decisions_used ?? "—")}</td>
                <td className={`p-2 font-semibold ${v.promoted ? "text-emerald-400" : "text-ops-muted"}`}>{v.promoted ? "IN USE" : "challenger (kept)"}</td>
                <td className="p-2 text-ops-muted mono truncate max-w-xs" title={v.artifactPath}>
                  {v.artifactPath.split(/[\\/]/).pop()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function HistoryPanel({ scope, department }: { scope: "own" | "all"; department?: string }) {
  const [sub, setSub] = useState<SubTab>("Plans");
  const [entries, setEntries] = useState<PlanHistoryEntry[]>([]);
  const [modifications, setModifications] = useState<ModificationRequest[]>([]);
  const { plans, fetchPlans, zones, fetchZones, selectedZone } = useAppStore();

  useEffect(() => {
    api.get<PlanHistoryEntry[]>("/api/v1/plans/history").then(setEntries);
    api.get<ModificationRequest[]>("/api/v1/modifications").then(setModifications);
    fetchPlans();
    if (zones.length === 0) fetchZones();
  }, [fetchPlans, fetchZones, zones.length]);

  const decided = modifications.filter((m) => m.status === "approved" || m.status === "rejected" || m.status === "lapsed");
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
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-ops-border">
        {SUB_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setSub(t)}
            className={`px-3 py-1.5 text-xs font-medium -mb-px border-b-2 ${sub === t ? "border-ops-accent text-ops-text" : "border-transparent text-ops-muted hover:text-ops-text"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {sub === "Backlog" && <BacklogHistory scope={scope} department={department} />}
      {sub === "Model versions" && <ModelVersions />}
      {sub === "Modifications" && (
        <div>
          <p className="text-[11px] text-ops-muted mb-2">Reschedule offers and priority-bump requests that have been decided — approved, rejected, or lapsed because their window passed.</p>
          <ModificationList items={decided} mode="controller" />
        </div>
      )}

      {sub === "Plans" && (
      <div className="space-y-6">
      <p className="text-[11px] text-ops-muted">
        {scope === "all"
          ? "Every generation and approval of every plan, as proposed and as approved, plus plans that are past, rejected or superseded."
          : `${department ?? "Your department"}'s slice of every plan snapshot, plus plans that are past, rejected or superseded.`}
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

      <PlanPeriodBrowser
        title="Past, rejected & superseded monthly plans"
        horizon="monthly"
        plans={pastMonthly}
        weeklyPlans={plans.filter((wp) => wp.horizonType === "weekly")}
        zones={zones}
        defaultZone={selectedZone}
        emptyText="Nothing here — every monthly plan so far is either still live or awaiting a decision."
      />
      <PlanPeriodBrowser
        title="Past, rejected & superseded weekly plans"
        horizon="weekly"
        plans={pastWeekly}
        weeklyPlans={plans.filter((wp) => wp.horizonType === "weekly")}
        zones={zones}
        defaultZone={selectedZone}
        emptyText="Nothing here — every weekly plan so far is either still live or awaiting a decision."
      />
      </div>
      )}
    </div>
  );
}
