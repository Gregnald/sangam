import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { CorridorPicker } from "./CorridorPicker";
import { SnapshotGantt } from "./SnapshotGantt";
import { ModificationList } from "./ModificationList";
import { PlanPeriodBrowser } from "./PlanPeriodBrowser";
import { fmtDate, periodLabelText, planTimeState, IST_TZ } from "../lib/dates";
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
    const key = `${e.horizonType}::${e.periodLabel}::${e.zone ?? ""}`;
    const bucket = map.get(key);
    if (bucket) bucket.push(e);
    else map.set(key, [e]);
  }
  return map;
}

/** Every snapshot of one plan, oldest first. */
function groupByPlan(entries: PlanHistoryEntry[]): PlanHistoryEntry[][] {
  const map = new Map<string, PlanHistoryEntry[]>();
  for (const e of entries) {
    const bucket = map.get(e.planId);
    if (bucket) bucket.push(e);
    else map.set(e.planId, [e]);
  }
  return [...map.values()].map((es) => es.sort((a, b) => a.snapshotAt.localeCompare(b.snapshotAt)));
}

const SNAPSHOT_TONE: Record<string, string> = { proposed: "text-amber-400 border-amber-400/40", final: "text-emerald-400 border-emerald-400/40", rejected: "text-red-400 border-red-400/40" };
const SNAPSHOT_LABEL: Record<string, string> = { proposed: "as proposed", final: "as approved", rejected: "rejected" };
const PLAN_STATUS_TONE: Record<string, string> = { approved: "text-emerald-400", pending_approval: "text-amber-400", rejected: "text-red-400", superseded: "text-ops-muted" };

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

/** One plan: its versions (as proposed → as approved / rejected) as chips; expand to browse a version's schedule. */
function PlanVersionsRow({ snapshots }: { snapshots: PlanHistoryEntry[] }) {
  const [open, setOpen] = useState(false);
  const latest = snapshots[snapshots.length - 1];
  const [selectedId, setSelectedId] = useState(latest.historyId);
  const [corridorId, setCorridorId] = useState<string | null>(null);
  const selected = snapshots.find((s) => s.historyId === selectedId) ?? latest;
  const payload = (selected.payload as SnapshotRow[]) ?? [];
  const range = periodRange(selected);
  const filtered = corridorId ? payload.filter((r) => r.corridor_id === corridorId) : [];
  // Blocks per corridor in this version, so the picker lists the corridors
  // that actually carry work first and says how much.
  const blockCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of payload) counts[r.corridor_id] = (counts[r.corridor_id] ?? 0) + 1;
    return counts;
  }, [payload]);
  const status = latest.planStatus ?? "";
  const by = latest.approvedBy;
  const when = latest.generatedAt ?? snapshots[0].snapshotAt;

  return (
    <div className="border border-ops-border">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-ops-hover flex-wrap">
        <span className="flex items-center gap-2 text-xs flex-wrap">
          <span className="text-ops-muted mono text-[10px]">{new Date(when).toLocaleString(undefined, { timeZone: IST_TZ, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          <span className={`text-[10px] uppercase font-semibold ${PLAN_STATUS_TONE[status] ?? "text-ops-muted"}`}>{status.replace(/_/g, " ")}</span>
          {by && <span className="text-[10px] text-ops-muted">{by === "system" ? "auto (overdue sweep)" : `by ${by}`}</span>}
          {snapshots.map((s) => {
            const n = ((s.payload as SnapshotRow[]) ?? []).length;
            return (
              <span
                key={s.historyId}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(s.historyId);
                  setOpen(true);
                }}
                className={`text-[10px] border px-1.5 py-px ${SNAPSHOT_TONE[s.snapshotType] ?? "text-ops-muted border-ops-border"} ${open && s.historyId === selectedId ? "bg-ops-hover" : ""}`}
                title={new Date(s.snapshotAt).toLocaleString(undefined, { timeZone: IST_TZ })}
              >
                {SNAPSHOT_LABEL[s.snapshotType] ?? s.snapshotType} · {n} block{n === 1 ? "" : "s"}
              </span>
            );
          })}
        </span>
        <span className="text-ops-muted text-[10px]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="p-3 space-y-2 bg-ops-inset">
          <CorridorPicker zone={latest.zone} value={corridorId} onChange={setCorridorId} lockZone={Boolean(latest.zone)} blockCounts={blockCounts} />
          {corridorId ? (
            <SnapshotGantt rows={filtered} rangeStart={range.start} rangeEnd={range.end} />
          ) : (
            <p className="text-xs text-ops-muted p-3 border border-ops-border">Select a corridor.</p>
          )}
        </div>
      )}
    </div>
  );
}

