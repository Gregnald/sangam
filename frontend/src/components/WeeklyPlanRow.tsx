import { useState } from "react";
import { WeeklyPlanView } from "./WeeklyPlanView";
import { weekLabel } from "../lib/dates";
import { PlanKpiPanel } from "./PlanKpiPanel";

export function WeeklyPlanRow({
  planId,
  periodLabel,
  status,
  zone,
  horizonStart,
  horizonEnd,
  onApprove,
  onReject,
  busy,
  activeLabel,
}: {
  planId: string;
  periodLabel: string;
  status: string;
  zone: string | null;
  horizonStart: string;
  horizonEnd: string;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  busy?: string | null;
  activeLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-ops-border">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-ops-hover cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-ops-text" title={periodLabel}>{weekLabel(periodLabel, horizonStart, horizonEnd)}</span>
          <span className={`text-[10px] uppercase font-semibold ${status === "approved" ? "text-emerald-400" : status === "rejected" ? "text-red-400" : "text-amber-400"}`}>{status.replace(/_/g, " ")}</span>
          <span className="text-[10px] text-ops-muted">{zone}</span>
          {activeLabel && <span className="text-[10px] font-semibold text-emerald-400 border border-emerald-400/40 px-1.5 py-0.5">CURRENTLY ACTIVE</span>}
        </div>
        <div className="flex items-center gap-2">
          {status === "pending_approval" && onApprove && onReject && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onApprove(planId);
                }}
                disabled={busy === planId}
                className="px-2 py-1 bg-emerald-600 text-white text-[11px]"
              >
                Approve
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReject(planId);
                }}
                disabled={busy === planId}
                className="px-2 py-1 border border-ops-border text-ops-muted text-[11px]"
              >
                Reject
              </button>
            </>
          )}
          <span className="text-ops-muted text-[10px]">{open ? "▲" : "▼"}</span>
        </div>
      </div>
      {open && (
        <div className="border-t border-ops-border">
          <div className="p-3 pb-0">
            <PlanKpiPanel planId={planId} refreshKey={status} />
          </div>
          <WeeklyPlanView zone={zone} weekStart={horizonStart} weekEnd={horizonEnd} planId={planId} />
        </div>
      )}
    </div>
  );
}
