import { useState } from "react";
import { WeeklyPlanView } from "./WeeklyPlanView";
import { PlanKpiPanel } from "./PlanKpiPanel";
import { useAppStore } from "../store/appStore";
import { fmtDate, mondayOf, planPeriodLabel } from "../lib/dates";
import type { BlockPlan } from "../types/api";

function weekState(start: Date, end: Date): "past" | "current" | "upcoming" {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (end < today) return "past";
  if (start > today) return "upcoming";
  return "current";
}

const STATUS_COLOR: Record<string, string> = {
  approved: "text-emerald-400",
  rejected: "text-red-400",
  pending_approval: "text-amber-400",
  superseded: "text-ops-muted",
};

export function MonthPlanCard({
  plan,
  weeklyPlans,
  onApprove,
  onReject,
  busy,
  activeLabel,
}: {
  plan: BlockPlan;
  weeklyPlans: BlockPlan[];
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  busy?: string | null;
  activeLabel?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const planRevision = useAppStore((s) => s.planRevision);
  const monthStart = new Date(plan.horizonStart + "T00:00:00");
  const monthEnd = new Date(plan.horizonEnd + "T00:00:00");

  const weeks: { start: Date; end: Date }[] = [];
  const seen = new Set<string>();
  const cursor = new Date(monthStart);
  while (cursor <= monthEnd) {
    const start = mondayOf(cursor);
    const key = fmtDate(start);
    if (!seen.has(key)) {
      seen.add(key);
      const wend = new Date(start);
      wend.setDate(start.getDate() + 6);
      weeks.push({ start, end: wend });
    }
    cursor.setDate(cursor.getDate() + 7);
  }

  return (
    <div className="border border-ops-border">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-ops-hover cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-ops-text" title={plan.periodLabel}>{planPeriodLabel(plan)}</span>
          <span className={`text-[10px] uppercase font-semibold ${STATUS_COLOR[plan.status] ?? "text-ops-muted"}`}>{plan.status.replace(/_/g, " ")}</span>
          <span className="text-[10px] text-ops-muted">{plan.zone}</span>
          {activeLabel && <span className="text-[10px] font-semibold text-emerald-400 border border-emerald-400/40 px-1.5 py-0.5">CURRENTLY ACTIVE</span>}
        </div>
        <div className="flex items-center gap-2">
          {plan.status === "pending_approval" && onApprove && onReject && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onApprove(plan.planId);
                }}
                disabled={busy === plan.planId}
                className="px-2 py-1 bg-emerald-600 text-white text-[11px]"
              >
                Approve
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReject(plan.planId);
                }}
                disabled={busy === plan.planId}
                className="px-2 py-1 border border-ops-border text-ops-muted text-[11px]"
              >
                Reject
              </button>
            </>
          )}
          <span className="text-ops-muted text-[10px]">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-ops-border divide-y divide-ops-border">
          <div className="p-3">
            <PlanKpiPanel planId={plan.planId} refreshKey={`${plan.status}:${planRevision}`} />
          </div>
          {weeks.map((w) => {
            const state = weekState(w.start, w.end);
            const approved = weeklyPlans.some((wp) => wp.horizonStart === fmtDate(w.start) && wp.status === "approved" && wp.zone === plan.zone);
            // Once a week has its own approved weekly plan, that's the live,
            // authoritative version of what happens then — show it instead
            // of this monthly plan's copy, which regenerating may have since
            // superseded. Until then, this monthly plan (even if it's still
            // only "pending approval" itself) is the only place that week's
            // proposed schedule exists, so show it directly.
            return <WeekRow key={fmtDate(w.start)} start={w.start} end={w.end} state={state} approved={approved} zone={plan.zone} planId={approved ? null : plan.planId} />;
          })}
        </div>
      )}
    </div>
  );
}

function WeekRow({ start, end, state, approved, zone, planId }: { start: Date; end: Date; state: string; approved: boolean; zone: string | null; planId?: string | null }) {
  const [open, setOpen] = useState(false);
  const stateLabel = state === "past" ? "Past" : state === "current" ? "Current" : "Upcoming";
  const stateColor = state === "past" ? "text-ops-muted" : state === "current" ? "text-emerald-400" : "text-blue-400";
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-ops-hover">
        <span className="text-[11px] text-ops-text">
          Week of {start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – {end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
          <span className={`font-semibold ${stateColor}`}>{stateLabel}</span>
          {!approved && <span className="text-[10px] text-ops-muted ml-2">(from monthly plan)</span>}
        </span>
        <span className="text-ops-muted text-[10px]">{open ? "▲" : "▼"}</span>
      </button>
      {open && <WeeklyPlanView zone={zone} weekStart={fmtDate(start)} weekEnd={fmtDate(end)} planId={planId} />}
    </div>
  );
}