function PeriodCard({ periodKey, entries, isCurrentlyActive }: { periodKey: string; entries: PlanHistoryEntry[]; isCurrentlyActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [horizonType, periodLabel, zone] = periodKey.split("::");
  // Newest plan first; each row is one plan with all its versions.
  const plans = groupByPlan(entries).sort((a, b) => b[0].snapshotAt.localeCompare(a[0].snapshotAt));
  const live = plans.find((p) => p[p.length - 1].planStatus === "approved");
  const liveBlocks = live ? ((live[live.length - 1].payload as SnapshotRow[]) ?? []).length : 0;

  return (
    <div className="border border-ops-border">
      <button onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-ops-hover">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-ops-text" title={periodLabel}>{periodLabelText(horizonType, periodLabel)}</span>
          {zone && <span className="text-xs font-semibold mono text-ops-text">{zone}</span>}
          <span className="text-[10px] text-ops-muted uppercase">{horizonType}</span>
          {isCurrentlyActive && <span className="text-[10px] font-semibold text-emerald-400 border border-emerald-400/40 px-1.5 py-0.5">CURRENTLY ACTIVE</span>}
          <span className="text-[10px] text-ops-muted">
            {plans.length} plan{plans.length === 1 ? "" : "s"}
            {live ? ` · live: ${liveBlocks} block${liveBlocks === 1 ? "" : "s"}` : ""}
          </span>
        </div>
        <span className="text-ops-muted text-[10px]">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="border-t border-ops-border p-2 space-y-1.5">
          {plans.map((snapshots) => (
            <PlanVersionsRow key={snapshots[0].planId} snapshots={snapshots} />
          ))}
        </div>
      )}
    </div>
  );
}

const SUB_TABS = ["Plans", "Backlog", "Modifications", "Model versions"] as const;
type SubTab = (typeof SUB_TABS)[number];
// A department sees what happened to its own work; model versions and the
// controller's rejected / superseded drafts are controller business.
const DEPT_SUB_TABS: readonly SubTab[] = ["Plans", "Backlog", "Modifications"];

