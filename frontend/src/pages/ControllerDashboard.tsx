import { useEffect, useState } from "react";
import { TopBar } from "../components/TopBar";
import { RequestsTable } from "../components/RequestsTable";
import { ModificationList } from "../components/ModificationList";
import { HistoryPanel } from "../components/HistoryPanel";
import { MapTab } from "../components/MapTab";
import { MonthPlanCard } from "../components/MonthPlanCard";
import { WeeklyPlanRow } from "../components/WeeklyPlanRow";
import { BlockCompatibilityEditor } from "../components/BlockCompatibilityEditor";
import { IngestionPage } from "../components/IngestionPage";
import { planTimeState } from "../lib/dates";
import { useAppStore } from "../store/appStore";
import type { BulkPlanResult } from "../types/api";

const TABS = ["Map", "Backlog", "Approvals", "Plans", "Compatibility", "Ingest", "History"];

export function ControllerDashboard() {
  const [tab, setTab] = useState("Map");
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [planZone, setPlanZone] = useState<string | null>(null);
  const [monthsAhead, setMonthsAhead] = useState<0 | 1 | 2>(1);
  const [bulkBusy, setBulkBusy] = useState<"weekly" | "monthly" | null>(null);
  const [bulkResults, setBulkResults] = useState<{ kind: "weekly" | "monthly"; results: BulkPlanResult[] } | null>(null);

  const {
    zones, selectedZone, requests, modifications, plans,
    fetchZones, fetchRequests, fetchModifications, fetchPlans,
    decideModification, generateMonthlyPlan, generateWeeklyPlan,
    approvePlan, rejectPlan, generateAndApproveAllMonthly, generateAndApproveAllWeekly,
  } = useAppStore();

  useEffect(() => {
    fetchZones();
    fetchRequests();
    fetchModifications();
    fetchPlans();
  }, [fetchZones, fetchRequests, fetchModifications, fetchPlans]);

  useEffect(() => {
    if (!planZone && zones.length > 0) setPlanZone(zones[0].zone);
  }, [zones, planZone]);

  const pendingControllerMods = modifications.filter((m) => m.status === "pending_controller" || m.status === "pending_dept");
  const isLiveOrPending = (p: (typeof plans)[number]) =>
    p.status === "pending_approval" || (p.status === "approved" && planTimeState(p.horizonStart, p.horizonEnd) !== "past");
  const monthlyPlans = plans
    .filter((p) => p.horizonType === "monthly")
    .filter(isLiveOrPending)
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const weeklyPlans = plans.filter((p) => p.horizonType === "weekly");
  const visibleWeeklyPlans = weeklyPlans.filter(isLiveOrPending);

  async function handleGenerateMonthly() {
    if (!planZone) return;
    setBusyPlan("monthly");
    try {
      await generateMonthlyPlan(planZone, monthsAhead);
    } finally {
      setBusyPlan(null);
    }
  }

  async function handleGenerateWeekly() {
    if (!planZone) return;
    setBusyPlan("weekly");
    try {
      await generateWeeklyPlan(planZone);
    } finally {
      setBusyPlan(null);
    }
  }

  async function handleApprove(planId: string) {
    setBusyPlan(planId);
    try {
      await approvePlan(planId);
    } finally {
      setBusyPlan(null);
    }
  }

  async function handleReject(planId: string) {
    setBusyPlan(planId);
    try {
      await rejectPlan(planId);
    } finally {
      setBusyPlan(null);
    }
  }

  async function handleGenerateApproveAllMonthly() {
    setBulkBusy("monthly");
    setBulkResults(null);
    try {
      const results = await generateAndApproveAllMonthly(monthsAhead);
      setBulkResults({ kind: "monthly", results });
    } finally {
      setBulkBusy(null);
    }
  }

  async function handleGenerateApproveAllWeekly() {
    setBulkBusy("weekly");
    setBulkResults(null);
    try {
      const results = await generateAndApproveAllWeekly();
      setBulkResults({ kind: "weekly", results });
    } finally {
      setBulkBusy(null);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-ops-bg">
      <TopBar tabs={TABS} active={tab} onTabChange={setTab} />

      <main className="flex-1 overflow-y-auto p-5">
        {tab === "Map" && <MapTab />}

        {tab === "Backlog" && (
          <div>
            <h2 className="text-sm font-semibold text-ops-text mb-3">Cross-Department Backlog</h2>
            <RequestsTable requests={requests} showDepartment showZone />
          </div>
        )}

        {tab === "Approvals" && (
          <div>
            <h2 className="text-sm font-semibold text-ops-text mb-3">Modification Requests</h2>
            <ModificationList items={pendingControllerMods} mode="controller" onControllerDecide={(id, approve, reason) => decideModification(id, approve, reason)} />
          </div>
        )}

        {tab === "Plans" && (
          <div className="space-y-6">
            <div className="flex items-center gap-3 flex-wrap">
              <select value={planZone ?? ""} onChange={(e) => setPlanZone(e.target.value || null)} className="text-xs bg-black/20 border border-ops-border text-ops-text px-2 py-1">
                {zones.map((z) => (
                  <option key={z.zone ?? "none"} value={z.zone ?? ""}>
                    {z.zone}
                  </option>
                ))}
              </select>
              <select value={monthsAhead} onChange={(e) => setMonthsAhead(Number(e.target.value) as 0 | 1 | 2)} className="text-xs bg-black/20 border border-ops-border text-ops-text px-2 py-1">
                <option value={0}>Current month</option>
                <option value={1}>Next month</option>
                <option value={2}>Month after</option>
              </select>
              <button disabled={!planZone || busyPlan === "monthly"} onClick={handleGenerateMonthly} className="px-3 py-1.5 bg-ops-accent disabled:opacity-50 text-white text-xs">
                {busyPlan === "monthly" ? "Solving…" : monthsAhead === 0 ? "Generate/Regenerate Current Month" : "Generate Monthly Plan"}
              </button>
              <button disabled={!planZone || busyPlan === "weekly"} onClick={handleGenerateWeekly} className="px-3 py-1.5 border border-ops-border text-ops-text disabled:opacity-50 text-xs">
                {busyPlan === "weekly" ? "Solving…" : "Generate Next Weekly Plan"}
              </button>
            </div>
            <p className="text-[11px] text-ops-muted -mt-4">
              {monthsAhead === 0
                ? "Current month: past days and any week that already has its own approved weekly plan are locked history — this only (re-)solves what's left, using every request currently in the backlog."
                : "Next month and the month after solve fresh, from day one, with nothing locked yet."}
            </p>

            <div className="border border-ops-border p-3 space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[11px] text-ops-muted">Bulk (uses the month selector above):</span>
                <button disabled={bulkBusy !== null} onClick={handleGenerateApproveAllMonthly} className="px-3 py-1.5 bg-ops-accent disabled:opacity-50 text-white text-xs">
                  {bulkBusy === "monthly" ? "Solving every zone…" : "Generate & Approve ALL Zones (Monthly)"}
                </button>
                <button disabled={bulkBusy !== null} onClick={handleGenerateApproveAllWeekly} className="px-3 py-1.5 border border-ops-border text-ops-text disabled:opacity-50 text-xs">
                  {bulkBusy === "weekly" ? "Solving every zone…" : "Generate & Approve ALL Zones (Weekly)"}
                </button>
              </div>
              {bulkResults && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead className="text-ops-muted uppercase text-[10px]">
                      <tr>
                        <th className="text-left p-1.5">Zone</th>
                        <th className="text-left p-1.5">Period</th>
                        <th className="text-left p-1.5">Assignments</th>
                        <th className="text-left p-1.5">Objective</th>
                        <th className="text-left p-1.5">Zero-score pending</th>
                        <th className="text-left p-1.5">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ops-border">
                      {bulkResults.results.map((r) => (
                        <tr key={r.zone}>
                          <td className="p-1.5 text-ops-text mono">{r.zone}</td>
                          <td className="p-1.5 text-ops-muted mono">{r.periodLabel ?? "—"}</td>
                          <td className={`p-1.5 mono ${r.assignments > 0 ? "text-emerald-400" : "text-ops-muted"}`}>{r.assignments}</td>
                          <td className="p-1.5 text-ops-muted mono">{r.objectiveValue.toFixed(0)}</td>
                          <td className={`p-1.5 mono ${r.zeroScorePending > 0 ? "text-amber-400" : "text-ops-muted"}`}>{r.zeroScorePending}</td>
                          <td className="p-1.5 text-red-400">{r.error ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[10px] text-ops-muted mt-2">
                    0 assignments with 0 zero-score-pending usually means the remaining backlog for that zone genuinely needs a longer window than any
                    available on its corridors — not an error. A nonzero "zero-score pending" count means a request scored exactly 0 by the priority
                    model is still sitting unscheduled; check whether it actually fits before assuming it's fine.
                  </p>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold text-ops-text mb-2">Monthly Plans</h3>
              <div className="space-y-2">
                {monthlyPlans.length === 0 && <p className="text-xs text-ops-muted p-4 border border-ops-border">No monthly plans generated yet.</p>}
                {monthlyPlans.map((p) => (
                  <MonthPlanCard key={p.planId} plan={p} weeklyPlans={weeklyPlans} onApprove={handleApprove} onReject={handleReject} busy={busyPlan} />
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-ops-text mb-2">Weekly Plans</h3>
              <div className="space-y-2">
                {visibleWeeklyPlans.length === 0 && <p className="text-xs text-ops-muted p-4 border border-ops-border">No weekly plans generated yet.</p>}
                {visibleWeeklyPlans
                  .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
                  .map((p) => (
                    <WeeklyPlanRow key={p.planId} onApprove={handleApprove} onReject={handleReject} busy={busyPlan} planId={p.planId} periodLabel={p.periodLabel} status={p.status} zone={p.zone} horizonStart={p.horizonStart} horizonEnd={p.horizonEnd} />
                  ))}
              </div>
            </div>
          </div>
        )}

        {tab === "Compatibility" && (
          <div>
            <h2 className="text-sm font-semibold text-ops-text mb-1">Block-Specific Compatibility</h2>
            <p className="text-xs text-ops-muted mb-3">Pick a corridor, day, and block to see or change which departments may share it.</p>
            <BlockCompatibilityEditor zone={selectedZone} />
          </div>
        )}

        {tab === "Ingest" && <IngestionPage />}

        {tab === "History" && (
          <div>
            <h2 className="text-sm font-semibold text-ops-text mb-3">History</h2>
            <HistoryPanel scope="all" />
          </div>
        )}
      </main>
    </div>
  );
}
