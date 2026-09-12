import { useEffect, useState } from "react";
import { TopBar } from "../components/TopBar";
import { RequestsTable } from "../components/RequestsTable";
import { ModificationList } from "../components/ModificationList";
import { HistoryPanel } from "../components/HistoryPanel";
import { PlanPeriodBrowser } from "../components/PlanPeriodBrowser";
import { BlockCompatibilityEditor } from "../components/BlockCompatibilityEditor";
import { IngestionPage } from "../components/IngestionPage";
import { AnalyticsPage } from "../components/AnalyticsPage";
import { planTimeState } from "../lib/dates";
import { useAppStore } from "../store/appStore";
import type { BulkPlanResult } from "../types/api";

const TABS = ["Backlog", "Approvals", "Plans", "Analytics", "Compatibility", "Ingest", "History"];

export function ControllerDashboard() {
  const [tab, setTab] = useState("Backlog");
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [planZone, setPlanZone] = useState<string | null>(null);
  const [monthsAhead, setMonthsAhead] = useState<0 | 1 | 2>(1);
  const [bulkBusy, setBulkBusy] = useState<"weekly" | "monthly" | null>(null);
  const [bulkResults, setBulkResults] = useState<{ kind: "weekly" | "monthly"; results: BulkPlanResult[] } | null>(null);

  const {
    zones, selectedZone, requests, modifications, plans, resetEpoch,
    fetchZones, fetchRequests, fetchModifications, fetchPlans,
    decideModification, generateMonthlyPlan, generateWeeklyPlan,
    approvePlan, rejectPlan, generateAndApproveAllMonthly, generateAndApproveAllWeekly,
  } = useAppStore();

  useEffect(() => {
    fetchZones();
    fetchRequests();
    fetchModifications();
    fetchPlans();
    // The backend reconciles the backlog with the clock every minute
    // (completed blocks, lapsed offers); pick those changes up.
    const interval = setInterval(() => {
      fetchRequests();
      fetchModifications();
    }, 60000);
    return () => clearInterval(interval);
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

      <main key={resetEpoch} className="flex-1 overflow-y-auto p-5">

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
              <select value={planZone ?? ""} onChange={(e) => setPlanZone(e.target.value || null)} className="text-xs bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
                {zones.map((z) => (
                  <option key={z.zone ?? "none"} value={z.zone ?? ""}>
                    {z.zone}
                  </option>
                ))}
              </select>
              <select value={monthsAhead} onChange={(e) => setMonthsAhead(Number(e.target.value) as 0 | 1 | 2)} className="text-xs bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
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
            <div className="border border-ops-border p-3 space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[11px] text-ops-muted">All zones:</span>
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
                </div>
              )}
            </div>

            <PlanPeriodBrowser
              title="Monthly Plans"
              horizon="monthly"
              plans={monthlyPlans}
              weeklyPlans={weeklyPlans}
              zones={zones}
              defaultZone={planZone}
              consolidated={{ statuses: "approved,pending_approval" }}
              onApprove={handleApprove}
              onReject={handleReject}
              busy={busyPlan}
              emptyText="No monthly plans generated yet."
            />

            <PlanPeriodBrowser
              title="Weekly Plans"
              horizon="weekly"
              plans={visibleWeeklyPlans}
              weeklyPlans={weeklyPlans}
              zones={zones}
              defaultZone={planZone}
              consolidated={{ statuses: "approved,pending_approval" }}
              onApprove={handleApprove}
              onReject={handleReject}
              busy={busyPlan}
              emptyText="No weekly plans generated yet."
            />
          </div>
        )}

        {tab === "Compatibility" && (
          <div>
            <h2 className="text-sm font-semibold text-ops-text mb-3">Compatibility</h2>
            <BlockCompatibilityEditor zone={selectedZone} />
          </div>
        )}

        {tab === "Analytics" && <AnalyticsPage />}

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