function ModelVersions() {
  const [versions, setVersions] = useState<ModelVersion[]>([]);
  const planRevision = useAppStore((s) => s.planRevision);
  useEffect(() => {
    api.get<ModelVersion[]>("/api/v1/plans/models").then(setVersions);
  }, [planRevision]);
  return (
    <div className="space-y-2">
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
                <td className="p-2 text-ops-muted mono whitespace-nowrap">{new Date(v.trainedAt).toLocaleString(undefined, { timeZone: IST_TZ })}</td>
                <td className="p-2 text-ops-text mono">{typeof v.metrics?.holdout_spearman === "number" ? (v.metrics.holdout_spearman as number).toFixed(3) : "—"}</td>
                <td className="p-2 text-ops-text mono">{String(v.metrics?.n_controller_decisions_used ?? "—")}</td>
                <td className={`p-2 font-semibold ${v.promoted ? "text-emerald-400" : "text-ops-muted"}`}>{v.promoted ? "IN USE" : "challenger"}</td>
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

export function HistoryPanel({ scope }: { scope: "own" | "all" }) {
  const [sub, setSub] = useState<SubTab>("Plans");
  const [entries, setEntries] = useState<PlanHistoryEntry[]>([]);
  const [histQuery, setHistQuery] = useState("");
  const [histHorizon, setHistHorizon] = useState("");
  const [histZone, setHistZone] = useState("");
  const [modifications, setModifications] = useState<ModificationRequest[]>([]);
  const { plans, fetchPlans, zones, fetchZones, selectedZone, planRevision } = useAppStore();

  useEffect(() => {
    api.get<PlanHistoryEntry[]>("/api/v1/plans/history").then(setEntries);
    api.get<ModificationRequest[]>("/api/v1/modifications").then(setModifications);
    fetchPlans();
    if (zones.length === 0) fetchZones();
  }, [fetchPlans, fetchZones, zones.length, planRevision]);

  const decided = modifications.filter((m) => m.status === "approved" || m.status === "rejected" || m.status === "lapsed");
  const q = histQuery.trim().toLowerCase();
  const groups = Array.from(groupByPeriod(entries).entries())
    .filter(([key]) => {
      const [h, period, z] = key.split("::");
      if (histHorizon && h !== histHorizon) return false;
      if (histZone && z !== histZone) return false;
      if (q && !`${periodLabelText(h, period)} ${period} ${z}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => b[0].localeCompare(a[0]));
  const histZones = [...new Set(entries.map((e) => e.zone).filter((z): z is string => Boolean(z)))].sort();

  const activePeriodKeys = new Set(
    plans.filter((p) => p.status === "approved" && planTimeState(p.horizonStart, p.horizonEnd) !== "past").map((p) => `${p.horizonType}::${p.periodLabel}::${p.zone ?? ""}`)
  );

  // Rejected, superseded, or approved-but-already-over — everything that
  // isn't live or awaiting a decision belongs here rather than cluttering
  // the Plans tab, which only shows what's still actionable.
  const isDone = (p: (typeof plans)[number]) =>
    scope === "all"
      ? p.status === "rejected" || p.status === "superseded" || (p.status === "approved" && planTimeState(p.horizonStart, p.horizonEnd) === "past")
      : p.status === "approved" && planTimeState(p.horizonStart, p.horizonEnd) === "past";
  const tabs = scope === "all" ? SUB_TABS : DEPT_SUB_TABS;
  const pastTitle = (h: string) => (scope === "all" ? `Past, rejected & superseded ${h} plans` : `Past ${h} plans`);
  const pastMonthly = plans.filter((p) => p.horizonType === "monthly" && isDone(p)).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const pastWeekly = plans.filter((p) => p.horizonType === "weekly" && isDone(p)).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-ops-border">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setSub(t)}
            className={`px-3 py-1.5 text-xs font-medium -mb-px border-b-2 ${sub === t ? "border-ops-accent text-ops-text" : "border-transparent text-ops-muted hover:text-ops-text"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {sub === "Backlog" && <BacklogHistory scope={scope} />}
      {sub === "Model versions" && <ModelVersions />}
      {sub === "Modifications" && <ModificationList items={decided} mode={scope === "all" ? "controller" : "dept"} />}

      {sub === "Plans" && (
      <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2 text-xs">
          <h3 className="text-xs font-semibold text-ops-text mr-2">Schedule History</h3>
          <input value={histQuery} onChange={(e) => setHistQuery(e.target.value)} placeholder="Search period / zone…" className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1 w-56" />
          <select value={histHorizon} onChange={(e) => setHistHorizon(e.target.value)} className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
            <option value="">Monthly & weekly</option>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
          </select>
          {histZones.length > 1 && (
            <select value={histZone} onChange={(e) => setHistZone(e.target.value)} className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
              <option value="">All zones</option>
              {histZones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          )}
          <span className="text-ops-muted ml-auto">{groups.length} periods</span>
        </div>
        <div className="space-y-1.5">
          {groups.length === 0 && <p className="text-xs text-ops-muted p-4 border border-ops-border">No history yet.</p>}
          {groups.map(([key, es]) => (
            <PeriodCard key={key} periodKey={key} entries={es} isCurrentlyActive={activePeriodKeys.has(key)} />
          ))}
        </div>
      </div>

      <PlanPeriodBrowser
        title={pastTitle("monthly")}
        horizon="monthly"
        plans={pastMonthly}
        weeklyPlans={plans.filter((wp) => wp.horizonType === "weekly")}
        zones={zones}
        defaultZone={selectedZone}
        emptyText="No past monthly plans."
      />
      <PlanPeriodBrowser
        title={pastTitle("weekly")}
        horizon="weekly"
        plans={pastWeekly}
        weeklyPlans={plans.filter((wp) => wp.horizonType === "weekly")}
        zones={zones}
        defaultZone={selectedZone}
        emptyText="No past weekly plans."
      />
      </div>
      )}
    </div>
  );
}
