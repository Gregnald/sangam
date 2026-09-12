import { ALL_ZONES, usePlanSelection } from "../hooks/usePlanSelection";
import { planTimeState, IST_TZ } from "../lib/dates";
import type { BlockPlan, ZoneSummary } from "../types/api";
import { MonthPlanCard } from "./MonthPlanCard";
import { PeriodKpiPanel } from "./PlanKpiPanel";
import { PlanPicker } from "./PlanPicker";
import { WeeklyPlanRow } from "./WeeklyPlanRow";

/**
 * Month/week → zone browser over a set of plans. "All zones" shows the
 * consolidated KPIs for the period plus every zone's plan; a specific zone
 * shows its plans newest first (a pending regeneration sits above the
 * approved one it would replace).
 */
export function PlanPeriodBrowser({
  title,
  horizon,
  plans,
  weeklyPlans,
  zones,
  emptyText,
  consolidated = false,
  defaultZone,
  onApprove,
  onReject,
  busy,
}: {
  title: string;
  horizon: "monthly" | "weekly";
  plans: BlockPlan[];
  weeklyPlans: BlockPlan[];
  zones: ZoneSummary[];
  emptyText: string;
  consolidated?: { statuses: string } | false;
  /** Zone to open on (if it has a plan for the chosen period). */
  defaultZone?: string | null;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  busy?: string | null;
}) {
  const sel = usePlanSelection(horizon, plans, zones, defaultZone);

  const card = (p: BlockPlan) => {
    const active = p.status === "approved" && planTimeState(p.horizonStart, p.horizonEnd) === "current";
    return horizon === "monthly" ? (
      <MonthPlanCard key={p.planId} plan={p} weeklyPlans={weeklyPlans} onApprove={onApprove} onReject={onReject} busy={busy} activeLabel={active} />
    ) : (
      <WeeklyPlanRow
        key={p.planId}
        planId={p.planId}
        periodLabel={p.periodLabel}
        status={p.status}
        zone={p.zone}
        horizonStart={p.horizonStart}
        horizonEnd={p.horizonEnd}
        onApprove={onApprove}
        onReject={onReject}
        busy={busy}
        activeLabel={active}
      />
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <h3 className="text-xs font-semibold text-ops-text">{title}</h3>
        {plans.length > 0 && (
          <PlanPicker
            horizon={horizon}
            periods={sel.periods}
            period={sel.period}
            onPeriodChange={sel.setPeriod}
            zoneOptions={sel.zoneOptions}
            zone={sel.zone}
            onZoneChange={sel.setZone}
          />
        )}
      </div>

      {plans.length === 0 ? (
        <p className="text-xs text-ops-muted p-4 border border-ops-border">{emptyText}</p>
      ) : !sel.period ? null : sel.zone === ALL_ZONES ? (
        <div className="space-y-3">
          {consolidated && (
            <PeriodKpiPanel horizon={horizon} period={sel.period} statuses={consolidated.statuses} refreshKey={sel.selectedPlans.map((p) => p.planId + p.status).join("|")} />
          )}
          {/* One line per zone — pick a zone to open its card. */}
          <div className="border border-ops-border overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-ops-inset text-ops-muted uppercase text-[10px]">
                <tr>
                  <th className="text-left p-2">Zone</th>
                  <th className="text-left p-2">Plans for {sel.periodOption?.label ?? sel.period}</th>
                  <th className="text-left p-2">Latest generated</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ops-border">
                {sel.zoneOptions.map((z) => {
                  const list = sel.byZone.get(z.zone) ?? [];
                  const tone = (st: string) =>
                    st === "approved" ? "text-emerald-400" : st === "pending_approval" ? "text-amber-400" : st === "rejected" ? "text-red-400" : "text-ops-muted";
                  return (
                    <tr key={z.zone || "—"} className={z.hasPlan ? "hover:bg-ops-hover cursor-pointer" : "opacity-60"} onClick={() => z.hasPlan && sel.setZone(z.zone)}>
                      <td className="p-2 text-ops-text font-semibold mono">{z.zone || "—"}</td>
                      <td className="p-2">
                        {list.length === 0 ? (
                          <span className="text-ops-muted">no plan</span>
                        ) : (
                          list.map((p) => (
                            <span key={p.planId} className={`mr-3 text-[11px] uppercase font-semibold ${tone(p.status)}`}>
                              {p.status.replace(/_/g, " ")}
                            </span>
                          ))
                        )}
                      </td>
                      <td className="p-2 text-ops-muted mono">
                        {list[0] ? new Date(list[0].generatedAt).toLocaleString(undefined, { timeZone: IST_TZ, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="p-2 text-right">{z.hasPlan && <span className="text-ops-accent text-[11px]">open →</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : sel.selectedPlans.length === 0 ? (
        <p className="text-xs text-ops-muted p-4 border border-ops-border">
          No {horizon} plan for {sel.zone || "—"} in {sel.periodOption?.label ?? sel.period}.
        </p>
      ) : (
        <div className="space-y-2">{sel.selectedPlans.map(card)}</div>
      )}
    </div>
  );
}
