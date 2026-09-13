import { useEffect, useMemo, useState } from "react";
import { MonthFromWeeklyCard, MonthPlanCard } from "../MonthPlanCard";
import { WeeklyPlanRow } from "../WeeklyPlanRow";
import { useAppStore } from "../../store/appStore";
import { monthLabel, planPeriodLabel, planTimeState } from "../../lib/dates";
import type { BlockPlan } from "../../types/api";

/**
 * Read-only view of the published plans for one zone: the monthly plan and
 * the weekly plan that cover *now* by default, each switchable to any other
 * approved plan for that zone. Departments can't approve or regenerate —
 * they see what the controller has published.
 */
export function DeptPlanView() {
  const { zones, selectedZone, setSelectedZone, plans, fetchPlans, fetchZones } = useAppStore();
  const [monthPeriod, setMonthPeriod] = useState<string>("");
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
  const currentWeek = weekly.find((p) => planTimeState(p.horizonStart, p.horizonEnd) === "current") ?? null;
  // Months on offer: this month, plus any month a monthly or weekly plan of this zone touches.
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const months = useMemo(() => {
    const set = new Set<string>([thisMonth]);
    for (const p of monthly) set.add(p.periodLabel);
    for (const p of weekly) {
      set.add(p.horizonStart.slice(0, 7));
      set.add(p.horizonEnd.slice(0, 7));
    }
    return [...set].sort().reverse();
  }, [monthly, weekly, thisMonth]);

  // Default to this month (whether or not a plan exists) and this week; reset when the zone changes.
  useEffect(() => {
    setMonthPeriod(thisMonth);
    setWeekId(currentWeek?.planId ?? weekly[0]?.planId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedZone, plans.length]);

  const month = monthly.find((p) => p.periodLabel === monthPeriod) ?? null;
  const weeklyInMonth = weekly.filter((p) => p.horizonStart.slice(0, 7) === monthPeriod || p.horizonEnd.slice(0, 7) === monthPeriod);
  const week = weekly.find((p) => p.planId === weekId) ?? null;
  const monthState = monthPeriod === thisMonth ? "current" : monthPeriod < thisMonth ? "past" : "upcoming";

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
          Month
          <select value={monthPeriod} onChange={(e) => setMonthPeriod(e.target.value)} className="bg-ops-inset border border-ops-border text-ops-text px-2 py-1">
            {months.map((m) => {
              const has = monthly.some((p) => p.periodLabel === m);
              const wk = weekly.filter((p) => p.horizonStart.slice(0, 7) === m || p.horizonEnd.slice(0, 7) === m).length;
              return (
                <option key={m} value={m}>
                  {monthLabel(m)}
                  {m === thisMonth ? " (current)" : ""}
                  {has ? " — monthly plan" : wk ? ` — ${wk} weekly plan${wk === 1 ? "" : "s"} only` : " — no plan"}
                </option>
              );
            })}
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
          Monthly plan — {monthLabel(monthPeriod)}
          {monthState === "current" && <span className="ml-2 text-[10px] text-emerald-400 font-semibold">CURRENT MONTH</span>}
        </h3>
        {month ? (
          <MonthPlanCard plan={month} weeklyPlans={weekly} activeLabel={monthState === "current"} />
        ) : weeklyInMonth.length > 0 ? (
          <MonthFromWeeklyCard period={monthPeriod} zone={selectedZone} weeklyPlans={weekly} />
        ) : (
          <p className="text-xs text-ops-muted p-4 border border-ops-border">
            No plan for {selectedZone} in {monthLabel(monthPeriod)} yet — the controller has not generated one for this zone.
          </p>
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
          <p className="text-xs text-ops-muted p-4 border border-ops-border">No approved weekly plan for {selectedZone}.</p>
        )}
      </div>
    </div>
  );
}
