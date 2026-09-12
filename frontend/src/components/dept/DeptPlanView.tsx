import { useEffect, useMemo, useState } from "react";
import { MonthPlanCard } from "../MonthPlanCard";
import { WeeklyPlanRow } from "../WeeklyPlanRow";
import { useAppStore } from "../../store/appStore";
import { planPeriodLabel, planTimeState } from "../../lib/dates";
import type { BlockPlan } from "../../types/api";

/**
 * Read-only view of the published plans for one zone: the monthly plan and
 * the weekly plan that cover *now* by default, each switchable to any other
 * approved plan for that zone. Departments can't approve or regenerate —
 * they see what the controller has published.
 */
export function DeptPlanView() {
  const { zones, selectedZone, setSelectedZone, plans, fetchPlans, fetchZones } = useAppStore();
  const [monthId, setMonthId] = useState<string | null>(null);
  const [weekId, setWeekId] = useState<string | null>(null);

  useEffect(() => {
    if (zones.length === 0) fetchZones();
    fetchPlans();
  }, [zones.length, fetchZones, fetchPlans]);

  const approved = useMemo(
    () => plans.filter((p) => p.status === "approved" && p.zone === selectedZone).sort((a, b) => b.horizonStart.localeCompare(a.horizonStart)),
    [plans, selectedZone],
  );
  const monthly = approved.filter((p) => p.horizonType === "monthly");
  const weekly = approved.filter((p) => p.horizonType === "weekly");
  const currentMonth = monthly.find((p) => planTimeState(p.horizonStart, p.horizonEnd) === "current") ?? null;
  const currentWeek = weekly.find((p) => planTimeState(p.horizonStart, p.horizonEnd) === "current") ?? null;

  // Default to whatever covers today; reset when the zone changes.
  useEffect(() => {
    setMonthId(currentMonth?.planId ?? monthly[0]?.planId ?? null);
    setWeekId(currentWeek?.planId ?? weekly[0]?.planId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedZone, plans.length]);

  const month = monthly.find((p) => p.planId === monthId) ?? null;
  const week = weekly.find((p) => p.planId === weekId) ?? null;

  const label = (p: BlockPlan) => {
    const state = planTimeState(p.horizonStart, p.horizonEnd);
    return `${planPeriodLabel(p)}${state === "current" ? " (current)" : state === "past" ? " (past)" : ""}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <label className="flex items-center gap-2 text-ops-muted">
          Zone
          <select value={selectedZone ?? ""} onChange={(e) => setSelectedZone(e.target.value || null)} className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
            {zones.map((z) => (
              <option key={z.zone ?? "none"} value={z.zone ?? ""}>
                {z.zone}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-ops-muted">
          Monthly plan
          <select value={monthId ?? ""} onChange={(e) => setMonthId(e.target.value || null)} className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
            {monthly.length === 0 && <option value="">No approved monthly plan for {selectedZone}</option>}
            {monthly.map((p) => (
              <option key={p.planId} value={p.planId}>
                {label(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-ops-muted">
          Weekly plan
          <select value={weekId ?? ""} onChange={(e) => setWeekId(e.target.value || null)} className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
            {weekly.length === 0 && <option value="">No approved weekly plan for {selectedZone}</option>}
            {weekly.map((p) => (
              <option key={p.planId} value={p.planId}>
                {label(p)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-ops-text mb-2">
          Monthly plan {month ? `— ${planPeriodLabel(month)}` : ""}
          {month && planTimeState(month.horizonStart, month.horizonEnd) === "current" && <span className="ml-2 text-[10px] text-emerald-400 font-semibold">CURRENT MONTH</span>}
        </h3>
        {month ? (
          <MonthPlanCard plan={month} weeklyPlans={weekly} activeLabel={planTimeState(month.horizonStart, month.horizonEnd) === "current"} />
        ) : (
          <p className="text-xs text-ops-muted p-4 border border-ops-border">The controller hasn't published a monthly plan for {selectedZone} yet.</p>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold text-ops-text mb-2">
          Weekly plan {week ? `— ${planPeriodLabel(week)}` : ""}
          {week && planTimeState(week.horizonStart, week.horizonEnd) === "current" && <span className="ml-2 text-[10px] text-emerald-400 font-semibold">CURRENT WEEK</span>}
        </h3>
        {week ? (
          <WeeklyPlanRow
            planId={week.planId}
            periodLabel={week.periodLabel}
            status={week.status}
            zone={week.zone}
            horizonStart={week.horizonStart}
            horizonEnd={week.horizonEnd}
            activeLabel={planTimeState(week.horizonStart, week.horizonEnd) === "current"}
          />
        ) : (
          <p className="text-xs text-ops-muted p-4 border border-ops-border">The controller hasn't published a weekly plan for {selectedZone} yet.</p>
        )}
      </div>
    </div>
  );
}
